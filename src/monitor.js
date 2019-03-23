import db from './db'
import binance from './binance'
import execute from 'controlled-schedule'
import async from 'awaitable-async'
import BigNumber from 'bignumber.js'
import { log } from './logger'
import ui from './ui'

class Monitor {
  async start() {
    this.listen()
  }

  async listen() {
    const grouped = await db.getOrdersGroupedByPair()

    await async.each(grouped, async ({ pair, orders }) => {
      await binance.ws.onTicker(pair, async ticker => {
        db.updateState(ticker)
        ui.update(grouped)

        async.each(orders, order => {
          const above = order.direction === '>' && ticker.currentClose >= order.triggerPrice
          const below = order.direction === '<' && ticker.currentClose <= order.triggerPrice
          if (above || below) {
            if (order.side === 'SELL') {
              this.triggerSell(order)
              log.sellTriggered(order, ticker)
            }
            if (order.side === 'BUY') {
              this.triggerBuy(order)
              log.buyTriggered(order, ticker)
            }
          }
        })
      })
    })

    const snipe = db.getSnipe()
    if (snipe) {
      /*
      execute(this.checkDealChanges.bind(this))
        .every('1s')
        .start() */

      await binance.ws.onTicker(snipe.pair, async ticker => {
        console.log(ticker)
      })
    }
  }

  async triggerSell(order) {
    if (order.opts.cancelStops) {
      await binance.cancelStops(order.pair)
    }

    if (order.opts.deferPercentage) {
      let freeBalance = await binance.balance(order.base)
      order.quantity = new BigNumber(freeBalance)
        .multipliedBy(order.percentage)
        .dividedBy(100)
        .toString()

      log.deferredCalculation(order, freeBalance)
    }

    await binance.createOrder(
      order.pair,
      order.side,
      order.id,
      order.quantity,
      order.price,
      order.opts
    )
  }

  async triggerBuy(order) {
    if (order.opts.cancelStops) {
      await binance.cancelStops(order.pair)
    }

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

export default new Monitor()
