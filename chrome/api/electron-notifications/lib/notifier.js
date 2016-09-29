const electron = require('electron')

class Notifier {
  constructor () {
    this.queue = []
    if (process.type === 'renderer') {
      this.BrowserWindow = electron.remote.BrowserWindow
    } else {
      this.BrowserWindow = electron.BrowserWindow
    }
  }

  notify (title, data) {
    const options = Object.assign({}, data)
    const size = electron.screen.getPrimaryDisplay().workAreaSize
    let verticalSpace = 0
    if (options.vertical && options.buttons && options.buttons.length) {
      verticalSpace = Math.min(options.buttons.length * 40, 80)
    }
    else {
      options.vertical = false;
    }
    const notificationWindow = new this.BrowserWindow({
      width: 440,
      height: 120 + verticalSpace,
      x: size.width - 440,
      y: 0,
      frame: false,
      transparent: true,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      titleBarStyle: 'hidden',
      show: false
    })
    this.queue.push({ notificationWindow, title, options })
    this.maybeShowNotification();
    return notificationWindow
  }

  maybeShowNotification () {
    if (this.active || this.queue.length === 0) return

    this.active = true

    const notification = this.queue.shift()
    const { title, options } = notification
    let { notificationWindow } = notification

    notificationWindow.loadURL('file://' + __dirname + '/assets/notification.html')

    notificationWindow.webContents.on('did-finish-load', () => {
      notificationWindow.show()
      notificationWindow.webContents.send('setup', title, options)
    })

    const timeout = setTimeout(() => {
      notificationWindow.close()
    }, options.duration || 4000)

    const currentWindow = electron.remote && electron.remote.getCurrentWindow()
    if (currentWindow) {
      currentWindow.on('close', () => {
        if (notificationWindow) {
          notificationWindow.removeAllListeners()
          notificationWindow.webContents.removeAllListeners()
        }
      })
    }

    notificationWindow.on('closed', () => {
      this.active = false
      clearTimeout(timeout)
      notificationWindow = null
      this.maybeShowNotification();
    })
  }
}

module.exports = Notifier
