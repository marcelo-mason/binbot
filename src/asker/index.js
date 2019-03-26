import inquirer from 'inquirer'
import { Subject } from 'rxjs'
import { log } from '../logger'

import spreadBuy from './spreadBuy'
import spreadSell from './spreadSell'
// import triggerSell from './triggerSell'
// import triggerBuy from './triggerBuy'

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

const prompts = new Subject()

class Inquire {
  async init() {
    inquirer.registerPrompt('input-plus', require('./addons/input'))
    inquirer.registerPrompt('autocomplete', require('./addons/autocomplete'))
    inquirer.registerPrompt('checkbox-plus', require('inquirer-checkbox-plus-prompt'))
    const prompt = inquirer.prompt(prompts)
    prompt.ui.process.subscribe(this.onEachAnswer, log.error)
    prompt.then(async answers => {
      await this.execute(answers)
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
        if (!spreadBuy.isLastQuestion(next)) {
          prompts.next(await spreadBuy.questions[next](o.answer))
        } else {
          prompts.complete()
        }
        break
      case 'ss':
        if (spreadSell.isLastQuestion(next)) {
          prompts.complete()
          return
        }
        prompts.next(await spreadSell.questions[next](o.answer))
        break
      /*
      case 'tb':
        if (triggerBuy.isLastQuestion(next)) {
          prompts.complete()
          return
        }
        prompts.next(await triggerBuy.questions[next](o.answer))
        break
      case 'ts':
        if (triggerSell.isLastQuestion(next)) {
          prompts.complete()
          return
        }
        prompts.next(await triggerSell.questions[next](o.answer))
        break 
      */
    }
  }

  async execute(answers) {
    switch (answers.ac) {
      case 'sb':
        await spreadBuy.execute(answers)
        break
      case 'ss':
        await spreadSell.execute(answers)
      /*
      case 'tb':
        await triggerBuy.execute(answers)
        break
      case 'ts':
        await triggerSell.execute(answers)
        break
      */
    }
  }
}

export default new Inquire()
