const electron = require('electron')
const NotificationView = require('./notificationView')
const ClickBehavior = require('./behaviors/clickBehavior')
const SwipeRightBehavior = require('./behaviors/swipeRightBehavior')

const { remote } = electron

class Notification {
    constructor(title, options) {
        this.mainWindow = remote.getCurrentWindow()
        this.view = new NotificationView(title, options)
        this.view.render()
        this.addBehavior(ClickBehavior)
        this.addBehavior(SwipeRightBehavior)
    }

    addBehavior(klass) {
        const item = new klass(this.view.element)
        item.on('behavior', (eventName) => {
            this.mainWindow.emit(eventName)
        })
    }
}

module.exports = Notification
