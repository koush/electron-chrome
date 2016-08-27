exports.remote = require('electron').remote || {
  getGlobal: function(key) {
    return global[key];
  },
  getCurrentWindow: function() {
  }
}

exports.electron = require('electron').remote || require('electron');
