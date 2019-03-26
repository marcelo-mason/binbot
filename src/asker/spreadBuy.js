import chalk from 'chalk'

import db from '../db'
import binance from '../binance'
import commands from '../commands'
import { bn, timestamp } from '../util'

class SpreadBuy {
  constructor() {
    this.ei = null

    this.questions = [
      async prev => {
        return {
          type: 'autocomplete',
          name: 'sb_0',
          pageSize: '4',
          message: 'Which a pair are you trading?',
          source: async (answers, input) => {
            return new Promise(async resolve => {
              const matching = await binance.getMatchingPairs(input)
              const latest = db.getLatestHistory(answers)
              if (!input && latest) {
                matching.unshift(latest['sb_0'])
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
          name: 'sb_1',
          message: `Whats the min price?`,
          default: answers => {
            const latest = db.getLatestHistory(answers)
            return latest ? latest['sb_1'] : currentPrice
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0) && bn(answer).lt(currentPrice)
          }
        }
      },
      async prev => {
        return {
          type: 'input-plus',
          name: 'sb_2',
          message: `Whats the max price?`,
          default: answers => {
            const latest = db.getLatestHistory(answers)
            return latest ? latest['sb_2'] : answers['sb_1']
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0) && bn(answer).gt(prev)
          }
        }
      },
      async prev => {
        return {
          type: 'list',
          name: 'sb_3',
          message: 'How to supply the amount to buy?',
          default: answers => {
            const latest = db.getLatestHistory(answers)
            if (latest) {
              return latest['sb_3']
            }
          },
          choices: [
            {
              name: `Percent of ${this.ei.quote}`,
              value: 'percent'
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
      },
      async prev => {
        const quoteBalance = bn(await binance.balance(this.ei.quote))
          .toFixedDown(this.ei.precision.quote)
          .toString()

        if (prev === 'percent') {
          return {
            type: 'input-plus',
            name: 'sb_4',
            default: answers => {
              const latest = db.getLatestHistory(answers)
              return latest ? latest['sb_4'] : 100
            },
            message: `What percentage of your ${chalk.yellow(quoteBalance)} ${chalk.yellow(
              this.ei.quote
            )} would you like to spend?`,
            validate: answer => {
              return !isNaN(answer) && bn(answer).gt(0)
            }
          }
        }
        if (prev === 'base') {
          return {
            type: 'input-plus',
            name: 'sb_4',
            default: answers => {
              const latest = db.getLatestHistory(answers)
              if (latest) {
                return latest['sb_4']
              }
            },
            message: `How many ${this.ei.base} would you like to buy?`,
            validate: answer => {
              return !isNaN(answer) && bn(answer).gt(0)
            }
          }
        }
        if (prev === 'quote') {
          return {
            type: 'autocomplete',
            name: 'sb_4',
            message: `How many ${this.ei.quote} would you like to spend?`,
            suggestOnly: true,
            source: async answers => {
              return new Promise(async resolve => {
                const latest = db.getLatestHistory(answers)
                if (latest) {
                  resolve([latest['sb_4'] || quoteBalance])
                  return
                }
                resolve([quoteBalance])
              })
            },
            validate: answer => {
              return !isNaN(answer) && bn(answer).gt(0)
            }
          }
        }
      },
      async prev => {
        return {
          type: 'input-plus',
          name: 'sb_5',
          default: answers => {
            const latest = db.getLatestHistory(answers)
            return latest ? latest['sb_5'] : 10
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
          name: 'sb_6',
          default: answers => {
            const latest = db.getLatestHistory(answers)
            if (latest) {
              return latest['sb_6']
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
          name: 'sb_7',
          message: `Order properties`,
          default: answers => {
            const latest = db.getLatestHistory(answers)
            if (latest) {
              return latest['sb_7']
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
      min: answers['sb_1'],
      max: answers['sb_2'],
      qtyType: answers['sb_3'],
      qtyValue: answers['sb_4'],
      orderCount: answers['sb_5'],
      dist: answers['sb_6'],
      opts: answers['sb_7'].reduce((acc, curr) => {
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
      'BUY',
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

export default new SpreadBuy()
