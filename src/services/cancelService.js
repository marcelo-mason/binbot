import prompts from 'prompts'
import _ from 'lodash'
import async from 'awaitable-async'

import db from '../db'
import binanceAccounts from '../binance'
import { log } from '../logger'

class LimitService {
  constructor() {
    this.binance = null
  }

  async init(account) {
    this.binance = await binanceAccounts.get(account)
  }

  async start(data) {
    // prompt

    log.log()

    let res = await prompts({
      type: 'confirm',
      name: 'correct',
      message: 'Cancel orders?'
    })

    log.log()

    // cancel

    if (res.correct) {
      if (data.isTrigger) {
        // look for "all" selection
        const allIds = _.find(data.triggerIds, id => {
          return Array.isArray(id)
        })
        await async.eachSeries(allIds || data.triggerIds, async id => {
          await db.removeTriggerOrder(id)
        })
      } else {
        // look for "all" selection
        const allIds = _.find(data.orderIds, id => {
          return Array.isArray(id)
        })
        await this.binance.cancelOrders(data.pair, allIds || data.orderIds)
      }
    }
  }
}

export default LimitService
