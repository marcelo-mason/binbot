import chalk from 'chalk'

import db from '../db'
import binance from '../binance'
import spread from '../commands/spread'
import { bn, timestamp, fix } from '../util'

class SpreadSell {
  constructor() {
    this.info = null

    this.questions = [
      async prev => {
        return {
          type: 'autocomplete',
          name: 'ss_0',
          pageSize: '4',
          message: 'Which a pair are you trading?',
          source: async (answers, input) => {
            return new Promise(async resolve => {
              this.answers = answers
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
        return {
          type: 'input-plus',
          name: 'ss_1',
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            return latest ? latest['ss_1'] : 10
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
          name: 'ss_2',
          message: `Whats the min price?`,
          when: () => prev > 1,
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            return latest ? latest['ss_2'] : this.info.currentPrice
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0) && bn(answer).gt(this.info.currentPrice)
          }
        }
      },
      async prev => {
        return {
          type: 'input-plus',
          name: 'ss_3',
          message: `Whats the max price?`,
          when: () => {
            return !!this.answers['ss_2']
          },
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            return latest ? latest['ss_3'] : answers['ss_2']
          },
          validate: answer => {
            return !isNaN(answer) && bn(answer).gt(0) && bn(answer).gt(prev)
          }
        }
      },
      async prev => {
        return {
          type: 'list',
          name: 'ss_4',
          message: 'How to supply the amount to sell?',
          default: answers => {
            this.answers = answers
            const latest = db.getLatestHistory(answers)
            if (latest) {
              return latest['ss_4']
            }
          },
          choices: [
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
      },
      async prev => {
        if (prev === 'percent') {
          return {
            type: 'input-plus',
            name: 'ss_5',
            default: answers => {
              this.answers = answers
              const latest = db.getLatestHistory(answers)
              return latest ? latest['ss_5'] : 100
            },
            message: `What percentage of your ${this.info.balances.base} ${
              this.info.ei.base
            } would you like to sell?`,
            validate: answer => {
              return !isNaN(answer) && bn(answer).gt(0)
            }
          }
        }
        if (prev === 'base') {
          return {
            type: 'input-plus',
            name: 'ss_5',
            default: answers => {
              this.answers = answers
              const latest = db.getLatestHistory(answers)
              if (latest) {
                return latest['ss_5']
              }
            },
            message: `How many of your ${chalk.yellow(this.info.balances.base)} ${chalk.yellow(
              this.info.ei.base
            )} would you like to sell?`,
            validate: answer => {
              return !isNaN(answer) && bn(answer).gt(0) && bn(answer).lte(this.info.balances.base)
            }
          }
        }
        if (prev === 'quote') {
          return {
            type: 'input-plus',
            name: 'ss_5',
            message: `How many ${this.info.ei.quote} worth would you like to sell?`,
            suggestOnly: true,
            default: answers => {
              this.answers = answers
              const latest = db.getLatestHistory(answers)
              if (latest) {
                return latest['ss_5']
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
          type: 'list',
          name: 'ss_6',
          default: answers => {
            this.answers = answers
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
            this.answers = answers
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
      side: 'SELL',
      isSell: true,
      base: this.info.ei.base,
      quote: this.info.ei.quote,
      pair: `${this.info.ei.base}${this.info.ei.quote}`,
      min: fix(answers['ss_1'], this.info.ei.precision.price),
      max: fix(answers['ss_2'], this.info.ei.precision.price),
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

    await spread.start(data)
  }
}

export default new SpreadSell()
