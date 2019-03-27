import async from 'awaitable-async'

import binance from '../binance'
import db from '../db'
import spread from './spread'
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

        await async.eachSeries(orders, async order => {
          const above = order.data.direction === '>' && ticker.currentClose >= order.trigger
          const below = order.data.direction === '<' && ticker.currentClose <= order.trigger
          if (above || below) {
            await spread.execute(order.payload, order.data)
          }
        })
      })
    })
  }
}

export default new Monitor()
