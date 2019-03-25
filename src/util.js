import BigNumber from 'bignumber.js'
import chalk from 'chalk'

BigNumber.prototype.toFixedDown = function(precision) {
  return this.toFixed(precision, BigNumber.ROUND_DOWN)
}

export function bn(num) {
  return new BigNumber(num)
}

export function colorizeColumns(arr) {
  return arr.map(line => [chalk.whiteBright(line[0]), chalk.cyan(line[1])])
}

export function addQuoteSuffix(arr, quote) {
  return arr.map(line => [line[0], `${line[1]} ${quote}`, line[2], `${line[3]} ${quote}`, line[4]])
}
