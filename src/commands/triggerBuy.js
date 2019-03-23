import prompts from 'prompts'
import chalk from 'chalk'
import BigNumber from 'bignumber.js'
import asTable from 'as-table'

import db from '../db'
import binance from '../binance'
import { log } from '../logger'

export default async function triggerBuy(base, quote, trigger, price, quantity, opts) {
  const pair = `${base}${quote}`
  const currentPrice = await binance.tickerPrice(pair)

  if (!currentPrice) {
    return
  }

  const direction = trigger < currentPrice ? '<' : '>'

  const triggerDistance = new BigNumber(currentPrice)
    .minus(trigger)
    .absoluteValue()
    .dividedBy(currentPrice)
    .multipliedBy(100)
    .toFixed(2)
    .toString()

  const buyDistance = new BigNumber(trigger)
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
    [`Buy distance`, `${buyDistance}% from trigger`],
    ['', ''],
    [`Quantity to buy`, quantity],
    [
      `Options`,
      [opts.iceberg ? 'iceberg' : '', opts.makerOnly ? 'maker only' : ''].filter(Boolean).join(', ')
    ]
  ])
  log.log()
  log.log(info)

  let verb = direction === '>' ? 'reaches' : 'falls below'

  let verbal = `When the price of ${base} ${verb} ${trigger} ${quote} set a trigger-buy order for ${quantity} ${base} at ${price} ${quote}`

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
      'BUY',
      trigger,
      direction,
      price,
      opts.deferPercentage ? 'tbd' : quantity,
      null,
      state,
      opts
    )
  }
}
