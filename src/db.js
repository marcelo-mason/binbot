import low from 'lowdb'
import _ from 'lodash'

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
        inputHistory: [],
        orderHistory: [],
        testHistory: []
      })
      .write()
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
    let matches = this.db
      .get('inputHistory')
      .sortBy('timestamp')
      .reverse()
      .uniqBy(key)
      .map(key)
      .filter(val => !!val)
      .take(4)
      .value()

    if (_.isEmpty(matches) || matches[0] === undefined) {
      return null
    }
    return matches
  }
}

export default new Db()
