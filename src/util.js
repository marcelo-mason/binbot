import BigNumber from 'bignumber.js'
import chalk from 'chalk'

BigNumber.prototype.toFixedDown = function(precision) {
  return this.toFixed(precision, BigNumber.ROUND_DOWN)
}

BigNumber.prototype.fix = function(precision) {
  return this.toFixedDown(precision).toString()
}

export function fix(num, precision) {
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
