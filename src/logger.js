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
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
})

export const log = {
  log: (...args) => {
    console.log(...args)
  },
  info: (...args) => {
    console.log('')
    console.log(...args.map(x => chalk.blue(x)))
    logger.info(...args)
  },
  debug: (...args) => {
    console.log('')
    console.log(...args.map(x => chalk.magenta(x)))
    logger.debug(...args)
  },
  verbose: (...args) => {
    console.log('')
    console.log(...args)
    logger.verbose(...args)
  },
  warn: (...args) => {
    console.log('')
    console.log(...args.map(x => chalk.yellow(x)))
    logger.warn(...args)
  },
  error: (...args) => {
    console.log('')
    console.log(...args.map(x => chalk.red(x)))
    logger.error(...args)
  },
  sellTriggered: (order, ticker) => {
    logger.info(
      'order triggered',
      `p:${order.base}${order.quote} t:${order.direction}${order.trigger} p:${order.price} q:${
        order.percentage
      }%`
    )
    logger.verbose(ticker)
  },
  buyTriggered: (order, ticker) => {
    logger.info(
      'order triggered',
      `p:${order.base}${order.quote} t:${order.direction}${order.trigger} p:${order.price} q:${
        order.quantity
      }%`
    )
    logger.verbose(ticker)
  },
  deferredCalculation: (order, freeBalance) => {
    logger.info(
      `Calculating deferred percentage: ${order.percentage}% of ${freeBalance} ${order.base} = ${
        order.quantity
      }`
    )
  }
}
