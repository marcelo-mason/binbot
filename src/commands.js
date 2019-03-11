import db from './db'
import binance from './binance'
import forever from 'forever-monitor'
import prompts from 'prompts'
import colors from 'colors'
import BigNumber from 'bignumber.js'
import asTable from 'as-table'

class Commands {
  async start() {
    const ok = await binance.sync()
    if (!ok) {
      return
    }

    new forever.Monitor('./src/loaders/monitor.js', {
      max: 10000
    })
      .on('restart', () => {
        console.log('* binbot has restarted')
      })
      .start()
  }

  async sell(base, quote, triggerPrice, sellPrice, percentage, deferPercentage) {
    const pair = `${base}${quote}`
    const currentPrice = await binance.tickerPrice(pair)
    const baseBalance = await binance.balance('KNC')

    if (!currentPrice || !baseBalance) {
      return
    }

    const triggerDirection = triggerPrice < currentPrice ? '>' : '<'
    const baseAmount = baseBalance * (percentage / 100)

    const triggerDistance = new BigNumber(currentPrice)
      .minus(triggerPrice)
      .dividedBy(currentPrice)
      .absoluteValue()
      .multipliedBy(100)
      .toFixed(1)
      .toString()

    // prompt

    const info = asTable([
      [`Current price`, `${currentPrice} ${quote}`],
      [`Trigger price`, `${triggerPrice} ${quote}`],
      [`Distance`, `${triggerDistance}%`],
      ['', ''],
      [`Free ${base} balance`, baseBalance],
      [`Percent to sell`, `${percentage}%`],
      [`Amount to sell`, deferPercentage ? 'tbd' : baseAmount]
    ])
    console.log()
    console.log(info)

    let verbal
    if (deferPercentage) {
      verbal = `When the price of ${base} reaches ${triggerPrice} ${quote} set a limit-sell order for ${percentage}% of your ${base} at the time at ${sellPrice}`
    } else {
      verbal = `When the price of ${base} reaches ${triggerPrice} ${quote} set a limit-sell order for ${baseAmount} ${base} at ${sellPrice} ${quote}`
    }

    console.log(colors.yellow(`\n${verbal}\n`))

    let res = await prompts({
      type: 'confirm',
      name: 'correct',
      message: 'Save order?'
    })

    if (res.correct) {
      db.addSell(
        base,
        quote,
        triggerPrice,
        triggerDirection,
        sellPrice,
        percentage,
        deferPercentage
      )
    }
  }

  list() {}
}

export default new Commands()
