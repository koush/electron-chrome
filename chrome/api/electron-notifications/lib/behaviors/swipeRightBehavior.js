const electron = require('electron')
const EventEmitter = require('events')

const { remote } = electron

class SwipeRightBehavior extends EventEmitter {
  constructor () {
    super()
    this.mainWindow = remote.getCurrentWindow()
    this.xLeader = this.mainWindow.getPosition()[0]
    this.xFollower = this.xLeader
    this.mainWindow.on('move', this.move.bind(this))
  }

  move () {
    this.xFollower = this.xLeader
    this.xLeader = this.mainWindow.getPosition()[0]
    if (this.xFollower < this.xLeader) {
      this.emit('behavior', 'swipedRight')
    }
  }
}

module.exports = SwipeRightBehavior
