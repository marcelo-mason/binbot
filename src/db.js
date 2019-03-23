import low from 'lowdb'
import idable from 'idable'
import FileSync from 'lowdb/adapters/FileSync'
import BigNumber from 'bignumber.js'
import _ from 'lodash'

const adapter = new FileSync('db.json')

class Db {
  constructor() {
    this.db = low(adapter)
    this.db
      .defaults({
        orders: [],
        snipe: {}
      })
      .write()
  }

  addOrder(base, quote, side, triggerPrice, direction, price, quantity, percentage, state, opts) {
    this.db
      .get('orders')
      .push({
        id: idable(8, false),
        base,
        quote,
        pair: `${base}${quote}`,
        side,
        triggerPrice,
        direction,
        price,
        quantity,
        percentage,
        opts,
        state
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
              new BigNumber(o.triggerPrice)
                .minus(ticker.currentClose)
                .absoluteValue()
                .dividedBy(o.triggerPrice)
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

  setSnipe(base, quote, minPrice, maxPrice, budget, state, opts) {
    this.db
      .set('snipe', {
        base,
        quote,
        pair: `${base}${quote}`,
        minPrice,
        maxPrice,
        budget,
        opts,
        state
      })
      .write()
  }

  getSnipe() {
    const snipe = this.db.get('snipe').value()

    if (_.isEmpty(snipe)) {
      return null
    }

    return snipe
  }

  clearSnipe() {
    this.db.set('snipe', {}).write()
  }
}

export default new Db()
