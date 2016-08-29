const {makeEvent} = require('../event.js');

class MessageSender {
  constructor (extensionId) {
    this.id = extensionId
    this.url = `chrome-extension://${extensionId}`
  }
}

class Port {
  constructor (name) {
    this.name = name
    this.onDisconnect = makeEvent()
    this.onMessage = makeEvent()
    this.sender = new MessageSender(name)

    this.disconnected = false

    // immediately disconnect, not implemented
    process.nextTick(this.disconnect.bind(this))
  }

  disconnect () {
    if (this.disconnected) return

    this._onDisconnect()
  }

  postMessage (message) {
  }

  _onDisconnect () {
    this.disconnected = true
    this.onDisconnect.invokeListeners()
  }
}

exports.Port = Port;
