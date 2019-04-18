import chalk from 'chalk'


export const log = {
  log: (...args) => {
    console.log(...args)
  },
  info: (...args) => {
    console.log(chalk.blue(args[0]), ...args.slice(1))
  },
  debug: (...args) => {
    console.log(chalk.magenta(args[0]), ...args.slice(1))
  },
  verbose: (...args) => {
    console.log(...args)
  },
  warn: (...args) => {
    console.log(chalk.bold.white(args[0]), ...args.slice(1))
  },
  error: (...args) => {
    console.log(chalk.red(args[0]), ...args.slice(1))
  }
}
