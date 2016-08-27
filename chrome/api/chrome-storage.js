storage = exports;

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
  }
};
