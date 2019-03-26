import chalk from 'chalk'

import db from '../db'
import binance from '../binance'
import commands from '../commands'
import { bn, timestamp } from '../util'

class SpreadSell {
  constructor() {
    this.ei = null

    this.questions = [
      async prev => {
        return {
          type: 'autocomplete',
          name: 'ss_0',
          pageSize: '4',
          message: 'Which a pair are you trading?',
          source: async (answers, input) => {
            return new Promise(async resolve => {
              const matching = await binance.getMatchingSellablePairs(input)
              const latest = db.getLatestHistory(answers)
              if (!input && latest) {
                matching.unshift(latest['ss_0'])
              }
              resolve(matching)
            })
          }
        }
      },
      async prev => {
        this.ei = await binance.getExchangeInfo(prev)
        const currentPrice = bn(await binance.tickerPrice(prev))
          .toFixedDown(this.ei.precision.price)
          .toString()

        return {
          type: 'input-plus',
          name: 'ss_1',
          message: `Whats the min price?`,
          default: answers => {
            const latest = db.getLatestHistory(answers)
            return latest ? latest['ss_1'] : currentPrice
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0) && bn(answer).gt(currentPrice)
          }
        }
      },
      async prev => {
        return {
          type: 'input-plus',
          name: 'ss_2',
          message: `Whats the max price?`,
          default: answers => {
            const latest = db.getLatestHistory(answers)
            return latest ? latest['ss_2'] : answers['ss_1']
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0) && bn(answer).gt(prev)
          }
        }
      },
      async prev => {
        return {
          type: 'list',
          name: 'ss_3',
          message: 'How to supply the amount to sell?',
          default: answers => {
            const latest = db.getLatestHistory(answers)
            if (latest) {
              return latest['ss_3']
            }
          },
          choices: [
            {
              name: `Percent of ${this.ei.base}`,
              value: 'percent'
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
      },
      async prev => {
        const baseBalance = bn(await binance.balance(this.ei.base))
          .toFixedDown(this.ei.precision.base)
          .toString()

        if (prev === 'percent') {
          return {
            type: 'input-plus',
            name: 'ss_4',
            default: answers => {
              const latest = db.getLatestHistory(answers)
              return latest ? latest['ss_4'] : 100
            },
            message: `What percentage of your ${baseBalance} ${
              this.ei.base
            } would you like to sell?`,
            validate: answer => {
              return !isNaN(answer) && bn(answer).gt(0)
            }
          }
        }
        if (prev === 'base') {
          return {
            type: 'input-plus',
            name: 'ss_4',
            default: answers => {
              const latest = db.getLatestHistory(answers)
              if (latest) {
                return latest['ss_4']
              }
            },
            message: `How many of your ${chalk.yellow(baseBalance)} ${chalk.yellow(
              this.ei.base
            )} would you like to sell?`,
            validate: answer => {
              return !isNaN(answer) && bn(answer).gt(0)
            }
          }
        }
        if (prev === 'quote') {
          return {
            type: 'input-plus',
            name: 'ss_4',
            message: `How many ${this.ei.quote} worth would you like to sell?`,
            suggestOnly: true,
            default: answers => {
              const latest = db.getLatestHistory(answers)
              if (latest) {
                return latest['ss_4']
              }
            },
            validate: answer => {
              return !isNaN(answer) && bn(answer).gt(0)
            }
          }
        }
      },
      async prev => {
        return {
          type: 'orders',
          name: 'ss_5',
          default: answers => {
            const latest = db.getLatestHistory(answers)
            return latest ? latest['ss_5'] : 10
          },
          message: 'How many orders to make?',
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0)
          }
        }
      },
      async prev => {
        return {
          type: 'list',
          name: 'ss_6',
          default: answers => {
            const latest = db.getLatestHistory(answers)
            if (latest) {
              return latest['ss_6']
            }
          },
          message: 'How should the amounts be distributed?',
          choices: [
            {
              name: `Ascending`,
              value: 'asc'
            },
            {
              name: `Descending`,
              value: 'desc'
            },
            {
              name: `Equal`,
              value: 'equal'
            }
          ]
        }
      },
      async prev => {
        return {
          type: 'checkbox-plus',
          name: 'ss_7',
          message: `Order properties`,
          default: answers => {
            const latest = db.getLatestHistory(answers)
            if (latest) {
              return latest['ss_7']
            }
          },
          source: async answers => {
            return new Promise(async resolve => {
              resolve([
                {
                  name: `Iceberg Order - 95% hidden`,
                  value: 'iceberg'
                },
                {
                  name: `Maker Only - Order rejected if matches as a taker`,
                  value: 'makerOnly'
                }
              ])
            })
          }
        }
      }
    ]
  }

  isLastQuestion(page) {
    return this.questions.length === page
  }

  parseAnswers(answers) {
    return {
      base: this.ei.base,
      quote: this.ei.quote,
      min: answers['ss_1'],
      max: answers['ss_2'],
      qtyType: answers['ss_3'],
      qtyValue: answers['ss_4'],
      orderCount: answers['ss_5'],
      dist: answers['ss_6'],
      opts: answers['ss_7'].reduce((acc, curr) => {
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

    await commands.spread(
      'SELL',
      data.base,
      data.quote,
      data.min,
      data.max,
      data.qtyType,
      data.qtyValue,
      data.dist,
      data.orderCount,
      data.opts
    )
  }
}

export default new SpreadSell()
