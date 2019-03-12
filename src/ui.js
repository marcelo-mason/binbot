import blessed from 'blessed'
import BigNumber from 'bignumber.js'

class UI {
  constructor() {
    this.listData = [[]]
    this.index = {
      id: 0,
      pair: 1,
      side: 2,
      price: 3,
      quantity: 4,
      trigger: 5,
      current: 6,
      distance: 7
    }
    this.titles = [
      ['Id', 'Pair', 'Side', 'Price', 'Quantity', 'Trigger Price', 'Current Price', 'Distance']
    ]
    this.formatOrder = order => {
      return [
        order.id,
        order.pair,
        order.side,
        order.price,
        order.quantity === 'tbd' ? `${order.percentage}%` : order.quantity,
        order.triggerPrice,
        ''
      ]
    }
  }

  render() {
    this.screen = blessed.screen({
      smartCSR: true,
      autoPadding: true,
      warnings: false
    })

    this.layout = blessed.layout({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '100%',
      height: '100%'
    })

    this.table = blessed.table({
      parent: this.layout,
      top: '0',
      width: '100%',
      data: null,
      border: 'line',
      align: 'left',
      tags: true,
      style: {
        border: {
          fg: 'white'
        },
        header: {
          fg: 'blue',
          bold: true
        }
      }
    })

    this.table.setData(this.listData)

    this.screen.key('escape', function() {
      return this.screen.destroy()
    })

    this.screen.render()
  }

  updateTable() {
    this.table.setData(this.listData)
    this.screen.render()
    this.screen.cursorReset()
  }

  populate(grouped) {
    this.render()

    this.listData = grouped.reduce((acc, { orders }) => {
      const arrs = orders.map(o => this.formatOrder(o))
      return acc.concat(arrs)
    }, this.titles)

    this.updateTable()
  }

  updatePrices(ticker) {
    this.listData.forEach(row => {
      if (row[this.index.pair] === ticker.symbol) {
        row[this.index.current] = ticker.currentClose
        const distance = new BigNumber(row[this.index.trigger])
          .minus(ticker.currentClose)
          .absoluteValue()
          .dividedBy(row[this.index.trigger])
          .multipliedBy(100)
          .toFixed(2)
          .toString()
        row[this.index.distance] = `${distance}%`
      }
    })
    this.updateTable()
  }
}

export default new UI()
