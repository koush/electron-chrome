const path = require('path');
const {remote, shell} = require('electron');
const {BrowserWindow, app, protocol} = remote;
var {makeEvent} = require('./chrome-event.js');
const fs = require('fs');

var manifest = remote.getGlobal('chromeManifest');
var appDir = remote.getGlobal('chromeAppDir');

console.log('chrome runtime started');

remote.getGlobal('eval')('global.setGlobal = function(n, v) { global[n] = v }');

var setGlobal = remote.getGlobal('setGlobal');
function evalFunc(f) {
  remote.getGlobal('eval')(f.toString())
}

evalFunc(makeEvent);
makeEvent = remote.getGlobal('makeEvent');

var selfWindow = remote.getCurrentWindow();
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

chrome.runtime = {
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
  }
};

chrome.app.runtime.onLaunched = makeEvent(true);

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
  chrome.app.runtime.onLaunched.invokeListeners();
}, 'activate')

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

var identity = require('./chrome-identity.js');
chrome.identity = identity.identity;

chrome.notifications = require('./chrome-notifications.js');
chrome.notifications.onClicked = makeEvent();
chrome.notifications.onButtonClicked = makeEvent();
chrome.notifications.onClosed = makeEvent();

chrome.storage = {};
chrome.storage.onChanged = makeEvent(true);

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

  cb(w);
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
    bg.loadURL(`chrome-extension://${chrome.runtime.id}/_generated_background_page.html`);
    bg.webContents.openDevTools({mode: 'detach'})
    bg.hide();
  })
}

function calculateId() {
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

Promise.all([
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
