import { BinanceWS, BinanceRest } from 'binance'

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

  test() {
    this.ws.onDepthUpdate('BNBBTC', data => {
      console.log(data)
    })
  }
}

export default new Binance()
