import db from './db'

class Commands {
  snipeBuy(coin, currency, price, amount) {
    db.addSnipeBuy(coin.toUpperCase(), currency.toUpperCase(), price, amount)
  }
  snipeSell(coin, currency, price, amount) {
    db.addSnipeSell(coin.toUpperCase(), currency.toUpperCase(), price, amount)
  }
}

export default new Commands()
