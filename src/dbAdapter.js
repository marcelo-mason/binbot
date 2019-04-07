import Base from 'lowdb/adapters/Base'
import Keyv from 'keyv'

const db = new Keyv('sqlite://db.sqlite')

export default class dbAdapter extends Base {
  read() {
    return new Promise(async resolve => {
      const data = await db.get('data')
      if (data) {
        resolve(this.deserialize(data))
      } else {
        await db.set('data', this.serialize(this.defaultValue))
        resolve(this.defaultValue)
      }
    })
  }

  write(data) {
    return db.set('data', this.serialize(data))
  }
}
