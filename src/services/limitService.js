import prompts from 'prompts'
import _ from 'lodash'
import async from 'awaitable-async'
import asTable from 'as-table'
import idable from 'idable'
import chalk from 'chalk'
import Case from 'case'

import db from '../db'
import binanceAccounts from '../binance'
import { bn, colorizeColumns, timestamp, fix } from '../util'
import { log } from '../logger'

class LimitService {
  constructor() {
    this.binance = null
    this.ei = null
  }

  async init(account) {
    this.binance = await binanceAccounts.get(account)
  }

  async start(data) {
    // get binance data
    this.ei = await this.binance.getExchangeInfo(data.pair)

    const { balances, currentPrice } = await this.binance.getPairState(data.pair)

    if (!currentPrice) {
      return
    }

    // check for iceberg limitation

    if (!this.ei.iceberg.allowed && data.opts.iceberg) {
      log.warn('Iceberg orderCount not allowed on this asset.')
      data.opts.iceberg = false
    }

    // calculate quantity for sale

    const { quantity, quoteToSpend } = data.isSell
      ? await this.calculateQuantityforSell(balances, data)
      : await this.calculateQuantityforBuy(balances, data)

    // create the payload

    const payload = await this.createPayload(quantity, data)

    if (data.isSpread) {
      this.errorCorrectQuantities(payload, quoteToSpend, quantity)
    }

    // validate payload

    const valid = await this.validateOrders(payload, data)

    // display data to user

    this.displayData(data, payload, balances, quantity, currentPrice)

    if (!valid) {
      return
    }

    let res = await prompts({
      type: 'confirm',
      name: 'correct',
      message: 'Create orders?'
    })

    if (res.correct) {
      this.create(payload, data)    
    }
  }

  async calculateQuantityforBuy(balances, data) {
    if (data.qtyType === 'base') {
      return {
        quantity: data.qtyValue,
        quoteToSpend: null
      }
    }

    if (data.qtyType === 'quote' || data.qtyType === 'percent-quote') {
      let quoteToSpend = data.qtyValue

      if (data.qtyType === 'percent-quote') {
        quoteToSpend = bn(balances.quote)
          .multipliedBy(data.qtyValue)
          .dividedBy(100)
          .toString()
      }

      const avgPrice = data.isSpread
        ? bn(data.max)
            .plus(data.min)
            .dividedBy(2)
            .toString()
        : data.price

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

    if (data.qtyType === 'percent-base') {
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

      const avgPrice = data.isSpread
        ? bn(data.max)
            .plus(data.min)
            .dividedBy(2)
            .toString()
        : data.price

      const quantity = bn(quoteToSpend)
        .dividedBy(avgPrice)
        .fix(this.ei.precision.quantity)

      return {
        quantity,
        quoteToSpend: fix(quoteToSpend, this.ei.precision.quote)
      }
    }
  }

  async createPayload(quantity, data) {
    // if not spread create a one order payload

    if (!data.isSpread) {
      return [
        {
          num: 1,
          price: data.price,
          quantity,
          cost: bn(data.price)
            .multipliedBy(quantity)
            .fix(this.ei.precision.quote),
          icebergSize: data.opts.iceberg
            ? bn(this.ei.iceberg.qty(quantity))
                .multipliedBy(data.price)
                .fix(this.ei.precision.price)
            : undefined,
          icebergQty: data.opts.iceberg
            ? bn(this.ei.iceberg.qty(quantity)).fix(this.ei.precision.price)
            : undefined
        }
      ]
    }

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
      payload = _.zipWith(
        _.range(1, data.orderCount + 1),
        prices,
        quantities,
        (num, price, quantity) => {
          return {
            num,
            price,
            quantity
          }
        }
      )
    }

    if (data.dist === 'equal') {
      let quantities = Array(data.orderCount).fill(portion.fix(this.ei.precision.quantity))

      payload = _.zipWith(
        _.range(1, data.orderCount + 1),
        prices,
        quantities,
        (num, price, quantity) => {
          return {
            num,
            price,
            quantity
          }
        }
      )

      const quoteTotal = payload.reduce((acc, o) => {
        return bn(o.price)
          .multipliedBy(o.quantity)
          .plus(acc)
          .toString()
      }, 0)

      const quotePortion = bn(quoteTotal).dividedBy(data.orderCount)

      payload.forEach(o => {
        o.quantity = bn(quotePortion)
          .dividedBy(o.price)
          .fix(this.ei.precision.quantity)
      })
    }

    payload.forEach(o => {
      // add in costs
      o.cost = bn(o.price)
        .multipliedBy(o.quantity)
        .fix(this.ei.precision.quote)

      // add in iceberg
      o.icebergSize = data.opts.iceberg
        ? bn(this.ei.iceberg.qty(o.quantity))
            .multipliedBy(o.price)
            .fix(this.ei.precision.price)
        : undefined

      o.icebergQty = data.opts.iceberg
        ? bn(this.ei.iceberg.qty(o.quantity)).fix(this.ei.precision.price)
        : undefined
    })

    return payload
  }

  // when calculating quantities based on a quote amount e.g. POLY quantity based off of BTC, an average base price is used (max+min)/2. once the order distribution is generated the final tally of the quote costs may differ from what was requested. this code adds or removes a certain amount of base quantity from the middle order to correct for this difference.
  errorCorrectQuantities(payload, quoteToSpend, quantity) {
    const line = payload[parseInt(payload.length / 2) - 1]
    const linePrice = line.price
    const lineQty = line.quantity

    if (quoteToSpend) {
      const totalCost = payload.reduce((acc, curr) => {
        return bn(acc).plus(curr.cost)
      }, 0)

      const diff = bn(quoteToSpend)
        .minus(totalCost)
        .toString()

      const remainsQty = bn(bn(diff).absoluteValue()).dividedBy(linePrice)

      if (diff > 0) {
        line.quantity = bn(remainsQty)
          .plus(lineQty)
          .fix(this.ei.precision.quantity)
      } else {
        line.quantity = bn(lineQty)
          .minus(remainsQty)
          .fix(this.ei.precision.quantity)
      }

      line.cost = bn(line.price)
        .multipliedBy(line.quantity)
        .fix(this.ei.precision.quote)
    } else {
      const totalQuantity = payload.reduce((acc, o) => {
        return bn(acc).plus(o.quantity)
      }, 0)

      const diff = bn(quantity)
        .minus(totalQuantity)
        .toString()

      if (diff < 0 || diff > 0) {
        line.quantity = bn(lineQty)
          .plus(diff)
          .fix(this.ei.precision.quantity)

        line.cost = bn(line.price)
          .multipliedBy(line.quantity)
          .fix(this.ei.precision.quote)
      }
    }
  }

  async validateOrders(payload, data) {
    let hasError = false
    await async.eachSeries(payload, async o => {
      let error = ''

      if (!this.ei.validate.value(o.price, o.quantity)) {
        error = `Cost too small, min = ${this.ei.notional.min} `
      }
      if (!this.ei.validate.quantity(o.quantity)) {
        error = `Quantity out of range ${this.ei.quantity.min}-${this.ei.quantity.max} `
      }
      if (!this.ei.validate.price(o.price)) {
        error = `Price out of range ${this.ei.price.min}-${this.ei.price.max} `
      }
      if (data.opts.iceberg) {
        if (!this.ei.validate.price(o.price)) {
          error = `Price out of range ${this.ei.price.min}-${this.ei.price.max} `
        }
      }

      if (error) {
        o.validation = `${chalk.bold.red('✖')} ${chalk.bold.red(error)}`
        hasError = true
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

      const distance = data.isSell
        ? bn(avgPrice)
            .minus(currentPrice)
            .dividedBy(avgPrice)
            .multipliedBy(100)
            .toFixed(2)
            .toString()
        : bn(currentPrice)
            .minus(avgPrice)
            .dividedBy(currentPrice)
            .multipliedBy(100)
            .toFixed(2)
            .toString()

      display.push([
        `${Case.capital(data.side)} price range`,
        `${data.min} - ${data.max} ${data.quote} (${spreadWidthPercent}%)`
      ])
      display.push([`${Case.capital(data.side)} distance`, `${distance}% from current`])
    } else {
      const distance = data.isSell
        ? bn(data.price)
            .minus(currentPrice)
            .dividedBy(data.price)
            .multipliedBy(100)
            .toFixed(2)
            .toString()
        : bn(currentPrice)
            .minus(data.price)
            .dividedBy(currentPrice)
            .multipliedBy(100)
            .toFixed(2)
            .toString()

      display.push([`${Case.capital(data.side)} price`, `${data.price} ${data.quote}`])
      display.push([`${Case.capital(data.side)} distance`, `${distance}% from current`])
    }    

    log.log()
    log.log(asTable(colorizeColumns(display)))
    log.log()

    const displayTable = [
      [
        '#',
        'Price',
        '',
        'Quantity',
        '',
        'Cost',
        data.opts.iceberg ? 'Iceberg Size' : '',
        chalk.white(' ')
      ],
      ...payload.map(o => {
        return [
          `${o.num}`,
          `${o.price} ${data.quote}`,
          `x`,
          o.quantity,
          '=',
          `${o.cost} ${data.quote}`,
          data.opts.iceberg ? `(${o.icebergSize} ${data.quote})` : '',
          o.validation
        ]
      })
    ]

    log.log(`ORDERS`)
    log.log()
    log.log(asTable(displayTable))
    log.log()

    const totalCost = fix(
      payload.reduce((acc, curr) => {
        return bn(acc).plus(curr.cost)
      }, 0),
      this.ei.precision.quote
    )

    const totalQuantity = fix(
      payload.reduce((acc, curr) => {
        return bn(acc).plus(curr.quantity)
      }, 0),
      this.ei.precision.quantity
    )

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
      // create order
      const { ticket, result } = await this.binance.createOrder(
        data.pair,
        data.side,
        idable(6, false),
        o.quantity,
        o.icebergQty,
        o.price,
        data.opts
      )

      await db.recordOrderHistory({
        timestamp: timestamp(),
        ticket,
        result
      })
    })
  }
}

export default LimitService
