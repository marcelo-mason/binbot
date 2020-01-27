import program from 'commander'
import async from 'awaitable-async'

import { log } from './logger'
import asker from './asker'

process.on('unhandledRejection', log.error)

program.parse(process.argv)
if (!process.argv.slice(2).length) {
  ;(async function() {
    // await async.forever(async next => {
    await asker.start()
    // next()
    // })
  })()
}
