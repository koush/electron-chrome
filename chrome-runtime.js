const path = require('path');
const {remote, shell} = require('electron');
const {BrowserWindow, app, protocol} = remote;
var {makeEvent} = require('./chrome-event.js');
const fs = require('fs');
const os = require('os');

var manifest = remote.getGlobal('chromeManifest');
var appId = remote.getGlobal('chromeAppId');

console.log('chrome runtime started');

remote.getGlobal('eval')('global.setGlobal = function(n, v) { global[n] = v }');

var setGlobal = remote.getGlobal('setGlobal');
function evalFunc(f) {
  remote.getGlobal('eval')(f.toString())
}

evalFunc(makeEvent);
makeEvent = remote.getGlobal('makeEvent');

var selfWindow = remote.getCurrentWindow();
// need to watch for a lot of close events...
selfWindow.setMaxListeners(1000);

var windows = {};
var windowMappings = {
  chromeToElectron: {},
  electronToChrome: {},
};
var backgroundPage;

function updateWindowMappings() {
  setGlobal('windowMappings', windowMappings);
}

(function() {
  remote.getGlobal('eval')('global.windowGlobals = {}');

  function setWindowGlobal(id, k, v) {
    var w = windowGlobals[id];
    if (!w) {
      console.error('windowGlobals not found', id);
      return;
    }

    w[k] = v;
  }

  function createWindowGlobals(id) {
    if (windowGlobals[id]) {
      console.error('windowGlobals', id, 'already exists');
      return;
    }
    windowGlobals[id] = {};
  }

  function deleteWindowGlobals(id) {
    delete windowGlobals[id];
  }

  function getWindowGlobal(id, k) {
    var w = windowGlobals[id];
    if (!w) {
      console.error('windowGlobals not found', id);
      return;
    }
    return w[k];
  }

  function getWindowGlobals(id) {
    var w = windowGlobals[id];
    if (!w) {
      console.error('windowGlobals not found', id);
      return;
    }
    return w;
  }

  evalFunc(createWindowGlobals);
  evalFunc(deleteWindowGlobals);
  evalFunc(setWindowGlobal);
  evalFunc(getWindowGlobal);
  evalFunc(getWindowGlobals);
})();

var getWindowGlobal = remote.getGlobal('getWindowGlobal');
var createWindowGlobals = remote.getGlobal('createWindowGlobals');
var deleteWindowGlobals = remote.getGlobal('deleteWindowGlobals');
var setWindowGlobal = remote.getGlobal('setWindowGlobal');

global.chrome = {
  app: {
    window: {},
    runtime: {},
  }
};

var hostMap = {
  "darwin": "mac",
  "win32" : "win",
  "linux": "linux",
}

var archMap = {
  "arm": "arm",
  "arm64": "arm",
  "x86": "x86-32",
  "x32": "x86-32", // ??
  "x64": "x86-64",
}

chrome.runtime = {
  onMessage: makeEvent(),
  onMessageExternal: makeEvent(),
  sendMessage: function() {
    console.log('dropping message on the floor', arguments);
  },
  // directory: appDir,
  manifest: manifest,
  requestUpdateCheck: function(cb) {
    // status, details
  },
  reload: function() {
    var hadWindows;
    var backgroundId = windows['background'] && windows['background'].id;
    console.log('shutting down');
    for (var w of BrowserWindow.getAllWindows()) {
      if (w != selfWindow) {
        if (w.id != backgroundId)
          hadWindows = true;
        w.close();
      }
    }
    setGlobal('isReloading', true);
    setGlobal('wantsActivate', hadWindows);
    setTimeout(function() {
      selfWindow.close();
    }, 200)
  },
  getPlatformInfo: function(cb) {
    cb({
      os: hostMap[os.platform()],
      arch: archMap[os.arch()],
      nacl_arch: archMap[os.arch()],
    })
  }
};

chrome.app.runtime.onLaunched = makeEvent();

function loadWindowSettings(id) {
  return JSON.parse(localStorage.getItem('window-settings-' + id)) || {};
}

(function() {
  function autoUnregister(w, e, f, name) {
    w.on('close', () => {
      if (name)
        e.removeListener(name, f);
      else
        e.removeListener(f);
    })
  }

  function safeRegister(w, e, f, name) {
    autoUnregister(w, e, f, name);
    if (name)
      e.on(name, f);
    else
      e.addListener(f);
  }

  function safeCallback(w, f) {
    var safe = true;
    w.on('close', function() {
      safe = false;
    })

    return function() {
      if (safe)
        f.apply.apply(f, arguments);
    };
  }

  evalFunc(autoUnregister);
  evalFunc(safeRegister)
  evalFunc(safeCallback)
})();

const autoUnregister = remote.getGlobal('autoUnregister');
const safeRegister = remote.getGlobal('safeRegister');
const safeCallback = remote.getGlobal('safeCallback');

safeRegister(selfWindow, app, function() {
  chrome.app.runtime.onLaunched.invokeListeners(null, [{
    isKioskSession: false,
    isPublicSession: false,
    source: "command_line"
  }]);
}, 'activate');

function deepFunctionCopy(t, f) {
  return function() {
    var args = Array.prototype.slice.call(arguments)
    .map(m => deepCopy(m, {}));
    return f.apply(t, args);
  };
}

function deepCopy(v, visited) {
  var ret;
  if (typeof v == 'object') {
    if (visited[v])
      return visited[v];
    ret = {};
    visited[v] = ret;
    for (var k in v) {
      if (typeof v[k] == 'function')
        ret[k] = deepFunctionCopy(v, v[k]);
      else
        ret[k] = deepCopy(v[k], visited);
    }
    return ret;
  }

  if (typeof v == 'function') {
    return deepFunctionCopy(null, v);
  }

  return v;
}


chrome.syncFileSystem = {
  requestFileSystem: function(cb) {
    cb('not implemented');
  }
}

chrome.contextMenus = require('./chrome-contextmenus.js');

var identity = require('./chrome-identity.js');
chrome.identity = identity.identity;

chrome.system = require('./chrome-system.js');

chrome.notifications = require('./chrome-notifications.js');
chrome.notifications.onClicked = makeEvent();
chrome.notifications.onButtonClicked = makeEvent();
chrome.notifications.onClosed = makeEvent();

chrome.storage = {};
chrome.storage.onChanged = makeEvent();

chrome.storage.local = {
  set: function(o, cb) {
    for (var i in o) {
      var oldValue = localStorage.getItem(i);
      var newValue = o[i];
      localStorage.setItem(i, JSON.stringify(newValue));
      chrome.storage.onChanged.invokeListeners(null, [{
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

function throttleTimeout(token, item, throttle, cb) {
  if (!token)
    token = { items:[] };
  token.items.push(item);
  if (!token.timeout) {
    token.timeout = setTimeout(function() {
      delete token.timeout;
      cb(token.items);
      token.items = [];
    }, throttle);
  }
  return token;
}

evalFunc(function preventBrowserWindow(w) {
  w.webContents.on('new-window', function(e, url) {
    e.preventDefault();
    shell.openExternal(url);
  })
})

var preventBrowserWindow = remote.getGlobal('preventBrowserWindow');

chrome.app.window.create = function(options, cb) {
  var id = options.id;
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
    preload: `${__dirname}/chrome-preload.js`,
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
      localStorage.setItem('window-settings-' + w.id, JSON.stringify(data));
    })
  };

  safeRegister(selfWindow, w, save, 'resize');
  safeRegister(selfWindow, w, save, 'move');
  safeRegister(selfWindow, w, save, 'devtools-opened');
  safeRegister(selfWindow, w, save, 'devtools-closed');

  cb(w, false, windowSettings);
}

function createBackground() {
  chrome.app.window.create({
    id: 'background',
    innerBounds: {
      width: 1000,
      height: 1000,
    }
  }, function(bg) {
    setWindowGlobal(bg.id, 'onload', function() {
      console.log('background onload')
      if (remote.getGlobal('wantsActivate'))
        app.emit('activate');
    })
    function hideBg() {
      bg.hide();
    }
    safeRegister(selfWindow, bg, bg.hide.bind(bg), 'show');
    // bg.loadURL(`file://${appDir}/electron-background.html`)
    var bgUrl = `chrome-extension://${chrome.runtime.id}/_generated_background_page.html`;
    console.log(`opening ${bgUrl}`)
    bg.loadURL(bgUrl);
    bg.webContents.openDevTools({mode: 'detach'})
    // bg.hide();
  })
}

function calculateId() {
  if (appId) {
    console.log(appId);
    chrome.runtime.id = appId;
    return Promise.resolve(appId);
  }

  return new Promise((resolve, reject) => {
    var key = manifest.key;
    var buffer = Buffer.from(key, 'base64');
    const crypto = require('crypto');
    var hash = crypto.createHash('sha256');

    hash.on('readable', () => {
      var data = hash.read();
      if (!data) {
        reject(new Error('no data from hash'));
        return;
      }

      function translate(c) {
        if (c >= '0' && c <= '9')
          return String.fromCharCode('a'.charCodeAt(0) + (c - '0'))
        return String.fromCharCode(c.charCodeAt(0) + 10)
      }

      data = data.toString('hex').substring(0, 32);
      var id = data.split('').map(m => translate(m)).join('');
      console.log('chrome app id', id);
      chrome.runtime.id = id;
      resolve(id);

    });
    hash.write(buffer);
    hash.end()
  });
}

var notificationWorker;
function registerChromeNotificationWorker() {
  return navigator.serviceWorker.register('chrome-notification-worker.js')
  .then(function(registration) {
    notificationWorker = registration;
  })
}


function maybeDownloadCrx() {
  if (manifest != null)
    return Promise.resolve();

  return require('./chrome-update.js').downloadLatestVersion(appId)
  .then(() => {
    // reload
    // https://www.youtube.com/watch?v=VEjIJz077k0
  })
}


Promise.all([
  maybeDownloadCrx(),
  calculateId(),
  identity.startAuthServer(),
  // registerChromeNotificationWorker(),
  // registerProtocol(),
])
.then(function() {
  console.log('initialized');
  setGlobal('chrome', chrome);
  console.log(chrome);
  createBackground();
})
