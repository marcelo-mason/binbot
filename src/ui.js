import blessed from 'blessed'
import Case from 'case'
import Table from './controls/table'
import _ from 'lodash'
import keys from '../keys.json'

import { getFormattedQty } from './util'

class UI {
  constructor() {
    this.tables = []
    this.screen = null
    this.layout = null
  }

  init() {
    if (this.screen) {
      return
    }

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

    this.screen.key(['escape', 'quote', 'C-c'], () => {
      return this.screen.destroy()
    })
  }

  create(id) {
    const table = {
      id,
      table: new Table({
        parent: this.layout,
        keys: false,
        fg: 'white',
        interactive: false,
        label: '',
        width: '25%',
        height: '33%',
        border: { type: 'line', fg: 'cyan' },
        columnSpacing: 3,
        columnWidth: [10, 15]
      })
    }
    this.tables.push(table)
    return table
  }

  get(id) {
    this.init()
    const exists = _.find(this.tables, { id })
    if (!exists) {
      return this.create(id)
    }
    return exists
  }

  remove(id) {
    _.remove(this.tables, { id })
  }

  update(orders) {
    const packOrder = o => {
      const data = []

      if (keys.length > 1) {
        data.push(['Account', `${Case.capital(o.account)}`])
      }

      data.push(['Action', `${Case.capital(o.data.type)} ${Case.capital(o.data.side)}`])

      data.push(['Pair', `${o.data.pair}`])
      data.push(['Quantity', getFormattedQty(o.data)])

      if (o.data.orderCount > 1) {
        data.push(['Min Price', o.data.min])
        data.push(['Max Price', o.data.max])
        data.push([
          'Orders',
          `${o.data.orderCount} ${o.data.dist} (${o.data.opts.iceberg ? 'i' : ''}${
            o.data.opts.maker ? 'm' : ''
          }${o.data.opts.cancelStops ? 's' : ''})`
        ])
      } else {
        data.push([`${Case.capital(o.data.side)} Price`, o.data.price])
      }
      data.push(['Trigger', o.data.trigger])
      if (o.state) {
        data.push(['Current', o.state.currentPrice])
        data.push(['Distance', o.state.distance])
      }
      return data
    }

    orders.forEach(o => {
      const packed = packOrder(o)
      const { table } = this.get(o.id)
      table.setLabel(` ${o.id} `)
      table.setData({
        data: packed
      })
    })

    this.screen.render()
  }
}
export default new UI()
