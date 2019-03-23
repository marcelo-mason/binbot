import prompts from 'prompts'
import chalk from 'chalk'
import BigNumber from 'bignumber.js'
import asTable from 'as-table'

import db from '../db'
import binance from '../binance'
import { log } from '../logger'

export default async function triggerSell(base, quote, trigger, price, percentage, opts) {
  const pair = `${base}${quote}`
  const currentPrice = await binance.tickerPrice(pair)
  let freeBalance = await binance.balance(base)

  if (!currentPrice || !freeBalance) {
    return
  }

  const ei = await binance.getExchangeInfo(pair)

  if (!ei.icebergAllowed && opts.iceberg) {
    console.log('Iceberg orders not allowed on this asset, disabling.')
    opts.iceberg = false
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

  const direction = trigger < currentPrice ? '<' : '>'
  const quantity = new BigNumber(freeBalance)
    .multipliedBy(percentage)
    .dividedBy(100)
    .toString()

  const triggerDistance = new BigNumber(currentPrice)
    .minus(trigger)
    .absoluteValue()
    .dividedBy(currentPrice)
    .multipliedBy(100)
    .toFixed(2)
    .toString()

  const sellDistance = new BigNumber(trigger)
    .minus(price)
    .absoluteValue()
    .dividedBy(trigger)
    .multipliedBy(100)
    .toFixed(2)
    .toString()

  // craft prompt

  const info = asTable([
    [`Current price`, `${currentPrice} ${quote}`],
    [`Trigger price`, `${trigger} ${quote}`],
    [`Sell price`, `${price} ${quote}`],
    ['', ''],
    [`Trigger distance`, `${triggerDistance}% from current`],
    [`Sell distance`, `${sellDistance}% from trigger`],
    ['', ''],
    [`Free ${base} balance`, freeBalance],
    [
      opts.deferPercentage ? `Percent to sell` : `Quantity to sell`,
      opts.deferPercentage ? `${percentage}%` : quantity
    ],
    [
      `Options`,
      [
        opts.deferPercentage ? 'defer %' : '',
        opts.cancelStops ? 'cancel stops' : '',
        opts.iceberg ? 'iceberg' : '',
        opts.makerOnly ? 'maker only' : ''
      ]
        .filter(Boolean)
        .join(', ')
    ]
  ])

  log.log()
  log.log(info)

  let verb = direction === '>' ? 'reaches' : 'falls below'
  let maker = opts.makerOnly ? ',maker only ' : ''
  let defer = opts.deferPercentage ? `${percentage}% of your ` : `${quantity} `

  let verbal = `When the price of ${base} ${verb} ${trigger} ${quote} set a trigger-sell order for ${defer}${base} at ${price} ${quote}${maker}`

  log.log(chalk.yellow(`\n${verbal}\n`))

  let res = await prompts({
    type: 'confirm',
    name: 'correct',
    message: 'Confirm order?'
  })

  // add order to database

  const state = {
    distance: 0,
    currentPrice: 0
  }

  if (res.correct) {
    db.addOrder(
      base,
      quote,
      'SELL',
      trigger,
      direction,
      price,
      opts.deferPercentage ? 'tbd' : quantity,
      percentage,
      state,
      opts
    )
  }
}
