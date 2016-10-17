const path = require('path');
const os = require('os');
const {electron, remote} = require('./electron-remote.js')
const {BrowserWindow, app, protocol, nativeImage} = electron;
const {throttleTimeout} = require('./util.js');
const {
  makeEvent,
  safeRegister,
  preventBrowserWindow,
  setGlobal,
  createWindowGlobals,
  deleteWindowGlobals,
} = require('../main/global.js');

const window = exports.window = {};
const runtime = exports.runtime = {};

const manifest = JSON.parse(JSON.stringify(remote.getGlobal('chromeManifest')));
const appDir = remote.getGlobal('chromeAppDir');
const appIcon = (function() {
  if (appDir && manifest && Object.keys(manifest.icons).length) {
    var key = Object.keys(manifest.icons).sort((a,b) => parseInt(a) < parseInt(b))[0].toString();
    var icon = path.join(appDir, manifest.icons[key]);
    console.log(`app icon: ${icon}`)
    return nativeImage.createFromPath(icon);
  }
})();

exports.runtime.onLaunched = makeEvent();

function loadWindowSettings(id) {
  return JSON.parse(localStorage.getItem('window-settings-' + id)) || {};
}

const windowMappings = {
  chromeToElectron: {},
  electronToChrome: {},
};
function updateWindowMappings() {
  setGlobal('windowMappings', windowMappings);
}

var hadWindows;
var windowMonitor = setInterval(function() {
  var hasWindows = Object.keys(windowMappings.chromeToElectron).filter(key => key != '__background').length;
  console.log(`window monitor hasWindows ${hasWindows}`)

  if (!hasWindows && !hadWindows) {
    if (os.platform() !== 'darwin') {
      chrome.runtime.shutdown();
    }
  }

  hadWindows = hasWindows;
}, 10000);

const windows = {};
const preloadPath = path.join(__dirname, '..', 'preload', 'chrome-preload.js');

// will be overwritten by preload script, as rpc can't do return values
exports.window.get = function(id) {
  return windows[id];
}

exports.window.create = function(options, cb) {
  var id = options.id;
  if (id == null)
    console.error('no id?')
  var w = windows[id];
  if (w) {
    cb(w, true);
    return;
  }

  var windowSettings = loadWindowSettings(id);
  var contentBounds = windowSettings.contentBounds || {};
  var frameless = options.frame && options.frame.type == 'none';
  var options = options.innerBounds || {};

  var opts = {
    show: false,
    frame: !frameless,
    icon: appIcon,
  };
  var copyProps = ['x', 'y', 'width', 'height', 'minWidth', 'minHeight'];
  for (var i in copyProps) {
    i = copyProps[i];
    opts[i] = contentBounds[i] || options[i];
  }

  console.log('creating window', id);
  opts.useContentSize = true;
  opts.webPreferences = {
    plugins: true,
    preload: preloadPath,
  }

  w = new BrowserWindow(opts);

  preventBrowserWindow(w);

  // need this cached because it becomes unaccessible after close
  var nativeId = w.id;
  windows[id] = w;
  windowMappings.electronToChrome[w.id] = id;
  windowMappings.chromeToElectron[id] = nativeId;
  updateWindowMappings();
  createWindowGlobals(nativeId);

  safeRegister(selfWindow, w, function() {
    console.log('window closed', id);
    if (windows[id] == w) {
      delete windowMappings.electronToChrome[nativeId];
      delete windowMappings.chromeToElectron[id];
      delete windows[id];
      deleteWindowGlobals(nativeId);
      updateWindowMappings();
    }
  }, 'close')

  var saveThrottle;
  function save() {
    saveThrottle = throttleTimeout(saveThrottle, null, 1000, function() {
      var data = {
        contentBounds: w.getContentBounds(),
        isDevToolsOpened: w.webContents.isDevToolsOpened()
      }
      localStorage.setItem('window-settings-' + id, JSON.stringify(data));
    })
  };

  safeRegister(selfWindow, w, save, 'resize');
  safeRegister(selfWindow, w, save, 'move');
  safeRegister(selfWindow, w.webContents, save, 'devtools-opened');
  safeRegister(selfWindow, w.webContents, save, 'devtools-closed');

  cb(w, false, windowSettings);
}

const selfWindow = remote.getCurrentWindow();
safeRegister(selfWindow, app, function() {
  runtime.onLaunched.invokeListeners(null, [{
    isKioskSession: false,
    isPublicSession: false,
    source: "command_line"
  }]);
}, 'activate');
