import low from 'lowdb'
import FileSync from 'lowdb/adapters/FileSync'
import _ from 'lodash'

import { bn } from './util'

const adapter = new FileSync('db.json')

class Db {
  constructor() {
    this.db = low(adapter)
    this.db
      .defaults({
        triggerOrders: [],
        inputHistory: [],
        orderHistory: []
      })
      .write()
  }

  addTriggerOrder(payload, data) {
    this.db
      .get('triggerOrders')
      .push({
        pair: data.pair,
        payload,
        data
      })
      .write()
  }

  removeTriggerOrder(id) {
    this.db
      .get('triggerOrders')
      .remove({
        id
      })
      .write()
  }

  updateTriggerOrderState(ticker) {
    const orders = this.db
      .get('triggerOrders')
      .filter({
        pair: ticker.symbol
      })
      .value()

    orders.forEach(o => {
      this.db
        .get('triggerOrders')
        .find({
          id: o.id
        })
        .assign({
          state: {
            currentPrice: ticker.currentClose,
            distance:
              bn(o.trigger)
                .minus(ticker.currentClose)
                .absoluteValue()
                .dividedBy(o.trigger)
                .multipliedBy(100)
                .toFixed(2)
                .toString() + '%'
          }
        })
        .write()
    })
  }

  getTriggerOrders() {
    return this.db
      .get('triggerOrders')
      .groupBy('pair')
      .toPairs()
      .map(pair => _.zipObject(['pair', 'orders'], pair))
      .value()
  }

  recordHistory(obj) {
    this.db
      .get('inputHistory')
      .push(obj)
      .write()
  }

  recordOrderHistory(obj) {
    this.db
      .get('orderHistory')
      .push(obj)
      .write()
  }

  getLatestHistory(match) {
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

  getLatestPairs(key) {
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
