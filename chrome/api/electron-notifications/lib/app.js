const Notification = require('../notification')

const { ipcRenderer } = require('electron')

ipcRenderer.on('setup', (event, title, options) => {
  new Notification(title, options)
})
