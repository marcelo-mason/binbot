import low from 'lowdb'
import shortid from 'shortid'
import FileSync from 'lowdb/adapters/FileSync'

const adapter = new FileSync('db.json')

class Db {
  constructor() {
    this.db = low(adapter)
    this.db.defaults({ sells: [] }).write()
  }

  addSell(base, quote, triggerPrice, triggerDirection, sellPrice, percentage) {
    this.db
      .get('sells')
      .push({
        id: shortid.generate(),
        base,
        quote,
        triggerPrice,
        triggerDirection,
        sellPrice,
        percentage
      })
      .write()
  }
}

export default new Db()
