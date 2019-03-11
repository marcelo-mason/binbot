import program from 'commander'
import commands from './commands'

process.on('unhandledRejection', (reason, p) => {
  console.log(p)
})

// commands

program
  .description('BinBot')
  .option('-d, --defer-percentage', 'Calculate the percentage at the time the order is set')

program
  .command('sell <base> <quote> <triggerPrice> <sellPrice> <percentage>')
  .description('Sets limit sell when target price is reached')
  .action((base, quote, triggerPrice, sellPrice, percentage) => {
    commands.sell(
      base.toUpperCase(),
      quote.toUpperCase(),
      triggerPrice,
      sellPrice,
      percentage.replace('%', ''),
      program.deferPercentage
    )
  })

program
  .command('list')
  .description('List pending actions')
  .action(() => {
    commands.list()
  })

program
  .command('run')
  .description('Starts monitoring prices')
  .action(() => {
    commands.start()
  })

program.on('--help', () => {
  console.log('')
  console.log('Examples:')
  console.log('  binbot sell KNC BTC 0.000070 0.000071 50%')
  console.log('  binbot list')
  console.log('  binbot run')
})

program.parse(process.argv)
if (!process.argv.slice(2).length) {
  program.help()
}
