import program from 'commander'
import commands from './commands'
import { log } from './logger'
import ui from './ui'

process.on('unhandledRejection', log.error)

// commands

program
  .description('BinBot')
  .option('-d, --defer-percentage', 'Calculate the percentage at the time the order is set')
  .option('-c, --cancel-stops', 'Cancels existing stops before setting order')
  .option('-i, --iceberg-order', 'Created an iceberg order where 95% of it is hidden')
  .option('-m, --maker-only', 'Order rejected if it would immediately match as a taker')

program
  .command('sell <base> <quote> <triggerPrice> <price> <percentage>')
  .description('Sets limit sell when target price is reached')
  .action((base, quote, triggerPrice, price, percentage) => {
    const opts = {
      deferPercentage: program.deferPercentage || false,
      cancelStops: program.cancelStops || false,
      icebergOrder: program.icebergOrder || false,
      makerOnly: program.makerOnly || false
    }
    commands.sell(
      base.toUpperCase(),
      quote.toUpperCase(),
      triggerPrice,
      price,
      percentage.replace('%', ''),
      opts
    )
  })

program
  .command('buy <base> <quote> <triggerPrice> <price> <percentage>')
  .description('Sets limit buy when target price is reached')
  .action((base, quote, triggerPrice, price, percentage) => {
    const opts = {
      deferPercentage: program.deferPercentage || false,
      cancelStops: program.cancelStops || false,
      icebergOrder: program.icebergOrder || false,
      makerOnly: program.makerOnly || false
    }
    commands.buy(
      base.toUpperCase(),
      quote.toUpperCase(),
      triggerPrice,
      price,
      percentage.replace('%', ''),
      opts
    )
  })

program
  .command('list')
  .description('List pending actions')
  .action(() => {
    commands.list()
  })

program
  .command('monitor')
  .description('Starts monitoring prices')
  .action(() => {
    commands.monitor()
  })

program
  .command('test')
  .description('Test')
  .action(() => {
    ui.render()
  })

program.on('--help', () => {
  console.log('')
  console.log('Examples:')
  console.log('  binbot sell KNC BTC 0.000070 0.000071 50% -ci')
  console.log('  binbot list')
  console.log('  binbot run')
})

program.parse(process.argv)
if (!process.argv.slice(2).length) {
  program.help()
}
