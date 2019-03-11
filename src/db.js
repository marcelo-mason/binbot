import low from 'lowdb'
import shortid from 'shortid'
import FileSync from 'lowdb/adapters/FileSync'

const adapter = new FileSync('db.json')

class Db {
  constructor() {
    this.db = low(adapter)
    this.db.defaults({ sells: [] }).write()
  }

  addSell(pair, currency, price, quantity) {
    this.db
      .get('sells')
      .push({ id: shortid.generate(), pair, price, quantity })
      .write()
  }
}

export default new Db()
