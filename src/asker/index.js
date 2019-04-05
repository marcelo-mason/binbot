import inquirer from 'inquirer'
import chalk from 'chalk'
import { Subject } from 'rxjs'

import db from '../db'
import { log } from '../logger'
import binance from '../binance'
import limit from './limit'
import { fix, bn } from '../util'
import monitor from './commands/monitor'
import settings from '../../settings.json'

const action = {
  type: 'list',
  name: 'ac',
  message: 'Which action?',
  choices: [
    {
      name: 'Limit Buy',
      value: 'limit_BUY'
    },
    {
      name: 'Limit Sell',
      value: 'limit_SELL'
    },
    {
      name: 'Monitor',
      value: 'monitor'
    }
  ],
  default: answers => {
    const latest = db.getLatestHistory(answers)
    return latest['ac']
  }
}

const prompts = new Subject()

async function getPairInfo(pair, side) {
  const info = {}
  info.side = side
  info.isSell = side === 'SELL'
  info.ei = await binance.getExchangeInfo(pair)
  info.balances = {
    quote: fix(await binance.balance(info.ei.quote), info.ei.precision.quote),
    base: fix(await binance.balance(info.ei.base), info.ei.precision.quantity)
  }
  info.currentPrice = fix(await binance.tickerPrice(pair), info.ei.precision.price)

  // figure in the base quantity locked in stops

  const stops = await binance.getOpenStops(pair)
  if (stops) {
    info.balances.base = bn(info.balances.base)
      .plus(stops.totalQuantity)
      .fix(info.ei.precision.quantity)
  }

  return info
}

class Inquire {
  constructor() {
    this.side = null
  }
  async init() {
    inquirer.registerPrompt('input-plus', require('./addons/input'))
    inquirer.registerPrompt('autocomplete', require('./addons/autocomplete'))
    inquirer.registerPrompt('checkbox-plus', require('inquirer-checkbox-plus-prompt'))
    const prompt = inquirer.prompt(prompts)
    prompt.ui.process.subscribe(this.onEachAnswer, log.error)

    prompt.then(async answers => {
      const [command] = answers.ac.split('_')
      switch (command) {
        case 'limit':
          await limit.execute(answers)
          break
      }
    })
  }

  async start() {
    this.init()
    this.showInstructions()

    // ask action question
    prompts.next(action)
  }

  showInstructions() {
    if (!settings.hideInstructions) {
      log.log(chalk.yellow('(Use arrow keys and <enter> to select, <tab> to fill)'))
      log.log()
    }
  }

  async onEachAnswer(o) {
    let [command, question] = o.name.split('_')

    // handle action choice
    if (command === 'ac') {
      ;[command, this.side] = o.answer.split('_')
      question = -1
    }

    const next = parseInt(question) + 1

    // ask next question
    switch (command) {
      case 'limit':
        if (limit.isFirstQuestion(next)) {
          const info = await getPairInfo(o.answer, this.side)
          limit.setPairInfo(info)
        }
        if (limit.isLastQuestion(next)) {
          prompts.complete()
          return
        }
        prompts.next(await limit.getQuestion(next, o.answer))
        break
      case 'monitor': {
        await monitor.start()
      }
    }
  }
}

export default new Inquire()
