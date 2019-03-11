import { config } from 'dotenv'
import program from 'commander'
import commands from './commands'

const envFile = process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : '.env'
config({ path: envFile })

process.on('unhandledRejection', (reason, p) => {
  console.log(p)
})

// commands

program.description('BinBot')

program
  .command('sell <pair> <triggerPrice> <sellPrice> <percentage>')
  .description('Sets limit sell when target price is reached')
  .action((pair, triggerPrice, sellPrice, percentage) => {
    commands.sell(pair, triggerPrice, sellPrice, percentage)
  })

program
  .command('list')
  .description('List pending actions')
  .action(() => {
    commands.list()
  })

program
  .command('start')
  .description('Starts monitoring prices')
  .action(() => {
    commands.start()
  })

program.on('--help', () => {
  console.log('')
  console.log('Examples:')
  console.log('  binbot snipebuy BNB USDT 14.5 250')
  console.log('  binbot snipesell BNB USDT 22 250')
  console.log('  binbot list')
  console.log('  binbot start')
})

program.parse(process.argv)
if (!process.argv.slice(2).length) {
  program.help()
}
