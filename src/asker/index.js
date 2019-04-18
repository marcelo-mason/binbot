import inquirer from 'inquirer'
import chalk from 'chalk'
import Case from 'case'
import { Subject } from 'rxjs'

import db from '../db'
import { log } from '../logger'
import LimitAsker from './limitAsker'
import CancelAsker from './cancelAsker'
import keys from '../../keys.json'

class Asker {
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
            name: 'Cancel Orders',
            value: 'cancel'
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

  async initAskers(account) {
    this.account = account
    this.limitAsker = new LimitAsker()
    this.cancelAsker = new CancelAsker()
    await this.limitAsker.init(account)
    await this.cancelAsker.init(account)
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

  async onEachAnswer(o) {
    let [command, question] = o.name.split('_')

    let next = parseInt(question) + 1

    // handle action choice
    if (command === 'action') {
      ;[command, this.side] = o.answer.split('_')
      next = 0
    }

    // ask next question
    switch (command) {
      case 'account':
        await this.initAskers(o.answer)
        this.prompts.next(this.questions.action)
        break
      case 'limit':
        {
          if (this.limitAsker.isFirstQuestion(next)) {
            await this.limitAsker.pullInfo(o.answer, this.side)
          }
          const q = await this.limitAsker.getQuestion(next, o.answer)
          if (q) {
            this.prompts.next(q)
          } else {
            this.prompts.complete()
          }
        }
        break
      case 'cancel':
        {
          if (this.cancelAsker.isFirstQuestion(next)) {
            await this.cancelAsker.pullInfo(o.answer)
          }
          const q = await this.cancelAsker.getQuestion(next, o.answer)
          if (q) {
            this.prompts.next(q)
          } else {
            this.prompts.complete()
          }
        }
        break
    }
  }

  async onFinish(answers) {
    const [command] = answers.action.split('_')
    switch (command) {
      case 'limit':
        await this.limitAsker.execute(answers)
        break
      case 'cancel':
        await this.cancelAsker.execute(answers)
        break
    }
  }
}

export default new Asker()
