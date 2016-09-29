var storage = exports;

const {
  makeEvent,
} = require('../main/global.js');

storage.onChanged = makeEvent();

storage.local = {
  set: function(o, cb) {
    for (var i in o) {
      var oldValue = localStorage.getItem(i);
      var newValue = o[i];
      localStorage.setItem(i, JSON.stringify(newValue));
      storage.onChanged.invokeListeners(null, [{
        oldValue: oldValue,
        newValue: newValue
      }])
    }

    if (cb) {
      cb();
    }
  },

  get: function(k, cb) {
    var keys;
    if (k.constructor == Object)
      keys = k;
    else if (k.constructor == String)
      keys = [k];
    else if (k.constructor == Array)
      keys = k;

    var ret = {};
    for (var i in keys) {
      i = keys[i];
      ret[i] = JSON.parse(localStorage.getItem(i));
    }

    cb(ret);
  },

  getBytesInUse: function(keys, cb) {
    if (cb)
      cb(0);
  },

  remove: function(keys, cb) {
    if (typeof keys == 'string')
      keys = [keys];

    for (var key of keys) {
      localStorage.removeItem(key);
    }

    if (cb)
      cb();
  },

  clear: function(cb) {
    // uhhh this clears window-settings. and other stuff. should probably not do that.
    localStorage.clear();
    if (cb)
      cb();
  }
};
