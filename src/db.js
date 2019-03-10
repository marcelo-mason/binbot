import low from 'lowdb'
import shortid from 'shortid'
import FileSync from 'lowdb/adapters/FileSync'

const adapter = new FileSync('db.json')

class Db {
  constructor() {
    this.db = low(adapter)
    this.db.defaults({ snipeBuys: [], snipeSells: [] }).write()
  }

  addSnipeBuy(coin, currency, price, amount) {
    this.db
      .get('snipeBuys')
      .push({ id: shortid.generate(), coin, currency, price, amount })
      .write()
  }

  addSnipeSell(coin, currency, price, amount) {
    this.db
      .get('snipeSells')
      .push({ id: shortid.generate(), coin, currency, price, amount })
      .write()
  }
}

export default new Db()
