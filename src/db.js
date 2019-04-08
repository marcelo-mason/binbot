import low from 'lowdb'
import _ from 'lodash'
import idable from 'idable'

import { bn, fix } from './util'
import Adapter from './dbAdapter'

const adapter = new Adapter()

class Db {
  constructor() {
    this.db = null
    this.init()
  }

  async init() {
    this.db = await low(adapter)
    this.db
      .defaults({
        triggerOrders: [],
        inputHistory: [],
        orderHistory: [],
        testHistory: []
      })
      .write()
  }

  async addTriggerOrder(payload, data) {
    await this.init()
    this.db
      .get('triggerOrders')
      .push({
        account: data.account,
        id: idable(6, false),
        pair: data.pair,
        payload,
        data
      })
      .write()
  }

  async removeTriggerOrder(id) {
    await this.init()
    this.db
      .get('triggerOrders')
      .remove({
        id
      })
      .write()
  }

  async updateTriggerOrderState(ticker, ei) {
    await this.init()
    const orders = this.db
      .get('triggerOrders')
      .filter({
        pair: ticker.symbol
      })
      .value()

    orders.forEach(o => {
      const distance =
        bn(o.data.trigger)
          .minus(ticker.currentClose)
          .absoluteValue()
          .dividedBy(o.data.trigger)
          .multipliedBy(100)
          .toFixed(2)
          .toString() + '%'

      this.db
        .get('triggerOrders')
        .find({
          id: o.id
        })
        .assign({
          state: {
            currentPrice: fix(ticker.currentClose, ei.precision.price),
            distance
          }
        })
        .write()
    })
  }

  async getTriggerPairs() {
    await this.init()
    return this.db
      .get('triggerOrders')
      .uniqBy('pair')
      .map('pair')
      .value()
  }

  async getTriggerOrders(pair) {
    await this.init()
    return this.db
      .get('triggerOrders')
      .filter({
        data: {
          pair
        }
      })
      .value()
  }

  async recordInputHistory(obj) {
    await this.init()
    this.db
      .get('inputHistory')
      .push(obj)
      .write()
  }

  async recordOrderHistory(obj) {
    await this.init()
    this.db
      .get('orderHistory')
      .push(obj)
      .write()
  }

  async recordTestHistory(obj) {
    await this.init()
    this.db
      .get('testHistory')
      .push(obj)
      .write()
  }

  async getLatestHistory(match) {
    await this.init()
    const matches = this.db
      .get('inputHistory')
      .filter(match)
      .sortBy('timestamp')
      .reverse()
      .take(1)
      .value()

    if (_.isEmpty(matches)) {
      return null
    }

    return matches[0]
  }

  async getLatestPairs(key) {
    await this.init()
    const matches = this.db
      .get('inputHistory')
      .sortBy('timestamp')
      .reverse()
      .uniqBy(key)
      .map(key)
      .take(4)
      .value()

    if (_.isEmpty(matches)) {
      return null
    }
    return matches
  }
}

export default new Db()
