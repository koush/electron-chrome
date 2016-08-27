const remote =  require('electron').remote;
const {BrowserWindow} = remote;

const {
  safeRegister,
} = require('../main/global.js');

const selfBrowserWindow = remote.getCurrentWindow();

function chooseDesktopMedia(types, cb) {
  var chooser = new BrowserWindow({
    title: 'Share Your Screen',
    width: 1024,
    height: 768
  });

  safeRegister(selfBrowserWindow, chooser, function() {
    if (cb) {
      cb();
      cb = null;
    }
  }, 'close');
  chooser.webContents.once('did-finish-load', function() {
    console.log('didfinishload')
    chooser.emit('pickDesktopMedia', types);
  })
  chooser.loadURL(`file://${__dirname}/chrome-desktopcapture-picker.html`);

  safeRegister(selfBrowserWindow, chooser, function(id) {
    console.log('chose', id);
    if (cb) {
      cb(id);
      cb = null;
    }
  }, 'choseDesktopMedia')
}

exports.chooseDesktopMedia = chooseDesktopMedia;
