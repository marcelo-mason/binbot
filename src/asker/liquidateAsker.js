import asTable from 'as-table'
import _ from 'lodash'

import db from '../db'
import binanceAccounts from '../binance'
import LiquidateService from '../services/liquidateService'
import { bn, timestamp, fix, getFormattedQty } from '../util'

class LiquidateAsker {
  constructor() {
    this.name = 'cancel'
    this.info = null
    this.account = null
    this.binance = null
    this.answers = {}
    this.openOrders = null
    this.liquidateService = new LiquidateService()
  }

  async init(account) {
    this.account = account
    this.binance = await binanceAccounts.get(account)
    await this.liquidateService.init(account)
  }

  get questions() {
    return [
      async () => {
        const name = 'liquidate_0'
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
        const name = 'liquidate_1'
        return {
          type: 'list',
          name,
          message: 'Which type of orders do you want to cancel?',
          default: async answers => {
            this.answers = answers
            const history = await db.getLatestHistory(answers)
            if (history) {
              return history[name]
            }
          },
          choices: [
            {
              name: `Open Orders`,
              value: 'open'
            },
            {
              name: `Trigger Orders`,
              value: 'trigger'
            }
          ]
        }
      },
      async () => {
        const name = 'liquidate_2'
        return {
          type: 'checkbox-plus',
          name,
          message: `Which orders do you want to cancel?`,
          when: () => {
            return this.answer(1) === 'open'
          },
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
      },
      async () => {
        const name = 'liquidate_3'
        return {
          type: 'checkbox-plus',
          name,
          message: `Which orders do you want to cancel?`,
          when: () => {
            return this.answer(1) === 'trigger'
          },
          source: async answers => {
            this.answers = answers

            const orders = await db.getTriggerOrders(this.answer(0))
            if (!orders.length) {
              return [
                {
                  name: `No trigger orders for pair`,
                  value: '-',
                  disabled: true
                }
              ]
            }

            const table = asTable(
              orders.map(o => {
                const price = o.data.isSpread
                  ? `${o.data.min} - ${o.data.max}`
                  : `${o.data.price} ${o.data.quote}`

                return [
                  `${o.data.trigger} ${this.ei.base}`,
                  '->',
                  `${price}`,
                  'x',
                  `${getFormattedQty(o.data)}`
                ]
              })
            )

            const lines = table.split('\n')

            return [
              {
                name: 'All',
                value: orders.map(o => o.id)
              },
              ...lines.map((line, i) => {
                return {
                  name: line,
                  value: orders[i].id
                }
              })
            ]
          }
        }
      }
    ]
  }

  answer(num) {
    return this.answers[`liquidate_${num}`]
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
      isTrigger: this.answer(1) === 'trigger',
      orderIds: this.answer(2),
      triggerIds: this.answer(3)
    }
  }

  async execute(answers) {
    const data = this.packData(answers)

    if (data.isTrigger && !data.triggerIds.length) {
      return
    }
    if (!data.isTrigger && !data.orderIds.length) {
      return
    }

    await db.recordInputHistory({
      timestamp: timestamp(),
      ...answers
    })

    await this.liquidateService.start(data)
  }
}

export default LiquidateAsker
