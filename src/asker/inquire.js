import inquirer from 'inquirer'
import { Subject } from 'rxjs'

import { log } from '../logger'
import binance from '../binance'
import spreadBuy from './spreadBuy'
import spreadSell from './spreadSell'
import { fix } from '../util'

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
    }
  ]
}

const prompts = new Subject()

async function getPairInfo(pair) {
  const info = {}
  info.ei = await binance.getExchangeInfo(pair)
  info.balances = {
    quote: fix(await binance.balance(info.ei.quote), info.ei.precision.quote),
    base: fix(await binance.balance(info.ei.base), info.ei.precision.quantity)
  }
  info.currentPrice = fix(await binance.tickerPrice(pair), info.ei.precision.price)
  return info
}

class Inquire {
  async init() {
    inquirer.registerPrompt('input-plus', require('./addons/input'))
    inquirer.registerPrompt('autocomplete', require('./addons/autocomplete'))
    inquirer.registerPrompt('checkbox-plus', require('inquirer-checkbox-plus-prompt'))
    const prompt = inquirer.prompt(prompts)
    prompt.ui.process.subscribe(this.onEachAnswer, log.error)

    prompt.then(async answers => {
      switch (answers.ac) {
        case 'sb':
          await spreadBuy.execute(answers)
          break
        case 'ss':
          await spreadSell.execute(answers)
          break
      }
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
    }

    const next = parseInt(question) + 1

    // ask next question
    switch (command) {
      case 'sb':
        if (spreadBuy.isFirstQuestion(next)) {
          const info = await getPairInfo(o.answer)
          spreadBuy.setPairInfo(info)
        }
        if (!spreadBuy.isLastQuestion(next)) {
          prompts.next(await spreadBuy.getQuestion(next, o.answer))
        } else {
          prompts.complete()
        }
        break
      case 'ss':
        if (spreadSell.isFirstQuestion(next)) {
          const info = await getPairInfo(o.answer)
          spreadSell.setPairInfo(info)
        }
        if (spreadSell.isLastQuestion(next)) {
          prompts.complete()
          return
        }
        prompts.next(await spreadSell.getQuestion(next, o.answer))
        break
    }
  }
}

export default new Inquire()
