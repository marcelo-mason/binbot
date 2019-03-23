import prompts from 'prompts'
import colors from 'colors'
import BigNumber from 'bignumber.js'
import asTable from 'as-table'

import db from '../db'
import binance from '../binance'
import { log } from '../logger'

export default async function spreadSell(base, quote, min, max, percentage, orders, opts) {
  const pair = `${base}${quote}`
  const currentPrice = await binance.tickerPrice(pair)
  let freeBalance = await binance.balance(base)

  if (!currentPrice || !freeBalance) {
    return
  }

  if (opts.cancelStops) {
    const stops = await binance.getOpenStops(pair)
    if (stops) {
      // add the tokens locked in the stops to the freeBalance
      // since they will get freed once the stops are cancelled
      freeBalance = new BigNumber(freeBalance).plus(stops.totalQuantity).toString()

      // the cancelling happens later when it gets triggered
    }
  }

  const quantity = new BigNumber(freeBalance)
    .multipliedBy(percentage)
    .dividedBy(100)
    .toString()

  const sellDistance = new BigNumber(currentPrice)
    .minus(min)
    .absoluteValue()
    .dividedBy(currentPrice)
    .multipliedBy(100)
    .toFixed(2)
    .toString()

  const spreadWidth = new BigNumber(max)
    .minus(min)
    .absoluteValue()
    .toString()

  // craft prompt

  const info = asTable([
    [`Current price`, `${currentPrice} ${quote}`],
    ['Buy Distance', `${sellDistance}% from current`],
    ['Spread width', `${spreadWidth} ${quote}`],
    ['', ''],
    [`Free ${base} balance`, freeBalance],
    [`Quantity to sell`, quantity]
  ])
  log.log()
  log.log(info)

  let noStops = opts.cancelStops ? 'Cancel existing stops and create' : 'Create'
  let iceberg = opts.iceberg ? `${opts.iceberg}% iceberg ` : ''
  let maker = opts.makerOnly ? ',maker only ' : ''

  let verbal = `${noStops} ${orders} limit-sell ${iceberg}orders spread between ${min} ${base} and ${min} ${base}${maker}`

  log.log(colors.yellow(`\n${verbal}\n`))

  let res = await prompts({
    type: 'confirm',
    name: 'correct',
    message: 'Confirm order?'
  })

  // create orders

  if (res.correct) {
    await binance.createOrder(
      order.pair,
      order.side,
      order.id,
      order.quantity,
      order.price,
      order.opts
    )
  }
}
