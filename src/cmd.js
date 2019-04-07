import program from 'commander'

import monitor from './services/monitorService'
import { log } from './logger'
import ui from './ui'
import asker from './asker'

process.on('unhandledRejection', log.error)

program
  .command('monitor')
  .description('Starts monitoring prices')
  .action(async () => {
    monitor.start()
  })

program
  .command('test')
  .description('Test')
  .action(() => {
    ui.render()
  })

program.parse(process.argv)
if (!process.argv.slice(2).length) {
  ;(async function() {
    await asker.start()
  })()
}
