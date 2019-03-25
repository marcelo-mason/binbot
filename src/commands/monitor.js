import async from 'awaitable-async'
import { bn } from '../util'

import binance from '../binance'
import db from '../db'
import { log } from '../logger'
import ui from '../ui'

class Monitor {
  async start() {
    const ok = await binance.sync()
    if (!ok) {
      return
    }
    this.listen()
  }

  async listen() {
    const grouped = await db.getOrdersGroupedByPair()

    await async.each(grouped, async ({ pair, orders }) => {
      await binance.ws.onTicker(pair, async ticker => {
        db.updateState(ticker)
        ui.update(grouped)

        async.each(orders, order => {
          const above = order.direction === '>' && ticker.currentClose >= order.trigger
          const below = order.direction === '<' && ticker.currentClose <= order.trigger
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
  }

  async triggerSell(order) {
    if (order.opts.cancelStops) {
      await binance.cancelStops(order.pair)
    }

    if (order.opts.deferPercentage) {
      let freeBalance = await binance.balance(order.base)
      order.quantity = bn(freeBalance)
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
