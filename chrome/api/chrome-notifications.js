const {
  makeEvent,
} = require('../main/global.js');

const notifier = require('./electron-notifications')

var openNotifications = {};

var notifications = exports;
const {electron, remote} = require('./electron-remote.js')

var selfWindow = remote.getCurrentWindow();
const safeRegister = remote.getGlobal('safeRegister');

notifications.create = function(nid, opts, cb) {
  var buttons = (opts.buttons || [])
  .map(item => item.title);
  const n = notifier.notify(opts.title, {
    icon: opts.iconUrl,
    message: opts.message,
    buttons: buttons,
    vertical: true,
    flat: true,
  });

  openNotifications[nid] = n;


  safeRegister(selfWindow, n, function() {
    notifications.onClosed.invokeListeners(null, [nid]);
    delete openNotifications[n];
  }, 'close')

  safeRegister(selfWindow, n, function() {
    notifications.onClicked.invokeListeners(null, [nid])
  }, 'clicked')

  safeRegister(selfWindow, n, function(text, buttonIndex) {
    notifications.onButtonClicked.invokeListeners(null, [nid, buttonIndex]);
  }, 'buttonClicked')

  if (cb)
    cb(nid);
}

notifications.clear = function(nid, cb) {
  var n = openNotifications[nid];
  if (n)
    n.close();
  if (cb)
    cb(n != null);
}

notifications.onClicked = makeEvent();
notifications.onButtonClicked = makeEvent();
notifications.onClosed = makeEvent();
