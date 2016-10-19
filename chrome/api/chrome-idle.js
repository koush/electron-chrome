const {
  makeEvent,
} = require('../main/global.js');

var idle = {
  onStateChanged: makeEvent(),
  queryState: function(detectionIntervalInSections, cb) {
    if (cb)
      cb('active');
  },
  setDetectionInterval: function(intervalInSections) {
  }
}

Object.assign(exports, idle);
