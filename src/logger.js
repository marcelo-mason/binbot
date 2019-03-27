import winston from 'winston'
import chalk from 'chalk'

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    //
    // - Write to all logs with level `info` and below to `combined.log`
    // - Write all logs error (and below) to `error.log`.
    //
    new winston.transports.File({ filename: 'combined.log' })
  ]
})

export const log = {
  log: (...args) => {
    console.log(...args)
  },
  info: (...args) => {
    console.log(chalk.blue(args[0]), ...args.slice(1))
    logger.info(...args)
  },
  debug: (...args) => {
    console.log(chalk.magenta(args[0]), ...args.slice(1))
    logger.debug(...args)
  },
  verbose: (...args) => {
    console.log(...args)
    logger.verbose(...args)
  },
  warn: (...args) => {
    console.log(chalk.bold.white(args[0]), ...args.slice(1))
    logger.warn(...args)
  },
  error: (...args) => {
    console.log(chalk.red(args[0]), ...args.slice(1))
    logger.error(...args)
  }
}
