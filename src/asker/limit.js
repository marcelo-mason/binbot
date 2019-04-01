import chalk from 'chalk'
import Case from 'case'

import db from '../db'
import binance from '../binance'
import spread from '../commands/limit'
import { bn, timestamp, fix } from '../util'

class LimitAsker {
  constructor() {
    this.info = null
    this.answers = {}

    this.questions = [
      async prev => {
        const name = 'limit_0'
        return {
          type: 'autocomplete',
          name,
          pageSize: '4',
          message: 'Which a pair are you trading?',
          source: async (answers, input) => {
            this.answers = answers
            return new Promise(async resolve => {
              const matching = await binance.getMatchingPairs(input)
              if (!input) {
                const latestPairs = db.getLatestPairs(name)
                resolve(latestPairs)
                return
              }
              resolve(matching)
            })
          }
        }
      },
      async prev => {
        const name = 'limit_1'
        return {
          type: 'input-plus',
          name,
          message: 'How many orders to set?',
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            return latest ? latest[name] : 1
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0)
          }
        }
      },
      async prev => {
        const name = 'limit_2'
        return {
          type: 'input-plus',
          name,
          message: `Whats the ${prev > 1 ? 'min' : Case.lower(this.info.side)} price?`,
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            return latest ? latest[name] : this.info.currentPrice
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0)
          }
        }
      },
      async prev => {
        const name = 'limit_3'
        return {
          type: 'input-plus',
          name,
          message: `Whats the max price?`,
          when: () => {
            return this.answers['limit_1'] > 1
          },
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            return latest ? latest[name] : answers['limit_2']
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0) && bn(answer).gt(prev)
          }
        }
      },
      async prev => {
        const name = 'limit_4'
        return {
          type: 'list',
          name,
          message: 'When to set the order(s)?',
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            if (latest) {
              return latest[name]
            }
          },
          choices: [
            {
              name: `Now`,
              value: 'now'
            },
            {
              name: `Later`,
              value: 'later'
            }
          ]
        }
      },
      async prev => {
        const name = 'limit_5'
        return {
          type: 'input-plus',
          name,
          message: `What price will trigger the order(s)?`,
          when: () => {
            return this.answers['limit_4'] === 'later'
          },
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            return latest ? latest[name] : this.info.currentPrice
          },
          validate: answer => {
            return !isNaN(answer)
          }
        }
      },
      async prev => {
        const name = 'limit_6'
        return {
          type: 'list',
          name,
          message: `How to supply the amount to ${Case.lower(this.info.side)}?`,
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            if (latest) {
              return latest[name]
            }
          },
          choices: () => {
            if (this.info.isSell) {
              return [
                {
                  name: `Percent of ${this.info.ei.base}`,
                  value: 'percent'
                },
                {
                  name: `Amount of ${this.info.ei.base}`,
                  value: 'base'
                },
                {
                  name: `Amount of ${this.info.ei.quote}`,
                  value: 'quote'
                }
              ]
            }
            return [
              {
                name: `Percent of ${this.info.ei.quote}`,
                value: 'percent'
              },
              {
                name: `Amount of ${this.info.ei.quote}`,
                value: 'quote'
              },
              {
                name: `Amount of ${this.info.ei.base}`,
                value: 'base'
              }
            ]
          }
        }
      },
      async prev => {
        const name = 'limit_7'
        if (this.info.isSell) {
          if (prev === 'percent') {
            return {
              type: 'input-plus',
              name,
              message: `What percentage of your ${chalk.yellow(
                this.info.balances.base
              )} ${chalk.yellow(this.info.ei.base)} would you like to sell?`,
              default: answers => {
                this.answers = answers
                const latest = db.getLatestHistory(answers)
                return latest ? latest[name] : 100
              },
              validate: answer => {
                return !isNaN(answer) && bn(answer).gt(0)
              }
            }
          }
          if (prev === 'base') {
            return {
              type: 'input-plus',
              name,
              message: `How many of your ${chalk.yellow(this.info.balances.base)} ${chalk.yellow(
                this.info.ei.base
              )} would you like to sell?`,
              default: answers => {
                this.answers = answers
                const latest = db.getLatestHistory(answers)
                if (latest) {
                  return latest[name]
                }
              },
              validate: answer => {
                return !isNaN(answer) && bn(answer).gt(0) && bn(answer).lte(this.info.balances.base)
              }
            }
          }
          if (prev === 'quote') {
            return {
              type: 'input-plus',
              name,
              message: `How many ${this.info.ei.quote} worth would you like to sell?`,
              suggestOnly: true,
              default: answers => {
                this.answers = answers
                const latest = db.getLatestHistory(answers)
                if (latest) {
                  return latest[name]
                }
              },
              validate: answer => {
                return !isNaN(answer) && bn(answer).gt(0)
              }
            }
          }
        } else {
          if (prev === 'percent') {
            return {
              type: 'input-plus',
              name,
              message: `What percentage of your ${chalk.yellow(
                this.info.balances.quote
              )} ${chalk.yellow(this.info.ei.quote)} would you like to spend?`,
              default: answers => {
                this.answers = answers
                const latest = db.getLatestHistory(answers)
                return latest ? latest[name] : 100
              },
              validate: answer => {
                return !isNaN(answer) && bn(answer).gt(0)
              }
            }
          }
          if (prev === 'base') {
            return {
              type: 'input-plus',
              name,
              message: `How many ${this.info.ei.base} would you like to buy?`,
              default: answers => {
                this.answers = answers
                const latest = db.getLatestHistory(answers)
                if (latest) {
                  return latest[name]
                }
              },
              validate: answer => {
                return !isNaN(answer) && bn(answer).gt(0)
              }
            }
          }
          if (prev === 'quote') {
            return {
              type: 'autocomplete',
              name,
              message: `How many ${this.info.ei.quote} would you like to spend?`,
              suggestOnly: true,
              source: async answers => {
                this.answers = answers
                return new Promise(async resolve => {
                  const latest = db.getLatestHistory(answers)
                  if (latest) {
                    resolve([latest[name] || this.info.balances.quote])
                    return
                  }
                  resolve([this.info.balances.quote])
                })
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
      async prev => {
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
            return this.answers['limit_1'] > 1
          },
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            if (latest) {
              return latest[name]
            }
          }
        }
      },
      async prev => {
        const name = 'limit_9'
        return {
          type: 'checkbox-plus',
          name,
          message: `Order properties`,
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            if (latest) {
              return latest[name]
            }
          },
          source: async answers => {
            return new Promise(async resolve => {
              resolve([
                {
                  name: `Iceberg Order - Hides 90% of the quantity`,
                  value: 'iceberg'
                },
                {
                  name: `Maker Only - Order rejected if matches as a taker`,
                  value: 'makerOnly'
                },
                {
                  name: `Cancel Stops - Cancel stops before creating orders`,
                  value: 'cancelStops'
                }
              ])
            })
          }
        }
      }
    ]
  }

  setPairInfo(info) {
    this.info = info
  }

  isFirstQuestion(num) {
    return num === 1
  }

  isLastQuestion(num) {
    return this.questions.length === num
  }

  async getQuestion(num, answer) {
    let next = await this.questions[num](answer)
    while ('when' in next && !next.when() && num < this.questions.length) {
      next = await this.questions[++num](answer)
    }
    return next
  }

  parseAnswers(answers) {
    return {
      side: this.info.side,
      isSell: this.info.isSell,
      isSpread: parseInt(answers['limit_1']) > 1,
      isLater: answers['limit_4'] === 'later',
      base: this.info.ei.base,
      quote: this.info.ei.quote,
      pair: `${this.info.ei.base}${this.info.ei.quote}`,
      orderCount: parseInt(answers['limit_1']),
      price: fix(answers['limit_2'], this.info.ei.precision.price),
      min: fix(answers['limit_2'], this.info.ei.precision.price),
      max: fix(answers['limit_3'], this.info.ei.precision.price),
      trigger: answers['limit_5'] ? fix(answers['limit_5'], this.info.ei.precision.price) : null,
      qtyType: answers['limit_6'],
      qtyValue: answers['limit_7'],
      dist: answers['limit_8'],
      direction: bn(answers['limit_5']).lt(this.info.currentPrice) ? '<' : '>',
      opts: answers['limit_9'].reduce((acc, curr) => {
        acc[curr] = true
        return acc
      }, {})
    }
  }

  async execute(answers) {
    const data = this.parseAnswers(answers)

    await db.recordHistory({
      timestamp: timestamp(),
      ...answers,
      opts: data.opts
    })

    await spread.start(data)
  }
}

export default new LimitAsker()
