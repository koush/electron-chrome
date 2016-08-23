exports.makeEvent = function makeEvent(runtime) {
  var listeners = [];
  return {
    addListener: function(l) {
      listeners.push(l);
    },

    removeListener: function(l) {
      listeners = listeners.filter(c => c != l);
    },

    invokeListeners: function(t, args) {
      for (var l in listeners) {
        l = listeners[l];
        l.apply(t, args);
      }
    }
  }
}

exports.safeWrapEvent = function makeEvent(w, e) {
  var addListener = e.addListener;

  var autoUnregister = require('electron').remote.getGlobal('autoUnregister');
  e.addListener = function(f) {
    autoUnregister(w, e, f);
    addListener(f);
  }
}
