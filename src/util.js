import BigNumber from 'bignumber.js'
import chalk from 'chalk'

BigNumber.prototype.toFixedDown = function(precision) {
  return this.toFixed(precision, BigNumber.ROUND_DOWN)
}

BigNumber.prototype.fix = function(precision) {
  return this.toFixedDown(precision).toString()
}

export function toPrecision(num) {
  const [integer, fraction] = num.split('.')

  if (integer == 1){
    return 0
  }
  return fraction.indexOf('1') + 1
}

export function fix(num, precision) {
  if (!num) {
    return num
  }
  return bn(num).fix(precision)
}

export function bn(num) {
  return new BigNumber(num)
}

export function colorizeColumns(arr) {
  return arr.map(line => [chalk.whiteBright(line[0]), chalk.cyan(line[1])])
}

export function timestamp() {
  return Math.round(new Date().getTime() / 1000)
}

export function getFormattedQty(data) {
  if (data.qtyType === 'percent-base') {
    return `${data.qtyValue}% ${data.base}`
  }
  if (data.qtyType === 'percent-quote') {
    return `${data.qtyValue}% ${data.quote}`
  }
  if (data.qtyType === 'base') {
    return `${data.qtyValue} ${data.base}`
  }
  if (data.qtyType === 'quote') {
    return `${data.qtyValue} ${data.quote}`
  }
}
