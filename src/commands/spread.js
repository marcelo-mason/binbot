import prompts from 'prompts'
import _ from 'lodash'
import async from 'awaitable-async'
import asTable from 'as-table'
import idable from 'idable'
import chalk from 'chalk'
import Case from 'case'

import db from '../db'
import binance from '../binance'
import { bn, colorizeColumns, addQuoteSuffix, timestamp } from '../util'
import { log } from '../logger'

const index = {
  number: 0,
  price: 1,
  quantity: 2,
  cost: 3,
  validation: 4
}

export default async function spread(
  side,
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
  const isSell = side === 'SELL'

  const ei = await binance.getExchangeInfo(pair)
  if (!ei) {
    return
  }

  const quoteBalance = bn(await binance.balance(quote))

  const bal = await binance.balance(base)
  let baseBalance = bn(bal)
    .toFixedDown(ei.precision.quantity)
    .toString()

  let currentPrice = await binance.tickerPrice(pair)
  if (!currentPrice) {
    return
  }

  // fix inputted prices
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

  const avgPrice = bn(max)
    .plus(min)
    .dividedBy(2)
    .toString()

  const distance = bn(currentPrice)
    .minus(avgPrice)
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

  const { quantity, quoteToSpend } = isSell
    ? await calculateQuantityforSell(min, max, qtyType, qtyValue, ei, baseBalance)
    : await calculateQuantityforBuy(min, max, qtyType, qtyValue, ei, quoteBalance)

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
  if (isSell) {
    if (dist === 'asc') {
      quantities = quantities.reverse()
    }
  } else {
    if (dist === 'desc') {
      quantities = quantities.reverse()
    }
  }
  if (dist === 'equal') {
    quantities = Array(orderCount).fill(portion.toFixedDown(ei.precision.quantity).toString())
  }

  // generate payload w/ prices and quantities

  const payload = _.zip(_.range(1, orderCount + 1), prices, quantities)

  // add in costs

  payload.forEach(o => {
    o.push(
      bn(o[index.price])
        .multipliedBy(o[index.quantity])
        .toFixedDown(ei.precision.quote)
        .toString()
    )
  })

  // error correct payload quantities

  errorCorrectQuantities(payload, quoteToSpend, dist, ei, isSell)

  // validate orders with binance

  const valid = await validateOrders(payload, pair, side, opts, ei)

  // start data display

  const details = [
    [`Current price`, `${currentPrice} ${quote}`],
    [`Min ${Case.lower(side)} price`, `${min} ${quote}`],
    [`Max ${Case.lower(side)} price`, `${max} ${quote}`],
    ['Spread width', `${spreadWidth} ${quote} (${spreadWidthPercent}%)`],
    [`${Case.capital(side)} Distance`, `${distance}% from current`]
  ]

  log.log()
  log.log(asTable(colorizeColumns(details)))
  log.log()

  const list = asTable([
    [chalk.whiteBright('#'), 'Price', 'Quantity', 'Cost', chalk.white(' ')],
    ...addQuoteSuffix(payload, quote)
  ])

  log.log(`ORDERS`)
  log.log()
  log.log(list)
  log.log()

  const totalCost = payload.reduce((acc, curr) => {
    return bn(acc).plus(curr[index.cost])
  }, 0)

  let quoteTotal = `${totalCost} ${quote}`
  if (!isSell) {
    const percent = bn(totalCost)
      .dividedBy(quoteBalance)
      .times(100)
      .toFixed(0)
      .toString()

    quoteTotal += ` (${percent}%)`
  }

  const totals = [
    [`${base} to ${Case.lower(side)}`, `${quantity} ${base}`],
    [`${quote} to ${isSell ? 'receive' : 'spend'}`, quoteTotal]
  ]

  const baseDisplay = bn(baseBalance)
    .toFixedDown(ei.precision.base)
    .toString()

  const quoteDisplay = bn(quoteBalance)
    .toFixedDown(ei.precision.quote)
    .toString()

  if (isSell) {
    totals.unshift([`${base} balance`, `${baseDisplay} ${base}`])
  } else {
    totals.unshift([`${quote} balance`, `${quoteDisplay} ${quote}`])
  }

  log.log()
  log.log(asTable(colorizeColumns(totals)))
  log.log()

  // execute prompt

  if (!valid) {
    return
  }

  let res = await prompts({
    type: 'confirm',
    name: 'correct',
    message: 'Create orders?'
  })

  // create orders

  if (res.correct) {
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

      db.recordOrderHistory({
        timestamp: timestamp(),
        order,
        res
      })
    })
  }
}

async function calculateQuantityforBuy(min, max, qtyType, qtyValue, ei, quoteBalance) {
  if (qtyType === 'base') {
    return {
      quantity: qtyValue,
      quoteToSpend: null
    }
  }

  if (qtyType === 'quote' || qtyType === 'percent') {
    let quoteToSpend = qtyValue

    if (qtyType === 'percent') {
      quoteToSpend = bn(quoteBalance)
        .multipliedBy(qtyValue)
        .dividedBy(100)
        .toString()
    }

    const avgPrice = bn(max)
      .plus(min)
      .dividedBy(2)
      .toString()

    const quantity = bn(quoteToSpend)
      .dividedBy(avgPrice)
      .toFixedDown(ei.precision.quantity)
      .toString()

    return {
      quantity,
      quoteToSpend: bn(quoteToSpend)
        .toFixedDown(ei.precision.quote)
        .toString()
    }
  }
}

async function calculateQuantityforSell(min, max, qtyType, qtyValue, ei, baseBalance) {
  if (qtyType === 'base') {
    return {
      quantity: qtyValue,
      quoteToSpend: null
    }
  }

  if (qtyType === 'percent') {
    const quantity = bn(baseBalance)
      .multipliedBy(qtyValue)
      .dividedBy(100)
      .toFixedDown(ei.precision.quantity)
      .toString()

    return {
      quantity,
      quoteToSpend: null
    }
  }

  if (qtyType === 'quote') {
    let quoteToSpend = qtyValue

    const avgPrice = bn(max)
      .plus(min)
      .dividedBy(2)
      .toString()

    const quantity = bn(quoteToSpend)
      .dividedBy(avgPrice)
      .toFixedDown(ei.precision.quantity)
      .toString()

    return {
      quantity,
      quoteToSpend: bn(quoteToSpend)
        .toFixedDown(ei.precision.quote)
        .toString()
    }
  }
}

// when calculating quantities based on a quote amount e.g. POLY quantity based off of BTC, an average base price is used (max+min)/2. once the order distribution is generated the final tally of the quote costs may differ from what was requested. this code adds or removes a certain amount of base quantity from the largest order to correct for this difference.
function errorCorrectQuantities(payload, quoteToSpend, dist, ei, isSell) {
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

  if (isSell) {
    if (dist === 'desc') {
      line = payload[payload.length - 1]
    } else {
      line = payload[0]
    }
  } else {
    if (dist === 'asc') {
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
      .toFixedDown(ei.precision.quantity)
      .toString()
  } else {
    newQty = bn(lineQty)
      .minus(remainsQty)
      .toFixedDown(ei.precision.quantity)
      .toString()
  }
  line[index.quantity] = newQty

  line[index.cost] = bn(line[index.price])
    .multipliedBy(line[index.quantity])
    .toFixedDown(ei.precision.quote)
    .toString()

  log.debug('')
  log.debug('diff', diff)
  log.debug('dist', dist)
  log.debug('quantity', quoteToSpend)
  log.debug('quoteToSpend', quoteToSpend)
  log.debug('totalCost', totalCost.toString())
  log.debug('linePrice', linePrice)
  log.debug('lineQty', lineQty)
  log.debug('remainsQty', remainsQty.toString())
  log.debug('newQty', newQty)
}

async function validateOrders(payload, pair, side, opts, ei) {
  let hasError = false
  await async.eachSeries(payload, async o => {
    const price = o[index.price]
    const quantity = o[index.quantity]
    let error = ''

    if (!ei.validate.value(price, quantity)) {
      error = `Cost too small, min = ${ei.notional.min} `
    }
    if (!ei.validate.quantity(quantity)) {
      error = `Quantity out of range ${ei.quantity.min}-${ei.quantity.max} `
    }
    if (!ei.validate.price(price)) {
      error = `Price out of range ${ei.price.min}-${ei.price.max} `
    }
    // calculate iceberg
    const iceburgQty = opts.iceberg
      ? bn(quantity)
          .multipliedBy(0.95)
          .toFixedDown(ei.precision.quantity)
      : 0

    if (error) {
      o[index.validation] = `${chalk.bold.red('✖')} ${chalk.bold.red(error)}`
      hasError = true
    } else {
      // test order
      const res = await binance.testOrder(
        pair,
        side,
        idable(8, false),
        quantity,
        iceburgQty,
        price,
        opts
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
