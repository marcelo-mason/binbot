import db from './db'
import binance from './binance'
import forever from 'forever-monitor'

class Commands {
  async start() {
    const ok = await binance.sync()
    if (!ok) {
      return
    }

    new forever.Monitor('./src/loaders/monitor.js', {
      max: 10000
    })
      .on('restart', () => {
        console.log('* binbot has restarted')
      })
      .start()
  }

  sell(pair, price, quantity) {
    db.addSell(pair.toUpperCase(), price, quantity)
  }

  list() {}
}

export default new Commands()
