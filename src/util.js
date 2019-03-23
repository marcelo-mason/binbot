import BigNumber from 'bignumber.js'

class Util {
  init() {
    BigNumber.prototype.toFixedDown = function(precision) {
      return this.toFixed(precision, BigNumber.ROUND_DOWN)
    }
  }
}
export default new Util()
