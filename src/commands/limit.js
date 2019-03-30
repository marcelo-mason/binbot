import prompts from 'prompts'
import _ from 'lodash'
import async from 'awaitable-async'
import asTable from 'as-table'
import idable from 'idable'
import chalk from 'chalk'
import Case from 'case'

import db from '../db'
import binance from '../binance'
import { bn, colorizeColumns, addQuoteSuffix, timestamp, fix } from '../util'
import { log } from '../logger'

const index = {
  number: 0,
  price: 1,
  quantity: 2,
  cost: 3,
  validation: 4
}

class LimitCommand {
  constructor() {
    this.ei = null
  }
  async start(data) {
    // get binance data

    this.ei = await binance.getExchangeInfo(data.pair)

    const balances = {
      quote: fix(await binance.balance(data.quote), this.ei.precision.quote),
      base: fix(await binance.balance(data.base), this.ei.precision.quantity)
    }

    let currentPrice = fix(await binance.tickerPrice(data.pair), this.ei.precision.price)
    if (!currentPrice) {
      return
    }

    // check for iceberg limitation

    if (!this.ei.icebergAllowed && data.opts.iceberg) {
      log.warn('Iceberg orderCount not allowed on this asset.')
      data.opts.iceberg = false
    }

    // calculate quantity for sale

    const { quantity, quoteToSpend } = data.isSell
      ? await this.calculateQuantityforSell(balances, data)
      : await this.calculateQuantityforBuy(balances, data)

    // create a one order payload

    let payload = [
      [
        1,
        data.price,
        quantity,
        bn(data.price)
          .multipliedBy(quantity)
          .fix(this.ei.precision.quote)
      ]
    ]

    // or a multi-order spread payload

    if (data.isSpread) {
      payload = await this.calculateSpreadPayload(quantity, data)
      this.errorCorrectQuantities(payload, quoteToSpend, quantity)
    }

    // validate payload with binance

    const valid = await this.validateOrders(payload, data)

    // display data to user

    this.displayData(data, payload, balances, quantity, currentPrice)

    if (!valid) {
      return
    }

    if (data.isLater) {
      let res = await prompts({
        type: 'confirm',
        name: 'correct',
        message: 'Create triggers?'
      })

      if (res.correct) {
        db.addOrder(payload, data)
      }
    } else {
      let res = await prompts({
        type: 'confirm',
        name: 'correct',
        message: 'Create orders?'
      })

      if (res.correct) {
        this.create(payload, data)
      }
    }
  }

  async calculateQuantityforBuy(balances, data) {
    if (data.qtyType === 'base') {
      return {
        quantity: data.qtyValue,
        quoteToSpend: null
      }
    }

    if (data.qtyType === 'quote' || data.qtyType === 'percent') {
      let quoteToSpend = data.qtyValue

      if (data.qtyType === 'percent') {
        quoteToSpend = bn(balances.quote)
          .multipliedBy(data.qtyValue)
          .dividedBy(100)
          .toString()
      }

      const avgPrice = bn(data.max)
        .plus(data.min)
        .dividedBy(2)
        .toString()

      const quantity = bn(quoteToSpend)
        .dividedBy(avgPrice)
        .fix(this.ei.precision.quantity)

      return {
        quantity,
        quoteToSpend: fix(quoteToSpend, this.ei.precision.quote)
      }
    }
  }

  async calculateQuantityforSell(balances, data) {
    if (data.qtyType === 'base') {
      return {
        quantity: data.qtyValue,
        quoteToSpend: null
      }
    }

    if (data.qtyType === 'percent') {
      const quantity = bn(balances.base)
        .multipliedBy(data.qtyValue)
        .dividedBy(100)
        .fix(this.ei.precision.quantity)

      return {
        quantity,
        quoteToSpend: null
      }
    }

    if (data.qtyType === 'quote') {
      let quoteToSpend = data.qtyValue

      const avgPrice = bn(data.max)
        .plus(data.min)
        .dividedBy(2)
        .toString()

      const quantity = bn(quoteToSpend)
        .dividedBy(avgPrice)
        .fix(this.ei.precision.quantity)

      return {
        quantity,
        quoteToSpend: fix(quoteToSpend, this.ei.precision.quote)
      }
    }
  }

  async calculateSpreadPayload(quantity, data) {
    // calculate spread

    const spreadWidth = bn(data.max)
      .minus(data.min)
      .fix(this.ei.precision.price)

    const spreadDistance = bn(spreadWidth)
      .dividedBy(data.orderCount - 1)
      .toString()

    // calculate price distribution

    const prices = _.range(data.orderCount)
      .map(n => {
        const distance = bn(spreadDistance)
          .multipliedBy(n)
          .toString()
        return bn(data.min)
          .plus(distance)
          .fix(this.ei.precision.price)
      })
      .reverse()

    let payload
    const portion = bn(quantity).dividedBy(data.orderCount)
    const shard = bn(portion)
      .dividedBy(data.orderCount + 1)
      .toString()

    if (data.dist === 'asc' || data.dist === 'desc') {
      const multiples = _.range(2, data.orderCount * 2 + 2, 2)
      let quantities = multiples.map(multiple =>
        parseFloat(
          bn(multiple)
            .multipliedBy(shard)
            .fix(this.ei.precision.quantity)
        )
      )
      if (data.isSell) {
        if (data.dist === 'asc') {
          quantities = quantities.reverse()
        }
      } else {
        if (data.dist === 'desc') {
          quantities = quantities.reverse()
        }
      }

      payload = _.zip(_.range(1, data.orderCount + 1), prices, quantities)
    }

    if (data.dist === 'equal') {
      let quantities = Array(data.orderCount).fill(portion.fix(this.ei.precision.quantity))

      payload = _.zip(_.range(1, data.orderCount + 1), prices, quantities)

      const quoteTotal = payload.reduce((acc, curr) => {
        return bn(curr[index.price])
          .multipliedBy(curr[index.quantity])
          .plus(acc)
          .toString()
      }, 0)

      const quotePortion = bn(quoteTotal).dividedBy(data.orderCount)

      payload.forEach(o => {
        o[index.quantity] = bn(quotePortion)
          .dividedBy(o[index.price])
          .fix(this.ei.precision.quantity)
      })
    }

    // calculate costs

    payload.forEach(o => {
      o.push(
        bn(o[index.price])
          .multipliedBy(o[index.quantity])
          .fix(this.ei.precision.quote)
      )
    })

    return payload
  }

  // when calculating quantities based on a quote amount e.g. POLY quantity based off of BTC, an average base price is used (max+min)/2. once the order distribution is generated the final tally of the quote costs may differ from what was requested. this code adds or removes a certain amount of base quantity from the middle order to correct for this difference.
  errorCorrectQuantities(payload, quoteToSpend, quantity) {
    const line = payload[parseInt(payload.length / 2) - 1]
    const linePrice = line[index.price]
    const lineQty = line[index.quantity]

    if (quoteToSpend) {
      const totalCost = payload.reduce((acc, curr) => {
        return bn(acc).plus(curr[index.cost])
      }, 0)

      const diff = bn(quoteToSpend)
        .minus(totalCost)
        .toString()

      const remainsQty = bn(bn(diff).absoluteValue()).dividedBy(linePrice)

      if (diff > 0) {
        line[index.quantity] = bn(remainsQty)
          .plus(lineQty)
          .fix(this.ei.precision.quantity)
      } else {
        line[index.quantity] = bn(lineQty)
          .minus(remainsQty)
          .fix(this.ei.precision.quantity)
      }

      line[index.cost] = bn(line[index.price])
        .multipliedBy(line[index.quantity])
        .fix(this.ei.precision.quote)
    } else {
      const totalQuantity = payload.reduce((acc, curr) => {
        return bn(acc).plus(curr[index.quantity])
      }, 0)

      const diff = bn(quantity)
        .minus(totalQuantity)
        .toString()

      if (diff < 0 || diff > 0) {
        line[index.quantity] = bn(lineQty)
          .plus(diff)
          .fix(this.ei.precision.quantity)

        line[index.cost] = bn(line[index.price])
          .multipliedBy(line[index.quantity])
          .fix(this.ei.precision.quote)
      }
    }
  }

  async validateOrders(payload, data) {
    let hasError = false
    await async.eachSeries(payload, async o => {
      const price = o[index.price]
      const quantity = o[index.quantity]
      let error = ''

      if (!this.ei.validate.value(price, quantity)) {
        error = `Cost too small, min = ${this.ei.notional.min} `
      }
      if (!this.ei.validate.quantity(quantity)) {
        error = `Quantity out of range ${this.ei.quantity.min}-${this.ei.quantity.max} `
      }
      if (!this.ei.validate.price(price)) {
        error = `Price out of range ${this.ei.price.min}-${this.ei.price.max} `
      }
      // calculate iceberg
      const iceburgQty = data.opts.iceberg
        ? bn(quantity)
            .multipliedBy(0.95)
            .toFixedDown(this.ei.precision.quantity)
        : 0

      if (error) {
        o[index.validation] = `${chalk.bold.red('✖')} ${chalk.bold.red(error)}`
        hasError = true
      } else {
        // test order
        const res = await binance.testOrder(
          data.pair,
          data.side,
          idable(8, false),
          quantity,
          iceburgQty,
          price,
          data.opts
        )

        if (res.success) {
          o[index.validation] = `${chalk.bold.green('✔')}`
        } else {
          o[index.validation] = `${chalk.bold.red('✖')} ${chalk.bold.red(res.msg)}`
          hasError = true
        }
      }
    })
    return !hasError
  }

  async displayData(data, payload, balances, quantity, currentPrice) {
    const display = [[`Current price`, `${currentPrice} ${data.quote}`]]

    if (data.isSpread) {
      const spreadWidth = bn(data.max)
        .minus(data.min)
        .fix(this.ei.precision.price)

      const spreadWidthPercent = bn(spreadWidth)
        .dividedBy(data.max)
        .multipliedBy(100)
        .absoluteValue()
        .toFixed(0)

      const avgPrice = bn(data.max)
        .plus(data.min)
        .dividedBy(2)
        .toString()

      let distance = bn(currentPrice)
        .minus(avgPrice)
        .dividedBy(currentPrice)
        .multipliedBy(100)
        .toFixed(2)
        .toString()

      if (data.isSell) {
        distance = bn(avgPrice)
          .minus(currentPrice)
          .dividedBy(avgPrice)
          .multipliedBy(100)
          .toFixed(2)
          .toString()
      }

      display.push([
        `${Case.capital(data.side)} price range`,
        `${data.min} - ${data.max} ${data.quote} (${spreadWidthPercent}%)`
      ])
      display.push([`${Case.capital(data.side)} distance`, `${distance}% from current`])
    } else {
      const distance = bn(data.price)
        .minus(currentPrice)
        .absoluteValue()
        .toString()

      display.push([`${Case.capital(data.side)} price`, `${data.price} ${data.quote}`])
      display.push([`${Case.capital(data.side)} distance`, `${distance}% from current`])
    }

    if (data.isLater) {
      const triggerDistance = bn(currentPrice)
        .minus(data.trigger)
        .absoluteValue()
        .dividedBy(currentPrice)
        .multipliedBy(100)
        .toFixed(2)
        .toString()

      display.push([`Trigger price`, `${data.trigger} ${data.quote}`])
      display.push([`Trigger distance`, `${triggerDistance}% from current`])
    }

    log.log()
    log.log(asTable(colorizeColumns(display)))
    log.log()

    const orderTable = [
      [chalk.whiteBright('#'), 'Price', 'Quantity', 'Cost', chalk.white(' ')],
      ...addQuoteSuffix(payload, data.quote)
    ]
    log.log(`ORDERS`)
    log.log()
    log.log(asTable(orderTable))
    log.log()

    const totalCost = payload.reduce((acc, curr) => {
      return bn(acc).plus(curr[index.cost])
    }, 0)

    const totalQuantity = payload.reduce((acc, curr) => {
      return bn(acc).plus(curr[index.quantity])
    }, 0)

    let quoteTotal = `${totalCost} ${data.quote}`

    const totals = []

    if (data.isSell) {
      const percent = bn(totalQuantity)
        .dividedBy(balances.base)
        .times(100)
        .toFixed(0)

      totals.push([`${data.base} balance`, `${balances.base} ${data.base}`])
      totals.push([
        `${data.base} to ${Case.lower(data.side)}`,
        `${totalQuantity} ${data.base} (${percent}%)`
      ])
      totals.push([`${data.quote} to receive`, quoteTotal])
    } else {
      const percent = bn(totalCost)
        .dividedBy(balances.quote)
        .times(100)
        .toFixed(0)

      totals.push([`${data.quote} balance`, `${balances.quote} ${data.quote}`])
      totals.push([`${data.quote} to spend`, `${quoteTotal} (${percent}%)`])
      totals.push([`${data.base} to ${Case.lower(data.side)}`, `${quantity} ${data.base}`])
    }

    log.log()
    log.log(asTable(colorizeColumns(totals)))
    log.log()
  }

  async create(payload, data) {
    await async.eachSeries(payload, async o => {
      // calculate iceberg
      const iceburgQty = data.opts.iceberg
        ? bn(o[index.quantity])
            .multipliedBy(0.95)
            .toFixedDown(this.ei.precision.quantity)
        : 0

      // create order
      const { ticket, result } = await binance.createOrder(
        data.pair,
        data.side,
        idable(8, false),
        o[index.quantity],
        iceburgQty,
        o[index.price],
        data.opts
      )

      db.recordOrderHistory({
        timestamp: timestamp(),
        ticket,
        result
      })
    })
  }
}

export default new LimitCommand()
