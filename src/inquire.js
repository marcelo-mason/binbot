import inquirer from 'inquirer'
import { Subject } from 'rxjs'
import _ from 'lodash'

import db from './db'
import binance from './binance'
import commands from './commands'
import { log } from './logger'
import { bn, timestamp } from './util'

let ei = null
let latest = null

const action = {
  type: 'list',
  name: 'ac',
  message: 'Which action?',
  choices: [
    {
      name: 'Spread Buy',
      value: 'sb'
    },
    {
      name: 'Spread Sell',
      value: 'ss'
    },
    {
      name: 'Trigger Buy',
      value: 'tb'
    },
    {
      name: 'Trigger Sell',
      value: 'ts'
    }
  ]
}

const spreadBuy = [
  async function(prev) {
    return {
      type: 'autocomplete',
      name: 'sb_0',
      pageSize: '4',
      message: 'Which a pair are you trading?',
      source: async (answersSoFar, input) => {
        return new Promise(async resolve => {
          const matching = await binance.getMatchingPairs(input)
          if (latest) {
            matching.unshift(latest['sb_0'])
          }
          resolve(matching)
        })
      }
    }
  },
  async function(prev) {
    ei = await binance.getExchangeInfo(prev)
    const currentPrice = bn(await binance.tickerPrice(prev))
      .toFixedDown(ei.precision.price)
      .toString()

    return {
      type: 'autocomplete',
      name: 'sb_1',
      message: `Whats the min price?`,
      suggestOnly: true,
      source: async answers => {
        return new Promise(async resolve => {
          if (latest) {
            resolve([latest['sb_1'] || currentPrice])
          }
          resolve([currentPrice])
        })
      },
      validate: answer => {
        return !isNaN(answer) && bn(answer).gt(0) && bn(answer).lt(currentPrice)
      }
    }
  },
  async function(prev) {
    return {
      type: 'autocomplete',
      name: 'sb_2',
      message: `Whats the max price?`,
      suggestOnly: true,
      source: async answers => {
        return new Promise(async resolve => {
          if (latest) {
            resolve([latest['sb_2'] || answers['sb_1']])
            return
          }
          resolve([answers['sb_1']])
        })
      },
      validate: answer => {
        return !isNaN(answer) && bn(answer).gt(0) && bn(answer).gt(prev)
      }
    }
  },
  async function(prev) {
    return {
      type: 'list',
      name: 'sb_3',
      message: 'How to supply the amount to buy?',
      default: () => {
        return latest ? latest['sb_3'] : null
      },
      choices: [
        {
          name: `Percent of ${ei.quote}`,
          value: 'percent'
        },
        {
          name: `Amount of ${ei.quote}`,
          value: 'quote'
        },
        {
          name: `Amount of ${ei.base}`,
          value: 'base'
        }
      ]
    }
  },
  async function(prev) {
    const quoteBalance = bn(await binance.balance(ei.quote))
      .toFixedDown(ei.precision.quote)
      .toString()

    if (prev === 'percent') {
      return {
        type: 'input',
        name: 'sb_4',
        default: () => {
          return latest ? latest['sb_4'] : 100
        },
        message: `What percentage of your ${quoteBalance} ${ei.quote} would you like to spend?`,
        validate: answer => {
          return !isNaN(answer) && bn(answer).gt(0)
        }
      }
    }
    if (prev === 'base') {
      return {
        type: 'input',
        name: 'sb_4',
        default: () => {
          return latest ? latest['sb_4'] : null
        },
        message: `How many ${ei.base} would you like to buy?`,
        validate: answer => {
          return !isNaN(answer) && bn(answer).gt(0)
        }
      }
    }
    if (prev === 'quote') {
      return {
        type: 'autocomplete',
        name: 'sb_4',
        message: `How many ${ei.quote} would you like to spend?`,
        suggestOnly: true,
        source: async answers => {
          return new Promise(async resolve => {
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
  async function(prev) {
    return {
      type: 'orders',
      name: 'sb_5',
      default: () => {
        return latest ? latest['sb_5'] : 10
      },
      message: 'How many orders to make?',
      validate: answer => {
        return !isNaN(answer) && bn(answer).gt(0)
      }
    }
  },
  async function(prev) {
    return {
      type: 'list',
      name: 'sb_6',
      default: () => {
        return latest ? latest['sb_6'] : null
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
  async function(prev) {
    return {
      type: 'checkbox-plus',
      name: 'sb_7',
      message: `Order properties`,
      default: () => {
        return latest ? latest['sb_7'] : null
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

const spreadSell = {
  0: {
    ask: async => {
      return {}
    }
  }
}

const triggerBuy = {
  0: {
    ask: async => {
      return {}
    }
  }
}

const triggerSell = {
  0: {
    ask: async => {
      return {}
    }
  }
}

const prompts = new Subject()

class Inquire {
  async init() {
    inquirer.registerPrompt('autocomplete', require('inquirer-autocomplete-prompt'))
    inquirer.registerPrompt('checkbox-plus', require('inquirer-checkbox-plus-prompt'))
    const prompt = inquirer.prompt(prompts)
    prompt.ui.process.subscribe(this.onEachAnswer, log.error)
    prompt.then(async answers => {
      await this.parseAnswers(answers)
    })
  }

  async start() {
    this.init()

    // ask action question
    prompts.next(action)
  }

  async onEachAnswer(o) {
    let [command, question] = o.name.split('_')

    // handle action choice
    if (command === 'ac') {
      command = o.answer
      question = -1
      const dbLatest = db.getLatestHistory(command)
      latest = _.isEmpty(dbLatest) ? latest : dbLatest[0]
    }

    const next = parseInt(question) + 1

    // ask next question
    switch (command) {
      case 'sb':
        if (spreadBuy.length === next) {
          prompts.complete()
          return
        }
        prompts.next(await spreadBuy[next](o.answer))
        break
      case 'ss':
        if (spreadBuy.length === next) {
          prompts.complete()
          return
        }
        prompts.next(await spreadSell[next](o.answer))
        break
      case 'tb':
        if (spreadBuy.length === next) {
          prompts.complete()
          return
        }
        prompts.next(await triggerBuy[next](o.answer))
        break
      case 'ts':
        if (spreadBuy.length === next) {
          prompts.complete()
          return
        }
        prompts.next(await triggerSell[next](o.answer))
        break
    }
  }

  async parseAnswers(answers) {
    /*             
      'sb_0': 'LTCBTC',       
      'sb_1': '0.014959',     
      'sb_2': '0.014959',     
      'sb_3': 'percent',            
      'sb_4': '100',          
      'sb_5': '2',            
      'sb_6': 'ascending',    
      'sb_7': [ 'iceberg' ] 
  */

    switch (answers.ac) {
      case 'sb':
        const min = answers['sb_1']
        const max = answers['sb_2']
        const qtyType = answers['sb_3']
        const qtyValue = answers['sb_4']
        const orderCount = answers['sb_5']
        const dist = answers['sb_6']
        const opts = answers['sb_7'].reduce((acc, curr) => {
          acc[curr] = true
          return acc
        }, {})

        await db.recordHistory({
          timestamp: timestamp(),
          ...answers,
          opts
        })

        await commands.spreadBuy(
          ei.base,
          ei.quote,
          min,
          max,
          qtyType,
          qtyValue,
          dist,
          orderCount,
          opts
        )
        break
      case 'ss':
        break
      case 'tb':
        break
      case 'ts':
        break
    }
  }
}

export default new Inquire()
