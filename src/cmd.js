import program from 'commander'

import monitor from './services/monitorService'
import { log } from './logger'
import asker from './asker'

process.on('unhandledRejection', log.error)

program
  .command('monitor')
  .description('Starts monitoring prices')
  .action(async () => {
    monitor.start()
  })

program.parse(process.argv)
if (!process.argv.slice(2).length) {
  ;(async function() {
    await asker.start()
  })()
}
