exports.makeEvent = function() {
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
