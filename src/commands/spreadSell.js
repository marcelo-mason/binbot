import prompts from 'prompts'
import _ from 'lodash'
import async from 'awaitable-async'
import asTable from 'as-table'
import idable from 'idable'
import chalk from 'chalk'

import db from '../db'
import binance from '../binance'
import { bn } from '../util'
import { log } from '../logger'

export default async function spreadSell(base, quote, min, max, percentage, orderCount, opts) {
  const pair = `${base}${quote}`

  const ei = await binance.getExchangeInfo(pair)
  if (!ei) {
    return
  }

  const bal = await binance.balance(base)
  let freeBalance = bn(bal)
    .toFixedDown(ei.precision.quantity)
    .toString()

  // log.info(ei)

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

  if (opts.cancelStops) {
    const stops = await binance.getOpenStops(pair)
    if (stops) {
      // add the tokens locked in the stops to the freeBalance
      // since they will get freed once the stops are cancelled
      freeBalance = bn(freeBalance)
        .plus(stops.totalQuantity)
        .toFixedDown(ei.precision.quantity)
        .toString()

      // the cancelling happens later when it gets triggered
    }
  }

  // default order to 10 orderCount
  orderCount = parseInt(orderCount) || 10
  if (orderCount < 2) {
    log.error('<orderCount> must be > 1')
    return
  }

  // calculate distance / spread

  const sellDistance = bn(currentPrice)
    .minus(min)
    .dividedBy(currentPrice)
    .multipliedBy(100)
    .toFixedDown(2)
    .toString()

  const spreadWidth = bn(max)
    .minus(min)
    .toFixedDown(ei.precision.price)
    .toString()

  const spreadWidthPercent = bn(spreadWidth)
    .dividedBy(max)
    .absoluteValue()
    .toFixedDown(2)
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

  const quantity = bn(freeBalance)
    .multipliedBy(percentage)
    .dividedBy(100)
    .toFixedDown(ei.precision.quantity)
    .toString()

  const portion = bn(quantity).dividedBy(orderCount)
  const unit = bn(portion)
    .dividedBy(orderCount + 1)
    .toString()
  const multiples = _.range(2, orderCount * 2 + 2, 2)
  let quantities = multiples.map(r =>
    parseFloat(
      bn(r)
        .multipliedBy(unit)
        .toFixedDown(ei.precision.quantity)
        .toString()
    )
  )
  if (opts.ascending) {
    quantities = quantities.reverse()
  }
  if (!opts.ascending && !opts.descending) {
    quantities = Array(orderCount).fill(portion.toFixedDown(ei.precision.quantity).toString())
  }

  const payload = _.zip(_.range(1, orderCount + 1), prices, quantities)

  const index = {
    number: 0,
    price: 1,
    quantity: 2,
    cost: 3,
    validation: 4
  }

  // calculate costs

  payload.forEach(o => {
    o.push(
      bn(o[index.price])
        .multipliedBy(o[index.quantity])
        .toFixedDown(ei.precision.quote)
        .toString()
    )
  })

  // craft prompt

  const info = asTable([
    [`Current price`, `${currentPrice} ${quote}`],
    [`Min sell price`, `${min} ${quote}`],
    [`Max sell price`, `${max} ${quote}`],
    ['Spread width', `${spreadWidth} ${quote} (${spreadWidthPercent}%)`],
    ['Sell Distance', `${sellDistance}% from current`],
    [`Free ${base} balance`, freeBalance],
    [`${base} to sell`, quantity],
    [
      `Options`,
      [
        opts.cancelStops ? 'cancel stops' : '',
        opts.iceberg ? `iceberg` : '',
        opts.makerOnly ? 'maker only' : '',
        opts.ascending ? `ascending` : '',
        opts.descending ? `descending` : ''
      ]
        .filter(Boolean)
        .join(', ')
    ]
  ])

  log.log()
  log.log(info)
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
      'SELL',
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

  const list = asTable([['#', 'Price', 'Quantity', 'Cost', ''], ...payload])

  log.log(`ORDERS:`)
  log.log()
  log.log(list)
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
        'SELL',
        idable(8, false),
        o[index.quantity],
        iceburgQty,
        o[index.price],
        opts
      )
    })
  }
}
