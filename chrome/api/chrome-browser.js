const {shell} = require('electron');;

exports.openTab = function(options, cb) {
  shell.openExternal(options.url);
  if (cb)
    cb();
}
