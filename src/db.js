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
        orders: [],
        inputHistory: [],
        orderHistory: []
      })
      .write()
  }

  addOrder(payload, data) {
    this.db
      .get('orders')
      .push({
        pair: data.pair,
        payload,
        data
      })
      .write()
  }

  removeOrder(id) {
    this.db
      .get('orders')
      .remove({
        id
      })
      .write()
  }

  updateState(ticker) {
    const orders = this.db
      .get('orders')
      .filter({
        pair: ticker.symbol
      })
      .value()

    orders.forEach(o => {
      this.db
        .get('orders')
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

  getOrdersGroupedByPair() {
    return this.db
      .get('orders')
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
      .take(1)
      .value()

    if (_.isEmpty(matches)) {
      return null
    }

    return matches[0]
  }
}

export default new Db()
