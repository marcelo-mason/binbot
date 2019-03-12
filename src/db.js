import low from 'lowdb'
import idable from 'idable'
import FileSync from 'lowdb/adapters/FileSync'
import _ from 'lodash'

const adapter = new FileSync('db.json')

class Db {
  constructor() {
    this.db = low(adapter)
    this.db.defaults({ orders: [] }).write()
  }

  addOrder(base, quote, side, triggerPrice, direction, price, quantity, percentage, opts) {
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
        opts
      })
      .write()
  }

  getOrdersGroupedByPair() {
    return this.db
      .get('orders')
      .groupBy('pair')
      .toPairs()
      .map(pair => _.zipObject(['pair', 'orders'], pair))
      .value()
  }
}

export default new Db()
