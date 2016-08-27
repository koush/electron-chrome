const path = require('path');
const electron = require('electron').remote || require('electron');
const {shell} = require('electron');
const {BrowserWindow, app, protocol} = electron;
const fs = require('fs');
const os = require('os');

const remote = require('electron').remote || {
  getGlobal: function(key) {
    return global[key];
  },
  getCurrentWindow: function() {
  }
}

const manifest = remote.getGlobal('chromeManifest');
const appId = remote.getGlobal('chromeAppId');

if (!global.localStorage) {
  try {
    var dataPath = path.join(app.getPath('userData'), `${appId}.json`);
    var localStorageData = JSON.parse(fs.readFileSync(dataPath));
  }
  catch (e) {
    localStorageData = {};
  }

  global.localStorage = {
    getItem: function(key) {
      return localStorageData[key] || null;
    },
    setItem: function(key, value) {
      localStorageData[key] = value;
      fs.writeFileSync(dataPath, JSON.stringify(localStorageData))
    }
  }
}
console.log('chrome runtime started');

const {
  makeEvent,
  setGlobal,
  safeRegister,
  preventBrowserWindow,
  createWindowGlobals,
  setWindowGlobal,
  deleteWindowGlobals,
  getWindowGlobal,
  getWindowGlobals,
} = require('../main/global.js');


const selfWindow = remote.getCurrentWindow();
// need to watch for a lot of close events...
if (selfWindow)
  selfWindow.setMaxListeners(1000);


global.chrome = {};

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

const chromeAppUpdater = require('./chrome-update.js');

chrome.runtime = {
  id: appId,
  onMessage: makeEvent(),
  onMessageExternal: makeEvent(),
  sendMessage: function() {
    console.log('dropping message on the floor', arguments);
  },
  // directory: appDir,
  manifest: manifest,
  requestUpdateCheck: function(cb) {
    // status, details
    chromeAppUpdater.getLatestVersion(appId)
    .then(latest => {
      console.log('latest version', latest);
      if (latest.version <= manifest.version) {
        cb('no_update', {
          version: '',
        });
        return;
      }

      chromeAppUpdater.downloadCrx(appId, latest)
      .then(function() {
        cb('update_available', {
          version: latest.version,
        })
      })
    })
  },
  reload: function() {
    var hadWindows;
    const background = chrome.app.window.get('__background');
    var backgroundId = background && background.id;
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

chrome.app = require('./chrome-app.js');

chrome.syncFileSystem = {
  requestFileSystem: function(cb) {
    cb('not implemented');
  }
}

const identity = require('./chrome-identity.js');
chrome.identity = identity.identity;

chrome.contextMenus = require('./chrome-contextmenus.js');
chrome.system = require('./chrome-system.js');
chrome.notifications = require('./chrome-notifications.js');
chrome.storage = require('./chrome-storage');

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

function createBackground() {
  chrome.app.window.create({
    id: '__background',
    innerBounds: {
      width: 1000,
      height: 1000,
    }
  }, function(bg, created, windowSettings) {
    setWindowGlobal(bg.id, 'onload', function() {
      console.log('background onload')
      if (remote.getGlobal('wantsActivate'))
        app.emit('activate');
    })
    safeRegister(selfWindow, bg, bg.hide.bind(bg), 'show');
    // bg.loadURL(`file://${appDir}/electron-background.html`)
    var bgUrl = `chrome-extension://${chrome.runtime.id}/_generated_background_page.html`;
    console.log(`opening ${bgUrl}`)
    bg.loadURL(bgUrl);
    if (windowSettings.isDevToolsOpened)
      bg.webContents.openDevTools({mode: 'detach'});
    // bg.webContents.openDevTools({mode: 'detach'})
    // bg.hide();
  })
}

function maybeDownloadCrx() {
  if (manifest != null)
    return Promise.resolve();

  return chromeAppUpdater.downloadLatestVersion(appId)
  .then(() => {
    // reloading!
    // https://www.youtube.com/watch?v=VEjIJz077k0
    app.relaunch();
    app.exit(0);
  })
}


Promise.all([
  maybeDownloadCrx(),
  identity.startAuthServer(),
  // registerProtocol(),
])
.then(function() {
  console.log('initialized');
  setGlobal('chrome', chrome);
  createBackground();
})

console.log('runtime created');
