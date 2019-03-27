import chalk from 'chalk'

import db from '../db'
import binance from '../binance'
import spread from '../commands/spread'
import { bn, timestamp, fix } from '../util'

class SpreadBuy {
  constructor() {
    this.info = null
    this.answers = {}

    this.questions = [
      async prev => {
        return {
          type: 'autocomplete',
          name: 'sb_0',
          pageSize: '4',
          message: 'Which a pair are you trading?',
          source: async (answers, input) => {
            this.answers = answers
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
        return {
          type: 'input-plus',
          name: 'sb_1',
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            return latest ? latest['sb_1'] : 10
          },
          message: 'How many orders to set?',
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0)
          }
        }
      },
      async prev => {
        return {
          type: 'input-plus',
          name: 'sb_2',
          message: `Whats the min price?`,
          when: () => prev > 1,
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            return latest ? latest['sb_2'] : this.info.currentPrice
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0) && bn(answer).lt(this.info.currentPrice)
          }
        }
      },
      async prev => {
        return {
          type: 'input-plus',
          name: 'sb_3',
          when: () => {
            return !!this.answers['sb_2']
          },
          message: `Whats the max price?`,
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            return latest ? latest['sb_3'] : answers['sb_2']
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0) && bn(answer).gt(prev)
          }
        }
      },
      async prev => {
        return {
          type: 'list',
          name: 'sb_4',
          message: 'How to supply the amount to buy?',
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            if (latest) {
              return latest['sb_4']
            }
          },
          choices: [
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
      },
      async prev => {
        if (prev === 'percent') {
          return {
            type: 'input-plus',
            name: 'sb_5',
            default: answers => {
              this.answers = answers
              const latest = db.getLatestHistory(answers)
              return latest ? latest['sb_5'] : 100
            },
            message: `What percentage of your ${chalk.yellow(
              this.info.balances.quote
            )} ${chalk.yellow(this.info.ei.quote)} would you like to spend?`,
            validate: answer => {
              return !isNaN(answer) && bn(answer).gt(0)
            }
          }
        }
        if (prev === 'base') {
          return {
            type: 'input-plus',
            name: 'sb_5',
            default: answers => {
              this.answers = answers
              const latest = db.getLatestHistory(answers)
              if (latest) {
                return latest['sb_5']
              }
            },
            message: `How many ${this.info.ei.base} would you like to buy?`,
            validate: answer => {
              return !isNaN(answer) && bn(answer).gt(0)
            }
          }
        }
        if (prev === 'quote') {
          return {
            type: 'autocomplete',
            name: 'sb_5',
            message: `How many ${this.info.ei.quote} would you like to spend?`,
            suggestOnly: true,
            source: async answers => {
              this.answers = answers
              return new Promise(async resolve => {
                const latest = db.getLatestHistory(answers)
                if (latest) {
                  resolve([latest['sb_5'] || this.info.balances.quote])
                  return
                }
                resolve([this.info.balances.quote])
              })
            },
            validate: answer => {
              return !isNaN(answer) && bn(answer).gt(0) && bn(answer).lte(this.info.balances.quote)
            }
          }
        }
      },
      async prev => {
        return {
          type: 'list',
          name: 'sb_6',
          default: answers => {
            this.answers = answers
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
            this.answers = answers
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

  parseAnswers(answers, info) {
    return {
      side: 'BUY',
      isSell: false,
      base: this.info.ei.base,
      quote: this.info.ei.quote,
      pair: `${this.info.ei.base}${this.info.ei.quote}`,
      min: fix(answers['sb_1'], this.info.ei.precision.price),
      max: fix(answers['sb_2'], this.info.ei.precision.price),
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

    await spread.start(data)
  }
}

export default new SpreadBuy()
