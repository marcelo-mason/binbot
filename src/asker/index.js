import inquirer from 'inquirer'
import chalk from 'chalk'
import Case from 'case'
import { Subject } from 'rxjs'

import db from '../db'
import { log } from '../logger'
import LimitAsker from './limitAsker'
import monitor from '../services/monitorService'
import keys from '../../keys.json'

class Inquire {
  constructor() {
    this.side = null
    this.limitAsker = null
    this.account = null

    this.prompts = new Subject()

    this.questions = {
      account: {
        type: 'list',
        name: 'account',
        message: 'Which account?',
        choices: keys.map(o => {
          return {
            name: Case.capital(o.name),
            value: o.name
          }
        })
      },
      action: {
        type: 'list',
        name: 'action',
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
        default: async answers => {
          const latest = await db.getLatestHistory(answers)
          if (latest) {
            return latest['action']
          }
        }
      }
    }
  }

  async init() {
    inquirer.registerPrompt('input-plus', require('../controls/input'))
    inquirer.registerPrompt('autocomplete', require('../controls/autocomplete'))
    inquirer.registerPrompt('checkbox-plus', require('inquirer-checkbox-plus-prompt'))
    const prompt = inquirer.prompt(this.prompts)
    prompt.ui.process.subscribe(this.onEachAnswer.bind(this), log.error)
    prompt.then(this.onFinish.bind(this))

    const text = '(Use arrow keys and <enter> to select, <tab> to fill)'
    log.log(chalk.yellow(text))
    log.log()
  }

  async start() {
    this.init()

    if (keys.length > 1) {
      this.prompts.next(this.questions.account)
    } else {
      this.initAskers(keys[0].name)
      this.prompts.next(this.questions.action)
    }
  }

  async initAskers(account) {
    this.account = account
    this.limitAsker = new LimitAsker()
    await this.limitAsker.init(account)
  }

  async onEachAnswer(o) {
    let [command, question] = o.name.split('_')

    // handle account choice
    if (command === 'account') {
      await this.initAskers(o.answer)
      this.prompts.next(this.questions.action)
      return
    }

    // handle action choice
    if (command === 'action') {
      ;[command, this.side] = o.answer.split('_')
      question = -1
    }

    const next = parseInt(question) + 1

    // ask next question
    switch (command) {
      case 'limit':
        if (this.limitAsker.isFirstQuestion(next)) {
          this.limitAsker.pullPairInfo(o.answer, this.side)
        }
        if (this.limitAsker.isLastQuestion(next)) {
          this.prompts.complete()
          return
        }
        this.prompts.next(await this.limitAsker.getQuestion(next, o.answer))
        break
      case 'monitor': {
        await monitor.start()
      }
    }
  }

  async onFinish(answers) {
    const [command] = answers.action.split('_')
    switch (command) {
      case 'limit':
        await this.limitAsker.execute(answers)
        break
    }
  }
}

export default new Inquire()
