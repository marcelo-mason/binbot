import async from 'awaitable-async'
import execute from 'controlled-schedule'
import _ from 'lodash'

import binance from '../binance'
import db from '../db'
import limit from './limit'
import ui from '../ui'

class Monitor {
  async start() {
    const ok = await binance.sync()
    if (!ok) {
      return
    }

    this.listeners = []

    execute(this.checkPairs.bind(this))
      .every('5s')
      .start()
  }

  async createListener(pair) {
    const ei = await binance.getExchangeInfo(pair)

    await binance.ws.onTicker(pair, async ticker => {
      const orders = await db.getTriggerOrders(pair)

      if (orders.length) {
        await db.updateTriggerOrderState(ticker, ei)
        ui.update(orders)

        await async.eachSeries(orders, async order => {
          const above = order.data.direction === '>' && ticker.currentClose >= order.data.trigger
          const below = order.data.direction === '<' && ticker.currentClose <= order.data.trigger
          if (above || below) {
            await db.removeTriggerOrder(order.id)
            await limit.create(order.payload, order.data)
          }
        })
      }
    })

    this.listeners.push({ pair })
  }

  async checkPairs() {
    const pairs = await db.getTriggerPairs()
    await async.each(pairs, async pair => {
      const exists = _.find(this.listeners, { pair })
      if (!exists) {
        await this.createListener(pair)
      }
    })
  }
}

export default new Monitor()
