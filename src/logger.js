import winston from 'winston'
import color from 'colors'

const logger = winston.createLogger({
  transports: [new winston.transports.File({ filename: 'combined.log' })]
})

function parse(text) {
  if (text === undefined || text === null) {
    text = ''
  }
  return text
}

export const log = {
  log: text => {
    console.log(parse(text))
  },
  info: text => {
    console.log(color.white(parse(text)))
    logger.info(parse(text))
  },
  verbose: text => {
    logger.verbose(parse(text))
  },
  error: text => {
    console.log(color.red(parse(text)))
    logger.error(text)
  },
  sellTriggered: (order, ticker) => {
    this.info(
      'order triggered',
      `p:${order.base}${order.quote} t:${order.direction}${order.triggerPrice} p:${order.price} q:${
        order.percentage
      }%`
    )
    this.verbose(ticker)
  },
  buyTriggered: (order, ticker) => {
    this.info(
      'order triggered',
      `p:${order.base}${order.quote} t:${order.direction}${order.triggerPrice} p:${order.price} q:${
        order.quantity
      }%`
    )
    this.verbose(ticker)
  },
  deferredCalculation: (order, freeBalance) => {
    this.info(
      `Calculating deferred percentage: ${order.percentage}% of ${freeBalance} ${order.base} = ${
        order.quantity
      }`
    )
  }
}
