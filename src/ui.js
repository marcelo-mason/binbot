import blessed from 'blessed'

class UI {
  constructor() {
    this.isInit = false
    this.index = {
      id: 0,
      pair: 1,
      side: 2,
      price: 3,
      quantity: 4,
      trigger: 5,
      currentPrice: 6,
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
        order.state.currentPrice,
        order.state.distance
      ]
    }
  }

  init() {
    if (this.isInit) {
      return
    }
    this.isInit = true

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

    this.table = blessed.listtable({
      parent: this.layout,
      top: '0',
      width: '100%',
      data: null,
      border: 'line',
      align: 'left',
      tags: true,
      noCellBorders: true,
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

    this.screen.key(['escape', 'q', 'C-c'], () => {
      return this.screen.destroy()
    })

    this.screen.render()
  }

  update(grouped) {
    this.init()
    const data = grouped.reduce((acc, { orders }) => {
      const arrs = orders.map(o => this.formatOrder(o))
      return acc.concat(arrs)
    }, this.titles)
    this.table.setData(data)
    this.screen.render()
  }
}

export default new UI()
