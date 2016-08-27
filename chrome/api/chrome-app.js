const electron = require('electron').remote || require('electron');
const {BrowserWindow, app, protocol} = electron;
const {
  makeEvent,
} = require('../main/global.js');

exports.window = {};
exports.runtime = {};

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

const windows = {};
const preloadPath = path.join(__dirname, '..', 'preload', 'chrome-preload.js');
exports.window.create = function(options, cb) {
  console.log(arguments);
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
  safeRegister(selfWindow, w, save, 'devtools-opened');
  safeRegister(selfWindow, w, save, 'devtools-closed');

  cb(w, false, windowSettings);
}

safeRegister(selfWindow, app, function() {
  chrome.app.runtime.onLaunched.invokeListeners(null, [{
    isKioskSession: false,
    isPublicSession: false,
    source: "command_line"
  }]);
}, 'activate');
