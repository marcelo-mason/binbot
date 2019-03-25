import prompts from 'prompts'
import _ from 'lodash'
import async from 'awaitable-async'
import asTable from 'as-table'
import idable from 'idable'
import chalk from 'chalk'

import db from '../db'
import binance from '../binance'
import { bn, colorizeColumns, addQuoteSuffix } from '../util'
import { log } from '../logger'

const index = {
  number: 0,
  price: 1,
  quantity: 2,
  cost: 3,
  validation: 4
}
export default async function spreadBuy(
  base,
  quote,
  min,
  max,
  qtyType,
  qtyValue,
  dist,
  orderCount,
  opts
) {
  const pair = `${base}${quote}`

  const ei = await binance.getExchangeInfo(pair)
  if (!ei) {
    return
  }

  const quoteBalance = bn(await binance.balance(quote))

  let currentPrice = await binance.tickerPrice(pair)
  if (!currentPrice) {
    return
  }

  // fix price precision
  currentPrice = bn(currentPrice)
    .toFixedDown(ei.precision.price)
    .toString()
  min = bn(min)
    .toFixedDown(ei.precision.price)
    .toString()
  max = bn(max)
    .toFixedDown(ei.precision.price)
    .toString()

  // check for iceberg limitation
  if (!ei.icebergAllowed && opts.iceberg) {
    log.warn('Iceberg orderCount not allowed on this asset.')
    opts.iceberg = false
  }

  // default order to 10 orderCount
  orderCount = parseInt(orderCount) || 10
  if (orderCount < 2) {
    log.error('<orderCount> must be > 1')
    return
  }

  // calculate distance / spread

  const buyDistance = bn(currentPrice)
    .minus(max)
    .dividedBy(currentPrice)
    .multipliedBy(100)
    .toFixed(2)
    .toString()

  const spreadWidth = bn(max)
    .minus(min)
    .toFixedDown(ei.precision.price)
    .toString()

  const spreadWidthPercent = bn(spreadWidth)
    .dividedBy(max)
    .absoluteValue()
    .toFixed(2)
    .toString()

  const spreadDistance = bn(spreadWidth)
    .dividedBy(orderCount - 1)
    .toString()

  // calculate prices spread

  const prices = _.range(orderCount)
    .map(n => {
      const distance = bn(spreadDistance)
        .multipliedBy(n)
        .toString()
      return bn(min)
        .plus(distance)
        .toFixedDown(ei.precision.price)
        .toString()
    })
    .reverse()

  // calculate quantities spreads

  const { quantity, quoteToSpend } = await calculateQuantity(
    quote,
    min,
    max,
    qtyType,
    qtyValue,
    ei,
    quoteBalance
  )
  const multiples = _.range(2, orderCount * 2 + 2, 2)
  const portion = bn(quantity).dividedBy(orderCount)
  const unit = bn(portion)
    .dividedBy(orderCount + 1)
    .toString()

  let quantities = multiples.map(r =>
    parseFloat(
      bn(r)
        .multipliedBy(unit)
        .toFixedDown(ei.precision.quantity)
        .toString()
    )
  )
  if (dist === 'desc') {
    quantities = quantities.reverse()
  }
  if (dist === 'equal') {
    quantities = Array(orderCount).fill(portion.toFixedDown(ei.precision.quantity).toString())
  }

  const payload = _.zip(_.range(1, orderCount + 1), prices, quantities)

  // calculate costs

  payload.forEach(o => {
    o.push(
      bn(o[index.price])
        .multipliedBy(o[index.quantity])
        .toFixedDown(ei.precision.quote)
        .toString()
    )
  })

  // error correct quantities that are based on quote

  if (qtyType === 'percent' || qtyType === 'quote') {
    const totalCost = payload.reduce((acc, curr) => {
      return bn(acc).plus(curr[index.cost])
    }, 0)

    const diff = bn(quoteToSpend)
      .minus(totalCost)
      .toString()

    log.debug('diff', diff)
    log.debug('dist', dist)

    let line, newQty
    if (dist === 'asc') {
      line = payload[payload.length - 1]
    } else {
      line = payload[0]
    }

    const linePrice = line[index.price]
    const lineQty = line[index.quantity]
    const remainsQty = bn(bn(diff).absoluteValue()).dividedBy(linePrice)

    /*
    log.debug('quantity', quoteToSpend)
    log.debug('quoteToSpend', quoteToSpend)
    log.debug('totalCost', totalCost.toString())
    log.debug('linePrice', linePrice)
    log.debug('lineQty', lineQty)
    log.debug('remainsQty', remainsQty.toString())
    */

    if (diff > 0) {
      newQty = bn(remainsQty)
        .plus(lineQty)
        .toFixedDown(ei.precision.quantity)
        .toString()
    } else {
      newQty = bn(lineQty)
        .minus(remainsQty)
        .toFixedDown(ei.precision.quantity)
        .toString()
    }

    log.debug('newQty', newQty)

    line[index.quantity] = newQty

    line[index.cost] = bn(line[index.price])
      .multipliedBy(line[index.quantity])
      .toFixedDown(ei.precision.quote)
      .toString()
  }

  // craft message

  const details = [
    [`Current price`, `${currentPrice} ${quote}`],
    [`Min buy price`, `${min} ${quote}`],
    [`Max buy price`, `${max} ${quote}`],
    ['Spread width', `${spreadWidth} ${quote} (${spreadWidthPercent}%)`],
    ['Buy Distance', `${buyDistance}% from current`]
  ]

  log.log()
  log.log(asTable(colorizeColumns(details)))
  log.log()

  // validate and add validation results to display

  await async.eachSeries(payload, async o => {
    const price = o[index.price]
    const quantity = o[index.quantity]
    let error = ''

    if (!ei.validate.quantity(quantity)) {
      error = `Quantity out of range (${ei.quantity.min}-${ei.quantity.max})`
    }
    if (!ei.validate.price(price)) {
      error = `Price out of range (${ei.price.min}-${ei.price.max})`
    }
    if (!ei.validate.value(price, quantity)) {
      error = `Cost too small (min ${ei.notional.min})`
    }

    // calculate iceberg
    const iceburgQty = opts.iceberg
      ? bn(quantity)
          .multipliedBy(0.95)
          .toFixedDown(ei.precision.quantity)
      : 0

    // test order
    const res = await binance.testOrder(
      pair,
      'BUY',
      idable(8, false),
      quantity,
      iceburgQty,
      price,
      opts
    )

    if (res.success) {
      o[index.validation] = `${chalk.bold.green('good ✔')}`
    } else {
      o[index.validation] = `${chalk.bold.red('failed ✖')} ${chalk.red(error || res.msg)}`
    }
  })

  const list = asTable([['#', 'Price', 'Quantity', 'Cost', ''], ...addQuoteSuffix(payload, quote)])

  log.log(`ORDERS:`)
  log.log()
  log.log(list)
  log.log()

  const totalCost = payload.reduce((acc, curr) => {
    return bn(acc).plus(curr[index.cost])
  }, 0)

  const percent = bn(totalCost)
    .dividedBy(quoteBalance)
    .times(100)
    .toFixed(0)
    .toString()

  const corrected = [
    [`${base} to buy`, `${quantity} ${base}`],
    [`${quote} to spend`, `${totalCost} ${quote} (${percent}%)`]
  ]

  log.log()
  log.log(asTable(colorizeColumns(corrected)))
  log.log()

  // execute prompt

  let res = await prompts({
    type: 'confirm',
    name: 'correct',
    message: 'Create orders?'
  })

  // create orderCount

  if (res.correct) {
    if (opts.cancelStops) {
      await binance.cancelStops(pair)
    }

    await async.eachSeries(payload, async o => {
      // calculate iceberg
      const iceburgQty = opts.iceberg
        ? bn(o[index.quantity])
            .multipliedBy(0.95)
            .toFixedDown(ei.precision.quantity)
        : 0

      // create order
      const { order, res } = await binance.createOrder(
        pair,
        'BUY',
        idable(8, false),
        o[index.quantity],
        iceburgQty,
        o[index.price],
        opts
      )

      db.recordHistory({
        order,
        res
      })
    })
  }
}

async function calculateQuantity(quote, min, max, qtyType, qtyValue, ei, quoteBalance) {
  if (qtyType === 'base') {
    return {
      quantity: qtyValue,
      quoteToSpend: null
    }
  }

  if (qtyType === 'quote') {
    const quoteToSpend = qtyValue

    const avgPrice = bn(max)
      .plus(min)
      .dividedBy(2)
      .toString()

    const quantity = bn(quoteToSpend)
      .dividedBy(avgPrice)
      .toFixed(ei.precision.quantity)
      .toString()

    return {
      quantity,
      quoteToSpend: bn(quoteToSpend)
        .toFixed(ei.precision.quote)
        .toString()
    }
  }

  if (qtyType === 'percent') {
    const quoteToSpend = bn(quoteBalance)
      .multipliedBy(qtyValue)
      .dividedBy(100)
      .toString()

    const avgPrice = bn(max)
      .plus(min)
      .dividedBy(2)
      .toString()

    const quantity = bn(quoteToSpend)
      .dividedBy(avgPrice)
      .toFixed(ei.precision.quantity)
      .toString()

    return {
      quantity,
      quoteToSpend: bn(quoteToSpend)
        .toFixed(ei.precision.quote)
        .toString()
    }
  }
}
