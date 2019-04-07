/* eslint-disable no-throw-literal */
'use strict'
var blessed = require('blessed')
var Node = blessed.Node
var Box = blessed.Box
var stripAnsi = require('strip-ansi')

function Table(options) {
  var self = this

  if (!(this instanceof Node)) {
    return new Table(options)
  }

  if (Array.isArray(options.columnSpacing)) {
    throw 'Error: columnSpacing cannot be an array.\r\n' +
      'Note: From release 2.0.0 use property columnWidth instead of columnSpacing.\r\n' +
      'Please refere to the README or to https://github.com/yaronn/blessed-contrib/issues/39'
  }

  if (!options.columnWidth) {
    throw 'Error: A table must get columnWidth as a property. Please refer to the README.'
  }

  options = options || {}
  options.columnSpacing = options.columnSpacing == null ? 10 : options.columnSpacing
  options.bold = true
  options.selectedFg = options.selectedFg || 'white'
  options.selectedBg = options.selectedBg || 'blue'
  options.fg = options.fg || 'green'
  options.bg = options.bg || ''
  options.interactive = typeof options.interactive === 'undefined' ? true : options.interactive
  this.options = options
  Box.call(this, options)

  this.rows = blessed.list({
    // height: 0,
    top: 0,
    width: 0,
    left: 1,
    style: {
      selected: {
        fg: options.selectedFg,
        bg: options.selectedBg
      },
      item: {
        fg: options.fg,
        bg: options.bg
      }
    },
    keys: options.keys,
    vi: options.vi,
    tags: true,
    interactive: options.interactive,
    screen: this.screen
  })

  this.append(this.rows)

  this.on('attach', function() {
    if (self.options.data) {
      self.setData(self.options.data)
    }
  })
}

Table.prototype = Object.create(Box.prototype)

Table.prototype.focus = function() {
  this.rows.focus()
}

Table.prototype.render = function() {
  if (this.screen.focused == this.rows) this.rows.focus()

  this.rows.width = this.width - 3
  this.rows.height = this.height - 2
  Box.prototype.render.call(this)
}

Table.prototype.setData = function(table) {
  var self = this

  var dataToString = function(d) {
    var str = ''
    d.forEach(function(r, i) {
      var colsize = self.options.columnWidth[i]
      var strip = stripAnsi(r.toString())
      var ansiLen = r.toString().length - strip.length
      var spaceLength = colsize - strip.length + self.options.columnSpacing
      r = r.toString().substring(0, colsize + ansiLen) // compensate for ansi len
      if (spaceLength < 0) {
        spaceLength = 0
      }
      var spaces = new Array(spaceLength).join(' ')
      str += r + spaces
    })
    return str
  }

  var formatted = []

  table.data.forEach(function(d) {
    var str = dataToString(d)
    formatted.push(str)
  })
  this.rows.setItems(formatted)
}

Table.prototype.getOptionsPrototype = function() {
  return {
    keys: true,
    fg: 'white',
    interactive: false,
    label: 'Active Processes',
    width: '30%',
    height: '30%',
    border: { type: 'line', fg: 'cyan' },
    columnSpacing: 10,
    columnWidth: [16, 12]
  }
}

Table.prototype.type = 'table'

module.exports = Table
