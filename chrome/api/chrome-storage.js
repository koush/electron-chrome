var storage = exports;

const {
  makeEvent,
} = require('../main/global.js');

storage.onChanged = makeEvent();

function makeChromeStorage(storageName) {
  var chromeStorage;
  try {
    chromeStorage = JSON.parse(localStorage.getItem(storageName)) || {};
  }
  catch (e) {
    chromeStorage = {};
  }

  function saveChromeStorage() {
    localStorage.setItem(storageName, JSON.stringify(chromeStorage));
  }

  return {
    set: function(o, cb) {
      for (var i in o) {
        var oldValue = chromeStorage[i];
        var newValue = o[i];
        chromeStorage[i] = newValue;
        saveChromeStorage();
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
      if (k == null) {
        cb(chromeStorage);
        return;
      }

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
        ret[i] = chromeStorage[i];
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
        delete chromeStorage[key];
      }
      saveChromeStorage();

      if (cb)
        cb();
    },

    clear: function(cb) {
      // uhhh this clears window-settings. and other stuff. should probably not do that.
      chromeStorage = {};
      saveChromeStorage();
      if (cb)
        cb();
    }
  };

}

storage.local = makeChromeStorage('chrome.storage.local');
storage.sync = makeChromeStorage('chrome.storage.sync');
