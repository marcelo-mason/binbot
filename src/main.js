import { config } from 'dotenv'
import program from 'commander'
import commands from './commands'
import forever from 'forever-monitor'

const envFile = process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : '.env'
config({ path: envFile })

process.on('unhandledRejection', (reason, p) => {
  console.log(p)
})

// commands

program.description('BinBot')

program.command('run').action(() => {
  var child = new forever.Monitor('./src/monitor.js', {
    max: 1000
  })

  child
    .on('restart', () => {
      console.log('binbot has restarted')
    })
    .on('exit', () => {
      console.log('binbot has exited after 100 restarts')
    })

  child.start()
})

program
  .command('snipebuy <coin> <currency> <price> <amount>')
  .action((coin, currency, price, amount) => {
    commands.snipeBuy(coin, currency, price, amount)
  })

program
  .command('snipesell <coin> <currency> <price> <amount>')
  .action((coin, currency, price, amount) => {
    commands.snipeSell(coin, currency, price, amount)
  })

program.on('--help', () => {
  console.log('')
  console.log('Examples:')
  console.log('  binbot snipebuy BNB USDT 14.5 250')
  console.log('  binbot snipesell BNB USDT 22 250')
})

program.parse(process.argv)
if (!process.argv.slice(2).length) {
  program.help()
}
