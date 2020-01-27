import prompts from 'prompts'
import _ from 'lodash'

import binanceAccounts from '../binance'
import { log } from '../logger'

class CancelService {
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
      // look for "all" selection
      const allIds = _.find(data.orderIds, id => {
        return Array.isArray(id)
      })
      await this.binance.cancelOrders(data.pair, allIds || data.orderIds) 
    }
  }
}

export default CancelService
