import chalk from 'chalk'
import Case from 'case'
import _ from 'lodash'

import db from '../db'
import binanceAccounts from '../binance'
import LimitService from '../services/limitService'
import { bn, timestamp, fix } from '../util'

class LimitAsker {
  constructor() {
    this.name = 'limit'
    this.info = null
    this.account = null
    this.binance = null
    this.answers = {}
    this.limitService = new LimitService()
  }

  async init(account) {
    this.account = account
    this.binance = await binanceAccounts.get(account)
    await this.limitService.init(account)
  }

  get questions() {
    return [
      async () => {
        const name = 'limit_0'
        return {
          type: 'autocomplete',
          name,
          pageSize: '4',
          message: 'Which a pair are you trading?',
          source: async (answers, input) => {
            this.answers = answers

            if (input) {
              return this.binance.getMatchingPairs(input)
            }
            const history = await db.getLatestHistory(answers)
            const pairs = await db.getLatestPairs(name)
            if (pairs) {
              if (history) {
                _.remove(pairs, p => p === history[name])
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
        const name = 'limit_1'
        return {
          type: 'input-plus',
          name,
          message: 'How many orders to set?',
          default: async answers => {
            this.answers = answers
            const history = await db.getLatestHistory(answers)
            return history ? history[name] : 1
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0)
          }
        }
      },
      async () => {
        const name = 'limit_2'
        return {
          type: 'input-plus',
          name,
          message: `Whats the ${this.answer(1) > 1 ? 'min' : Case.lower(this.info.side)} price?`,
          default: async answers => {
            this.answers = answers
            const history = await db.getLatestHistory(answers)
            return history ? history[name] : this.info.currentPrice
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0)
          }
        }
      },
      async () => {
        const name = 'limit_3'
        return {
          type: 'input-plus',
          name,
          message: `Whats the max price?`,
          when: () => {
            return this.answer(1) > 1
          },
          default: async answers => {
            this.answers = answers
            const history = await db.getLatestHistory(answers)
            return history ? history[name] : this.answer(2)
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0) && bn(answer).gt(this.answer(2))
          }
        }
      },
      async () => {
        const name = 'limit_4'
        return {
          type: 'list',
          name,
          message: 'When to set the order(s)?',
          default: async answers => {
            this.answers = answers
            const history = await db.getLatestHistory(answers)
            if (history) {
              return history[name]
            }
          },
          choices: [
            {
              name: `Now`,
              value: 'now'
            },
            {
              name: `Trigger`,
              value: 'trigger'
            }
          ]
        }
      },
      async () => {
        const name = 'limit_5'
        return {
          type: 'input-plus',
          name,
          message: `What price will trigger the order(s)?`,
          when: () => {
            return this.answer(4) === 'trigger'
          },
          default: async answers => {
            this.answers = answers
            const history = await db.getLatestHistory(answers)
            return history ? history[name] : this.info.currentPrice
          },
          validate: answer => {
            return !isNaN(answer)
          }
        }
      },
      async () => {
        const name = 'limit_6'
        return {
          type: 'list',
          name,
          message: `How to supply the amount to ${Case.lower(this.info.side)}?`,
          default: async answers => {
            this.answers = answers
            const history = await db.getLatestHistory(answers)
            if (history) {
              return history[name]
            }
          },
          choices: () => {
            if (this.info.isSell) {
              return [
                {
                  name: `Percent of ${this.ei.base}`,
                  value: 'percent-base'
                },
                {
                  name: `Amount of ${this.ei.base}`,
                  value: 'base'
                },
                {
                  name: `Amount of ${this.ei.quote}`,
                  value: 'quote'
                }
              ]
            }
            return [
              {
                name: `Percent of ${this.ei.quote}`,
                value: 'percent-quote'
              },
              {
                name: `Amount of ${this.ei.quote}`,
                value: 'quote'
              },
              {
                name: `Amount of ${this.ei.base}`,
                value: 'base'
              }
            ]
          }
        }
      },
      async () => {
        const name = 'limit_7'
        const type = this.answer(6)

        if (this.info.isSell) {
          if (type === 'percent-base') {
            return {
              type: 'input-plus',
              name,
              message: `What percentage of your ${chalk.yellow(
                this.info.balances.base
              )} ${chalk.yellow(this.ei.base)} would you like to sell?`,
              default: async answers => {
                this.answers = answers
                const history = await db.getLatestHistory(answers)
                return history ? history[name] : 100
              },
              validate: answer => {
                return !isNaN(answer) && bn(answer).gt(0)
              }
            }
          }
          if (type === 'base') {
            return {
              type: 'input-plus',
              name,
              message: `How many of your ${chalk.yellow(this.info.balances.base)} ${chalk.yellow(
                this.ei.base
              )} would you like to sell?`,
              default: async answers => {
                this.answers = answers
                const history = await db.getLatestHistory(answers)
                if (history) {
                  return history[name]
                }
              },
              validate: answer => {
                return !isNaN(answer) && bn(answer).gt(0) && bn(answer).lte(this.info.balances.base)
              }
            }
          }
          if (type === 'quote') {
            return {
              type: 'input-plus',
              name,
              message: `How many ${this.ei.quote} worth would you like to sell?`,
              suggestOnly: true,
              default: async answers => {
                this.answers = answers
                const history = await db.getLatestHistory(answers)
                if (history) {
                  return history[name]
                }
              },
              validate: answer => {
                return !isNaN(answer) && bn(answer).gt(0)
              }
            }
          }
        } else {
          if (type === 'percent-quote') {
            return {
              type: 'input-plus',
              name,
              message: `What percentage of your ${chalk.yellow(
                this.info.balances.quote
              )} ${chalk.yellow(this.ei.quote)} would you like to spend?`,
              default: async answers => {
                this.answers = answers
                const history = await db.getLatestHistory(answers)
                return history ? history[name] : 100
              },
              validate: answer => {
                return !isNaN(answer) && bn(answer).gt(0)
              }
            }
          }
          if (type === 'base') {
            return {
              type: 'input-plus',
              name,
              message: `How many ${this.ei.base} would you like to buy?`,
              default: async answers => {
                this.answers = answers
                const history = await db.getLatestHistory(answers)
                if (history) {
                  return history[name]
                }
              },
              validate: answer => {
                return !isNaN(answer) && bn(answer).gt(0)
              }
            }
          }
          if (type === 'quote') {
            return {
              type: 'autocomplete',
              name,
              message: `How many ${this.ei.quote} would you like to spend?`,
              suggestOnly: true,
              source: async answers => {
                this.answers = answers
                const history = await db.getLatestHistory(answers)
                if (history) {
                  return [history[name] || this.info.balances.quote]
                }
                return [this.info.balances.quote]
              },
              validate: answer => {
                return (
                  !isNaN(answer) && bn(answer).gt(0) && bn(answer).lte(this.info.balances.quote)
                )
              }
            }
          }
        }
      },
      async () => {
        const name = 'limit_8'
        return {
          type: 'list',
          name,
          message: 'How should the amounts be distributed?',
          choices: [
            {
              name: `Equal`,
              value: 'equal'
            },
            {
              name: `Ascending`,
              value: 'asc'
            },
            {
              name: `Descending`,
              value: 'desc'
            }
          ],
          when: () => {
            return this.answer(1) > 1
          },
          default: async answers => {
            this.answers = answers
            const history = await db.getLatestHistory(answers)
            if (history) {
              return history[name]
            }
          }
        }
      },
      async () => {
        const name = 'limit_9'
        return {
          type: 'checkbox-plus',
          name,
          message: `Order properties`,
          default: async answers => {
            this.answers = answers
            const history = await db.getLatestHistory(answers)
            if (history) {
              return history[name]
            }
          },
          source: async answers => {
            return [
              {
                name: `Iceberg Order - Hides 90% of the quantity`,
                value: 'iceberg'
              },
              {
                name: `Maker Only - Order rejected if matches as a taker`,
                value: 'maker'
              },
              {
                name: `Cancel Stops - Cancel stops before creating orders`,
                value: 'cancelStops'
              }
            ]
          }
        }
      }
    ]
  }

  answer(num) {
    return this.answers[`limit_${num}`]
  }

  async pullInfo(pair, side) {
    this.ei = await this.binance.getExchangeInfo(pair)
    this.info = await this.binance.getPairState(pair, true)
    this.info.side = side
    this.info.isSell = side === 'SELL'
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
      account: this.account,
      type: 'LIMIT',
      side: this.info.side,
      isSell: this.info.isSell,
      isSpread: parseInt(this.answer(1)) > 1,
      isTrigger: this.answer(4) === 'trigger',
      base: this.ei.base,
      quote: this.ei.quote,
      pair: `${this.ei.base}${this.ei.quote}`,
      orderCount: parseInt(this.answer(1)),
      price: fix(this.answer(2), this.ei.precision.price),
      min: this.answer(3) ? fix(this.answer(2), this.ei.precision.price) : undefined,
      max: fix(this.answer(3), this.ei.precision.price),
      trigger: this.answer(5) ? fix(this.answer(5), this.ei.precision.price) : null,
      qtyType: this.answer(6),
      qtyValue: this.answer(7),
      dist: this.answer(8),
      direction: bn(this.answer(5)).lt(this.info.currentPrice) ? '<' : '>',
      opts: this.answer(9).reduce((acc, curr) => {
        acc[curr] = true
        return acc
      }, {})
    }
  }

  async execute(answers) {
    const data = this.packData(answers)

    await db.recordInputHistory({
      timestamp: timestamp(),
      ...answers,
      opts: data.opts
    })

    await this.limitService.start(data)
  }
}

export default LimitAsker
