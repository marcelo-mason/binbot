/* eslint-disable eqeqeq */
import { BinanceWS, BinanceRest } from 'binance'
import moment from 'moment'
import async from 'awaitable-async'
import _ from 'lodash'

import { bn } from './util'
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
    this.balances = null

    this.exchangeInfo()
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

  async pullBalances() {
    try {
      const data = await async.retry(this.retryOpts, this.rest.account.bind(this.rest))
      const hasMoney = data.balances.filter(x => {
        return bn(x.free).gt(0) || bn(x.locked).gt(0)
      })
      this.balances = hasMoney
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
          return bn(acc)
            .plus(curr.origQty)
            .toString()
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
    const ticket = {
      newClientOrderId: id,
      symbol: pair,
      side,
      type: opts.makerOnly ? 'LIMIT_MAKER' : 'LIMIT',
      quantity,
      price,
      icebergQty: icebergQty || 0
    }
    if (!opts.makerOnly) {
      ticket.timeInForce = 'GTC'
    }
    try {
      const result = await this.rest.newOrder(ticket)
      return {
        ticket,
        result
      }
    } catch (e) {
      log.error(e.msg)
      console.log(ticket)
      return {
        ticket,
        result: e
      }
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
      const minRule = bn(value).gte(min)
      const maxRule = bn(value).lte(max)
      const tickRule =
        bn(value)
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
      base: found.baseAsset,
      quote: found.quoteAsset,
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
        min: bn(lotSize.minQty)
          .toFixed(toPrecision(lotSize.stepSize))
          .toString(),
        max: bn(lotSize.maxQty)
          .toFixed(toPrecision(lotSize.stepSize))
          .toString(),
        step: lotSize.stepSize
      },
      price: {
        min: bn(priceFilter.minPrice)
          .toFixed(toPrecision(priceFilter.tickSize))
          .toString(),
        max: bn(priceFilter.maxPrice)
          .toFixed(toPrecision(priceFilter.tickSize))
          .toString(),
        step: priceFilter.tickSize
      },
      validate: {
        quantity: quantity => {
          return validator(quantity, lotSize.minQty, lotSize.maxQty, lotSize.stepSize)
        },
        value: (price, quantity) => {
          return bn(price)
            .multipliedBy(quantity)
            .gt(notional.minNotional)
        },
        price: price => {
          return validator(price, priceFilter.minPrice, priceFilter.maxPrice, priceFilter.tickSize)
        }
      }
    }

    return obj
  }

  async getMatchingPairs(input) {
    return new Promise(async resolve => {
      if (!input) {
        resolve([])
        return
      }
      if (!this.symbols) {
        await this.exchangeInfo()
      }
      const symbolList = this.symbols.map(x => x.symbol)
      const matches = symbolList.filter(x => x.startsWith(input.toUpperCase()))
      resolve(matches)
    })
  }

  async getSellablePairs() {
    if (!this.balances) {
      await this.pullBalances()
    }
    const sellable = this.balances.reduce(async (acc, curr) => {
      if (!this.symbols) {
        await this.exchangeInfo()
      }
      const matching = this.symbols
        .map(x => x.symbol)
        .filter(x => {
          return x.startsWith(curr.asset)
        })
      const out = await acc
      matching.forEach(x => {
        if (!out.includes(x)) {
          out.push(x)
        }
      })
      return out
    }, [])
    return sellable
  }

  async getMatchingSellablePairs(input) {
    return new Promise(async resolve => {
      if (!input) {
        resolve([])
        return
      }
      const sellable = await this.getSellablePairs()
      const matches = sellable.filter(x => x.startsWith(input.toUpperCase()))
      resolve(matches)
    })
  }
}

export default new Binance()
