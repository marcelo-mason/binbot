import { BinanceWS, BinanceRest } from 'binance'
import moment from 'moment'
import async from 'awaitable-async'
import _ from 'lodash'
import BigNumber from 'bignumber.js'
import { log } from './logger'

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
        log.error(`Your machine time is off by ${diffSecs} seconds.  Please fix.`)
        return false
      }
      return true
    } catch (e) {
      log.error('Could not connect to the binance api', e)
      return false
    }
  }

  async tickerPrice(pair) {
    try {
      const data = await async.retry(this.retryOpts, this.rest.tickerPrice.bind(this.rest, pair))
      return data.price
    } catch (e) {
      log.error('Could not retreive price', e)
      return false
    }
  }

  async balance(asset) {
    try {
      const data = await async.retry(this.retryOpts, this.rest.account.bind(this.rest))
      const balance = _.find(data.balances, {
        asset
      })
      if (balance) {
        return balance.free
      }
    } catch (e) {
      log.error('Could not retreive account balances', e)
      return false
    }
  }

  async getOpenStops(pair) {
    try {
      const data = await async.retry(this.retryOpts, this.rest.openOrders.bind(this.rest, pair))
      const stops = _.filter(data, {
        type: 'STOP_LOSS_LIMIT',
        side: 'SELL'
      })
      return {
        orderIds: stops.map(stop => {
          return stop.orderId
        }),
        totalQuantity: stops.reduce((acc, curr) => {
          return new BigNumber(acc).plus(curr.origQty).toString()
        }, 0),
        stops
      }
    } catch (e) {
      log.error('Could not retreive price', e)
      return false
    }
  }

  async cancelOrders(pair, orderIds) {
    try {
      await async.eachSeries(orderIds, async orderId => {
        await async.retry(
          this.retryOpts,
          this.rest.cancelOrder.bind(this.rest, {
            symbol: pair,
            orderId
          })
        )
        log.info(`Order ${orderId} on pair ${pair} cancelled`)
      })
    } catch (e) {
      log.error('Could not retreive price', e)
      return false
    }
  }

  async cancelStops(pair) {
    const stops = await this.getOpenStops(pair)
    if (stops) {
      await this.cancelOrders(pair, stops.orderIds)
    }
  }

  async createOrder(pair, side, id, quantity, price, opts) {
    const order = {
      newClientOrderId: id,
      symbol: pair,
      side,
      type: opts.makerOnly ? 'LIMIT_MAKER' : 'LIMIT',
      timeInForce: 'GTC',
      quantity,
      price,
      icebergQty: opts.icebergOrder ? new BigNumber(quantity).multipliedBy(0.95).toString() : 0
    }
    log.verbose(order)
    const res = await this.rest.testOrder(order)
    log.verbose(res)
    return res
  }
}

export default new Binance()
