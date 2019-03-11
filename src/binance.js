import { BinanceWS, BinanceRest } from 'binance'
import moment from 'moment'

class Binance {
  constructor() {
    this.rest = new BinanceRest({
      key: process.env.BINANCE_KEY,
      secret: process.env.BINANCE_SECRET,
      timeout: 15000, // Optional, defaults to 15000, is the request time out in milliseconds
      recvWindow: 10000, // Optional, defaults to 5000, increase if you're getting timestamp errors
      disableBeautification: false,
      handleDrift: false
    })

    this.ws = new BinanceWS(true)
  }

  async sync() {
    const time = await this.rest.time()
    console.log(time)
    if (time) {
      const serverTime = Math.round(time.serverTime / 1000)
      const machineTime = moment().unix()
      const diffSecs = Math.floor(Math.abs(serverTime - machineTime) / 1000)
      if (diffSecs > 0) {
        console.log(`* Your machine time is off by ${diffSecs} seconds.  Please fix.`)
        return false
      }
    } else {
      console.log(`* Could not connect to the binance api`)
      return false
    }
    return true
  }
}

export default new Binance()
