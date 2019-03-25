import inquirer from 'inquirer'
import { Subject } from 'rxjs'

import binance from './binance'
import commands from './commands'
import { log } from './logger'
import { bn } from './util'

let ei = null

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
      name: 'sb|0',
      pageSize: '4',
      message: 'Which a pair are you trading?',
      source: async (answersSoFar, input) => {
        return binance.getMatchingPairs(input)
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
      name: 'sb|1',
      message: `Whats the min price?`,
      suggestOnly: true,
      source: async answers => {
        return new Promise(async resolve => {
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
      name: 'sb|2',
      message: `Whats the max price?`,
      suggestOnly: true,
      source: async answers => {
        return new Promise(async resolve => {
          resolve([answers['sb|1']])
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
      name: 'sb|3',
      message: 'How to supply the amount to buy?',
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
        name: 'sb|4',
        default: '100',
        message: `What percentage of your ${quoteBalance} ${ei.quote} would you like to spend?`,
        validate: answer => {
          return !isNaN(answer) && bn(answer).gt(0)
        }
      }
    }
    if (prev === 'base') {
      return {
        type: 'input',
        name: 'sb|4',
        message: `How many ${ei.base} would you like to buy?`,
        validate: answer => {
          return !isNaN(answer) && bn(answer).gt(0)
        }
      }
    }
    if (prev === 'quote') {
      return {
        type: 'autocomplete',
        name: 'sb|4',
        message: `How many ${ei.quote} would you like to spend?`,
        suggestOnly: true,
        source: async answers => {
          return new Promise(async resolve => {
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
      name: 'sb|5',
      default: '10',
      message: 'How many orders to make?',
      validate: answer => {
        return !isNaN(answer) && bn(answer).gt(0)
      }
    }
  },
  async function(prev) {
    return {
      type: 'list',
      name: 'sb|6',
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
          name: `Equally`,
          value: 'equal'
        }
      ]
    }
  },
  async function(prev) {
    return {
      type: 'checkbox-plus',
      name: 'sb|7',
      message: `Order properties`,
      source: async answers => {
        return new Promise(async resolve => {
          resolve([
            {
              name: `Iceberg Order - Only 95% visible`,
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
    let [command, question] = o.name.split('|')

    // handle action choice
    if (command === 'ac') {
      command = o.answer
      question = -1
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
      'sb|0': 'LTCBTC',       
      'sb|1': '0.014959',     
      'sb|2': '0.014959',     
      'sb|3': 'percent',            
      'sb|4': '100',          
      'sb|5': '2',            
      'sb|6': 'ascending',    
      'sb|7': [ 'iceberg' ] 
  */

    switch (answers.ac) {
      case 'sb':
        const min = answers['sb|1']
        const max = answers['sb|2']
        const qtyType = answers['sb|3']
        const qtyValue = answers['sb|4']
        const orderCount = answers['sb|5']
        const dist = answers['sb|6']
        const opts = answers['sb|7'].reduce((acc, curr) => {
          acc[curr] = true
          return acc
        }, {})

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
