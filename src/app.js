import { createApp } from './lib/app.js'
import { log, initLog } from './services/platform.js'
import { APP_VERSION } from './lib/appversion.js'

export default createApp({
  setViewPort: 0,
  onLaunch(options) {
    initLog(APP_VERSION)
    log('app launch', JSON.stringify(options || {}))
  },
  onShow() {
    log('app show')
  },
  onHide() {
    log('app hide')
  }
})
