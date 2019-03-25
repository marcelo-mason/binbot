import program from 'commander'

import commands from './commands'
import { log } from './logger'
import ui from './ui'
import inquire from './inquire'

process.on('unhandledRejection', log.error)

// commands

program
  .description('BinBot')
  .option(
    '-d, --defer-percentage',
    'Calculate the percentage at the time the order is triggered vs now'
  )
  .option('-c, --cancel-stops', 'Cancels existing stops before setting order')
  .option('-i, --iceberg', 'Creates iceberg orders where 95% is hidden')
  .option('-m, --maker-only', 'Order rejected if it would immediately match as a taker')
  .option('-A, --ascending', 'Ascending order quantities in spreads')
  .option('-D, --descending', 'Descending order quantities in spreads')

program
  .command('trigger-buy <base> <quote> <trigger> <price> <quantity>')
  .description('Sets a limit-buy when target price is reached')
  .action((base, quote, trigger, price, quantity) => {
    const opts = {
      iceberg: program.iceberg || false,
      makerOnly: program.makerOnly || false
    }
    commands.triggerbUY(base.toUpperCase(), quote.toUpperCase(), trigger, price, quantity, opts)
  })

program
  .command('trigger-sell <base> <quote> <trigger> <price> <percentage>')
  .description('Sets a limit-sell when target price is reached')
  .action((base, quote, trigger, price, percentage) => {
    const opts = {
      iceberg: program.iceberg || false,
      deferPercentage: program.deferPercentage || false,
      cancelStops: program.cancelStops || false,
      makerOnly: program.makerOnly || false
    }
    commands.triggerSell(
      base.toUpperCase(),
      quote.toUpperCase(),
      trigger,
      price,
      percentage.replace('%', ''),
      opts
    )
  })
/*
program
  .command('spread-buy <base> <quote> <min> <max> <quantity> [orders]')
  .description('Sets limit-buys across a price range')
  .action((base, quote, min, max, quantity, orders) => {
    const opts = {
      iceberg: program.iceberg || false,
      makerOnly: program.makerOnly || false,
      ascending: program.ascending || false,
      descending: program.descending || false
    }
    commands.spreadBuy(base.toUpperCase(), quote.toUpperCase(), min, max, quantity, orders, opts)
  })
*/
program
  .command('spread-sell <base> <quote> <min> <max> <percentage> [orders]')
  .description('Sets limit-sells across a price range')
  .action((base, quote, min, max, percentage, orders) => {
    const opts = {
      cancelStops: program.cancelStops || false,
      iceberg: program.iceberg || false,
      makerOnly: program.makerOnly || false,
      ascending: program.ascending || false,
      descending: program.descending || false
    }
    commands.spreadSell(
      base.toUpperCase(),
      quote.toUpperCase(),
      min,
      max,
      percentage.replace('%', ''),
      orders,
      opts
    )
  })

program
  .command('monitor')
  .description('Starts monitoring prices')
  .action(async () => {
    commands.monitor.start()
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
  console.log('  binbot trigger-buy KNC BTC 0.000041 0.000040 5000 -im')
  console.log('  binbot trigger-sell KNC BTC 0.000070 0.000071 25% -idcm')
  console.log('')
  console.log('  binbot spread-buy ONT BTC 0.00032000 0.00033000 5000 -imA')
  console.log('  binbot spread-sell ONT BTC 0.00042000.00043000 25% -icmD')
  console.log('')
  console.log('  binbot monitor')
})

program.parse(process.argv)
if (!process.argv.slice(2).length) {
  ;(async function() {
    await inquire.start()
  })()
}
