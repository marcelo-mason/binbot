import { BinanceWS, BinanceRest } from 'binance'
import moment from 'moment'
import async from 'awaitable-async'
import _ from 'lodash'

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

    this.retryOpts = {
      times: 6,
      interval: retryCount => {
        return 50 * Math.pow(2, retryCount)
      }
    }
  }

  async sync() {
    try {
      const data = await this.rest.time()
      const serverTime = Math.round(data.serverTime / 1000)
      const machineTime = moment().unix()
      const diffSecs = Math.floor(Math.abs(serverTime - machineTime) / 1000)
      if (diffSecs > 0) {
        console.log(`* Your machine time is off by ${diffSecs} seconds.  Please fix.`)
        return false
      }
      return true
    } catch (e) {
      console.log(`* Could not connect to the binance api`, e)
      return false
    }
  }

  async tickerPrice(pair) {
    try {
      const data = await async.retry(this.retryOpts, this.rest.tickerPrice.bind(this.rest, pair))
      return data.price
    } catch (e) {
      console.log(`* Could not retreive price`, e)
      return false
    }
  }

  async balance(asset) {
    try {
      const data = await async.retry(this.retryOpts, this.rest.account.bind(this.rest))
      const balance = _.find(data.balances, { asset })
      if (balance) {
        return balance.free
      }
    } catch (e) {
      console.log(`* Could not retreive account balances`, e)
      return false
    }
  }
}

export default new Binance()
