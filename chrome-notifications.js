const notifier = require('./electron-notifications')

var openNotifications = {};

var notifications = exports;

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
  });

  openNotifications[nid] = n;


  safeRegister(selfWindow, n, function() {
    chrome.notifications.onClosed.invokeListeners(null, [nid]);
    delete openNotifications[n];
  }, 'close')

  safeRegister(selfWindow, n, function() {
    chrome.notifications.onClicked.invokeListeners(null, [nid])
  }, 'clicked')

  safeRegister(selfWindow, n, function() {
    chrome.notifications.onButtonClicked.invokeListeners(null, [nid, buttonIndex]);
  }, 'buttonClicked')

  cb(nid);
}

notifications.clear = function(nid, cb) {
  var n = openNotifications[nid];
  if (n)
    n.close();
  if (cb)
    cb(n != null);
}
