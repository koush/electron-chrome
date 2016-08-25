const notifier = require('./electron-notifications')

var openNotifications = {};

var notifications = exports;

notifications.create = function(nid, opts, cb) {
  var buttons = (opts.buttons || [])
  .map(item => item.title);
  const n = notifier.notify(opts.title, {
    icon: opts.iconUrl,
    message: opts.message,
    buttons: buttons
  });

  openNotifications[nid] = n;

  n.on('close', function() {
    chrome.notifications.onClosed.invokeListeners(null, [nid]);
    delete openNotifications[n];
  })

  n.on('clicked', function() {
    chrome.notifications.onClicked.invokeListeners(null, [nid])
  })

  n.on('buttonClicked', function(text, buttonIndex) {
    chrome.notifications.onButtonClicked.invokeListeners(null, [nid, buttonIndex]);
  })

  cb(nid);
}

notifications.clear = function(nid, cb) {
  var n = openNotifications[nid];
  if (n)
    n.close();
  if (cb)
    cb(n != null);
}
