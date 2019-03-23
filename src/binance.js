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

    this.symbols = null
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

  async createOrder(pair, side, id, quantity, icebergQty, price, opts) {
    const order = {
      newClientOrderId: id,
      symbol: pair,
      side,
      type: opts.makerOnly ? 'LIMIT_MAKER' : 'LIMIT',
      quantity,
      price,
      icebergQty: icebergQty || 0
    }
    if (!opts.makerOnly) {
      order.timeInForce = 'GTC'
    }
    try {
      const res = await this.rest.newOrder(order)
      return {
        order,
        res
      }
    } catch (e) {
      log.error(e.msg)
    }
  }

  async testOrder(pair, side, id, quantity, icebergQty, price, opts) {
    const order = {
      newClientOrderId: id,
      symbol: pair,
      side,
      type: opts.makerOnly ? 'LIMIT_MAKER' : 'LIMIT',
      quantity,
      price,
      icebergQty: icebergQty || 0
    }
    if (!opts.makerOnly) {
      order.timeInForce = 'GTC'
    }
    try {
      await this.rest.testOrder(order)
      return { success: true }
    } catch (e) {
      return { success: false, msg: e.msg }
    }
  }

  async exchangeInfo() {
    try {
      const data = await async.retry(this.retryOpts, this.rest.exchangeInfo.bind(this.rest))
      this.symbols = data.symbols
    } catch (e) {
      log.error('Could not retreive exchange info', e)
      return false
    }
  }

  async getExchangeInfo(pair) {
    if (!this.symbols) {
      await this.exchangeInfo()
    }

    const found = _.find(this.symbols, { symbol: pair })

    function toPrecision(a) {
      const s = a
        .toString()
        .replace(/([0-9]+(\.[0-9]+[1-9])?)(\.?0+$)/, '$1')
        .split('.')

      if (s.length > 1) {
        return s[1].length
      }
      return 0
    }

    const mnao = _.find(found.filters, { filterType: 'MAX_NUM_ALGO_ORDERS' })
    const lotSize = _.find(found.filters, { filterType: 'LOT_SIZE' })
    const priceFilter = _.find(found.filters, { filterType: 'PRICE_FILTER' })
    const notional = _.find(found.filters, { filterType: 'MIN_NOTIONAL' })

    const validator = (value, min, max, step) => {
      const minRule = value >= min
      const maxRule = value <= max
      const tickRule =
        new BigNumber(value)
          .minus(min)
          .modulo(step)
          .toString() == 0

      if (min > 0 && !minRule) {
        return false
      }
      if (max > 0 && !maxRule) {
        return false
      }
      if (min > 0 && step > 0 && !tickRule) {
        return false
      }
      return true
    }

    const obj = {
      icebergAllowed: found.icebergAllowed,
      maxAlgoOrders: mnao.maxNumAlgoOrders,
      precision: {
        base: found.baseAssetPrecision,
        quote: found.quotePrecision,
        quantity: toPrecision(lotSize.stepSize),
        price: toPrecision(priceFilter.tickSize)
      },
      notional: {
        min: notional.minNotional
      },
      quantity: {
        min: new BigNumber(lotSize.minQty).toFixed(toPrecision(lotSize.stepSize)).toString(),
        max: new BigNumber(lotSize.maxQty).toFixed(toPrecision(lotSize.stepSize)).toString(),
        step: lotSize.stepSize
      },
      price: {
        min: new BigNumber(priceFilter.minPrice)
          .toFixed(toPrecision(priceFilter.tickSize))
          .toString(),
        max: new BigNumber(priceFilter.maxPrice)
          .toFixed(toPrecision(priceFilter.tickSize))
          .toString(),
        step: priceFilter.tickSize
      },
      validate: {
        quantity: quantity => {
          return validator(quantity, lotSize.minQty, lotSize.maxQty, lotSize.stepSize)
        },
        value: (price, quantity) => {
          return new BigNumber(price).multipliedBy(quantity).gt(notional.minNotional)
        },
        price: price => {
          return validator(price, priceFilter.minPrice, priceFilter.maxPrice, priceFilter.tickSize)
        }
      }
    }

    return obj
  }
}

export default new Binance()
