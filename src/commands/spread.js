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

class Spread {
  constructor() {
    this.ei = null
  }
  async start(data) {
    // data passed in from asker

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

    // default order to 10 orderCount
    data.orderCount = parseInt(data.orderCount) || 10
    if (data.orderCount < 2) {
      log.error('<orderCount> must be > 1')
      return
    }

    const direction = data.trigger < currentPrice ? '<' : '>'

    // calculate distance / spread

    const avgPrice = bn(data.max)
      .plus(data.min)
      .dividedBy(2)
      .toString()

    const distance = bn(currentPrice)
      .minus(avgPrice)
      .dividedBy(currentPrice)
      .multipliedBy(100)
      .toFixed(2)
      .toString()

    const spreadWidth = bn(data.max)
      .minus(data.min)
      .fix(this.ei.precision.price)

    const spreadWidthPercent = bn(spreadWidth)
      .dividedBy(data.max)
      .absoluteValue()
      .toFixed(2)

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

    // calculate quantity distribution

    const { quantity, quoteToSpend } = data.isSell
      ? await this.calculateQuantityforSell(balances, data)
      : await this.calculateQuantityforBuy(balances, data)

    const multiples = _.range(2, data.orderCount * 2 + 2, 2)
    const portion = bn(quantity).dividedBy(data.orderCount)
    const unit = bn(portion)
      .dividedBy(data.orderCount + 1)
      .toString()

    let quantities = multiples.map(r =>
      parseFloat(
        bn(r)
          .multipliedBy(unit)
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
    if (data.dist === 'equal') {
      quantities = Array(data.orderCount).fill(portion.fix(this.ei.precision.quantity))
    }

    const payload = _.zip(_.range(1, data.orderCount + 1), prices, quantities)

    // calculate costs

    payload.forEach(o => {
      o.push(
        bn(o[index.price])
          .multipliedBy(o[index.quantity])
          .fix(this.ei.precision.quote)
      )
    })

    // error correct payload quantities

    this.errorCorrectQuantities(payload, quoteToSpend, data)

    // validate orders with binance

    const valid = await this.validateOrders(payload, data)

    // start data display

    const details = [
      [`Current price`, `${currentPrice} ${data.quote}`],
      ['Spread width', `${spreadWidth} ${data.quote} (${spreadWidthPercent}%)`],
      [`${Case.capital(data.side)} Distance`, `${distance}% from current`]
    ]

    if (data.spread) {
      details.push([`Min ${Case.lower(data.side)} price`, `${data.min} ${data.quote}`])

      details.push([`Max ${Case.lower(data.side)} price`, `${data.max} ${data.quote}`])
    }

    if (data.trigger) {
      const triggerDistance = bn(currentPrice)
        .minus(data.trigger)
        .absoluteValue()
        .dividedBy(currentPrice)
        .multipliedBy(100)
        .toFixed(2)
        .toString()

      details.push([`Trigger distance`, `${triggerDistance}% from current`])
    }

    log.log()
    log.log(asTable(colorizeColumns(details)))
    log.log()

    // display orders

    log.log(`ORDERS`)
    log.log()
    log.log(
      asTable([
        [chalk.whiteBright('#'), 'Price', 'Quantity', 'Cost', chalk.white(' ')],
        ...addQuoteSuffix(payload, data.quote)
      ])
    )
    log.log()

    const totalCost = payload.reduce((acc, curr) => {
      return bn(acc).plus(curr[index.cost])
    }, 0)

    // display totals

    let quoteTotal = `${totalCost} ${data.quote}`
    if (!data.isSell) {
      const percent = bn(totalCost)
        .dividedBy(balances.quote)
        .times(100)
        .toFixed(0)
        .toString()

      quoteTotal += ` (${percent}%)`
    }

    const totals = [
      [`${data.base} to ${Case.lower(data.side)}`, `${quantity} ${data.base}`],
      [`${data.quote} to ${data.isSell ? 'recthis.eive' : 'spend'}`, quoteTotal]
    ]

    if (data.isSell) {
      totals.unshift([`${data.base} balance`, `${balances.base} ${data.base}`])
    } else {
      totals.push([`${data.quote} balance`, `${balances.quote} ${data.quote}`])
    }

    log.log()
    log.log(asTable(colorizeColumns(totals)))
    log.log()

    // display prompt

    if (!valid) {
      return
    }

    if (data.trigger) {
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
        this.execute(payload, data)
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

  // when calculating quantities based on a quote amount e.g. POLY quantity based off of BTC, an average base price is used (max+min)/2. once the order distribution is generated the final tally of the quote costs may differ from what was requested. this code adds or removes a certain amount of base quantity from the largest order to correct for this difference.
  errorCorrectQuantities(payload, quoteToSpend, data) {
    if (!quoteToSpend) {
      return
    }

    const totalCost = payload.reduce((acc, curr) => {
      return bn(acc).plus(curr[index.cost])
    }, 0)

    const diff = bn(quoteToSpend)
      .minus(totalCost)
      .toString()

    let line, newQty

    if (data.isSell) {
      if (data.dist === 'desc') {
        line = payload[payload.length - 1]
      } else {
        line = payload[0]
      }
    } else {
      if (data.dist === 'asc') {
        line = payload[payload.length - 1]
      } else {
        line = payload[0]
      }
    }

    const linePrice = line[index.price]
    const lineQty = line[index.quantity]
    const remainsQty = bn(bn(diff).absoluteValue()).dividedBy(linePrice)

    if (diff > 0) {
      newQty = bn(remainsQty)
        .plus(lineQty)
        .fix(this.ei.precision.quantity)
    } else {
      newQty = bn(lineQty)
        .minus(remainsQty)
        .fix(this.ei.precision.quantity)
    }
    line[index.quantity] = newQty

    line[index.cost] = bn(line[index.price])
      .multipliedBy(line[index.quantity])
      .fix(this.ei.precision.quote)
    /*
    log.debug('')
    log.debug('diff', diff)
    log.debug('dist', data.dist)
    log.debug('quantity', quoteToSpend)
    log.debug('quoteToSpend', quoteToSpend)
    log.debug('totalCost', totalCost.toString())
    log.debug('linePrice', linePrice)
    log.debug('lineQty', lineQty)
    log.debug('remainsQty', remainsQty.toString())
    log.debug('newQty', newQty)
    */
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

  async execute(payload, data) {
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
        'BUY',
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

export default new Spread()
