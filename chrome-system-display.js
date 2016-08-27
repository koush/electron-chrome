const {screen} = require('electron');

function getInfo(cb) {
  var displays = screen.getAllDisplays();

  var ret = displays.map(function(s) {
    return {
      id: s.id,
      name: 'display-' + s.id,
      isPrimary: screen.getPrimaryDisplay().id == s.id,
      isInternal: s.bounds.x == 0 && s.bounds.y == 0,
      isEnabled: true,
      dpiX: 160, // make some shit up
      dpiY: 160,
      bounds: s.bounds,
      overscan: {left:0, right:0, top:0, bottom:0},
      workArea: s.workArea,
      modes: [],
    }
  })

  cb(ret);
}

exports.getInfo = getInfo;
