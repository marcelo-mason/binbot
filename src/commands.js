import db from './db'
import binance from './binance'
import prompts from 'prompts'
import colors from 'colors'
import BigNumber from 'bignumber.js'
import asTable from 'as-table'
import { log } from './logger'
import monitor from './monitor'

class Commands {
  async monitor() {
    const ok = await binance.sync()
    if (!ok) {
      return
    }
    monitor.start()
  }

  async sell(base, quote, triggerPrice, price, percentage, opts) {
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

    const direction = triggerPrice < currentPrice ? '<' : '>'
    const quantityForSale = new BigNumber(freeBalance)
      .multipliedBy(percentage)
      .dividedBy(100)
      .toString()

    const triggerDistance = new BigNumber(currentPrice)
      .minus(triggerPrice)
      .absoluteValue()
      .dividedBy(currentPrice)
      .multipliedBy(100)
      .toFixed(2)
      .toString()

    const sellDistance = new BigNumber(triggerPrice)
      .minus(price)
      .absoluteValue()
      .dividedBy(triggerPrice)
      .multipliedBy(100)
      .toFixed(2)
      .toString()

    // craft prompt

    const info = asTable([
      [`Current price`, `${currentPrice} ${quote}`],
      [`Trigger price`, `${triggerPrice} ${quote}`],
      [`Sell price`, `${price} ${quote}`],
      ['', ''],
      [`Trigger distance`, `${triggerDistance}% from current`],
      [`Sell distance`, `${sellDistance}% from trigger`],
      ['', ''],
      [`Free ${base} balance`, freeBalance],
      [`Percent to sell`, `${percentage}%`],
      [`Quantity to sell`, opts.deferPercentage ? 'tbd' : quantityForSale]
    ])
    log.log()
    log.log(info)

    let verb = direction === '>' ? 'reaches' : 'falls below'
    let noStops = opts.cancelStops ? 'cancel existing stops and ' : ''
    let iceberg = opts.icebergOrder ? 'iceberg ' : ''
    let maker = opts.makerOnly ? ',maker only ' : ''
    let defer = opts.deferPercentage ? `${percentage}% of your ` : `${quantityForSale} `

    let verbal = `When the price of ${base} ${verb} ${triggerPrice} ${quote} ${noStops}set a limit-sell ${iceberg}order for ${defer}${base} at ${price} ${quote}${maker}`

    log.log(colors.yellow(`\n${verbal}\n`))

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
        triggerPrice,
        direction,
        price,
        opts.deferPercentage ? 'tbd' : quantityForSale,
        percentage,
        state,
        opts
      )
    }
  }

  async buy(base, quote, triggerPrice, price, quantity, opts) {
    const pair = `${base}${quote}`
    const currentPrice = await binance.tickerPrice(pair)

    if (!currentPrice) {
      return
    }

    const direction = triggerPrice < currentPrice ? '<' : '>'

    const triggerDistance = new BigNumber(currentPrice)
      .minus(triggerPrice)
      .absoluteValue()
      .dividedBy(currentPrice)
      .multipliedBy(100)
      .toFixed(2)
      .toString()

    const buyDistance = new BigNumber(triggerPrice)
      .minus(price)
      .absoluteValue()
      .dividedBy(triggerPrice)
      .multipliedBy(100)
      .toFixed(2)
      .toString()

    // craft prompt

    const info = asTable([
      [`Current price`, `${currentPrice} ${quote}`],
      [`Trigger price`, `${triggerPrice} ${quote}`],
      [`Sell price`, `${price} ${quote}`],
      ['', ''],
      [`Trigger distance`, `${triggerDistance}% from current`],
      [`Buy distance`, `${buyDistance}% from trigger`],
      ['', ''],
      [`Quantity to buy`, opts.deferPercentage ? 'tbd' : quantity]
    ])
    log.log()
    log.log(info)

    let verb = direction === '>' ? 'reaches' : 'falls below'
    let noStops = opts.cancelStops ? 'cancel existing stops and ' : ''
    let iceberg = opts.icebergOrder ? 'iceberg ' : ''
    let maker = opts.makerOnly ? ',maker only ' : ''

    let verbal = `When the price of ${base} ${verb} ${triggerPrice} ${quote} ${noStops}set a limit-buy ${iceberg}order for ${quantity} ${base} at ${price} ${quote}${maker}`

    log.log(colors.yellow(`\n${verbal}\n`))

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
        triggerPrice,
        direction,
        price,
        opts.deferPercentage ? 'tbd' : quantity,
        null,
        state,
        opts
      )
    }
  }

  list() {}
}

export default new Commands()
