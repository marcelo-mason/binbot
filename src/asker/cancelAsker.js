import asTable from 'as-table'
import _ from 'lodash'

import db from '../db'
import binanceAccounts from '../binance'
import CancelService from '../services/cancelService'
import { bn, timestamp, fix } from '../util'

class CancelAsker {
  constructor() {
    this.name = 'cancel'
    this.info = null
    this.account = null
    this.binance = null
    this.answers = {}
    this.openOrders = null
    this.cancelService = new CancelService()
  }

  async init(account) {
    this.account = account
    this.binance = await binanceAccounts.get(account)
    await this.cancelService.init(account)
  }

  get questions() {
    return [
      async () => {
        const name = 'cancel_0'
        return {
          type: 'autocomplete',
          name,
          pageSize: '4',
          message: 'Which pair are you targetting?',
          source: async (answers, input) => {
            this.answers = answers
            if (input) {
              return this.binance.getMatchingPairs(input)
            }
            const history = await db.getLatestHistory(answers)
            const pairs = await db.getLatestPairs('limit_0')
            if (pairs) {
              if (history) {
                _.remove(pairs, pair => pair === history[name])
                pairs.unshift(history[name])
              }
              return pairs
            }
            if (history) {
              return [history[name]]
            }

            return ['BTCUSDT', 'ETHUSDT', 'ETHBTC']
          }
        }
      },
      async () => {
        const name = 'cancel_1'
        return {
          type: 'checkbox-plus',
          name,
          message: `Which orders do you want to cancel?`,
          source: async answers => {
            this.answers = answers
            const orders = await this.binance.getOpenOrders(this.answer(0))
            if (!orders.length) {
              return [
                {
                  name: `No open orders for pair`,
                  value: '-',
                  disabled: true
                }
              ]
            }

            const table = asTable(
              orders.map(o => {
                const quantity = bn(o.origQty).minus(o.executedQty)
                const cost = bn(quantity).multipliedBy(o.price)
                return [
                  `${fix(o.price, this.ei.precision.price)} ${this.ei.quote}`,
                  `x`,
                  `${quantity} ${this.ei.base}`,
                  `=`,
                  `${cost} ${this.ei.quote}`,
                  `(${o.type} ${o.side})`
                ]
              })
            )

            const lines = table.split('\n')

            return [
              {
                name: 'All',
                value: orders.map(o => o.orderId)
              },
              ...lines.map((line, i) => {
                return {
                  name: line,
                  value: orders[i].orderId
                }
              })
            ]
          }
        }
      }
    ]
  }

  answer(num) {
    return this.answers[`cancel_${num}`]
  }

  async pullInfo(pair, side) {
    this.ei = await this.binance.getExchangeInfo(pair)
    this.info = await this.binance.getPairState(pair)
    this.info.side = side
  }

  isFirstQuestion(num) {
    return num === 1
  }

  async getQuestion(num, answer) {
    if (num === this.questions.length) {
      return null
    }
    let next = await this.questions[num](answer)
    while ('when' in next && !next.when() && num < this.questions.length) {
      num++
      if (num === this.questions.length) {
        return null
      }
      next = await this.questions[num](answer)
    }
    return next
  }

  packData(answers) {
    this.answers = answers
    return {
      type: 'CANCEL',
      pair: this.answer(0),
      orderIds: this.answer(1)
    }
  }

  async execute(answers) {
    const data = this.packData(answers)

    if (!data.orderIds.length) {
      return
    }

    await db.recordInputHistory({
      timestamp: timestamp(),
      ...answers
    })

    await this.cancelService.start(data)
  }
}

export default CancelAsker
