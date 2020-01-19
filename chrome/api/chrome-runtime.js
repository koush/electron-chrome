console.log('runtime started');

const path = require('path');
const {electron, remote} = require('./electron-remote.js')
const {shell} = require('electron');
const {BrowserWindow, app, protocol, autoUpdater} = electron;
const fs = require('fs');
const os = require('os');

const electronChromeRoot = remote.getGlobal('electronChromeRoot');
require('module').globalPaths.push(electronChromeRoot);
require('module').globalPaths.push(path.join(electronChromeRoot, 'node_modules'));

const {throttleTimeout} = require('./util.js');

const manifest = JSON.parse(JSON.stringify(remote.getGlobal('chromeManifest')));
const appId = remote.getGlobal('chromeAppId');
console.log(`appId ${appId}`)

const chromeRuntimeId = remote.getGlobal('chromeRuntimeId');
const chromeRuntimeVersion = remote.getGlobal('chromeRuntimeVersion');
const launchUrl = remote.getGlobal('launchUrl');

function handleLaunchUrl(url) {
  const p = `ec-${appId}`;
  console.log(`custom url: ${url}`)
  var insecure = url.replace(p, 'http');
  var secure = url.replace(p, 'https');
  Object.keys(manifest.url_handlers).forEach(function(key) {
    console.log(key);
    var entry = manifest.url_handlers[key];
    entry.matches.forEach(function(match) {
      var matchUrl;
      if (secure.match(match))
        matchUrl = secure;
      else if (insecure.match(match))
        matchUrl = insecure;

      if (matchUrl) {
        chrome.app.runtime.onLaunched.invokeListeners(null, [{
          id: key,
          isKioskSession: false,
          isPublicSession: false,
          source: "url_handler",
          url: matchUrl
        }]);
      }
    })
  })
  console.log('custom url', url);
}

if (manifest) {
  app.setName(manifest.name);
  if (manifest.url_handlers) {
    const p = `ec-${appId}`;
    app.setAsDefaultProtocolClient(p);
    app.on('open-url', function(event, url) {
      if (event)
        event.preventDefault();
      handleLaunchUrl(url);
    })

    console.log(`launchUrl: ${launchUrl}`);
  }
}

(function() {
  if (!global.localStorage) {
    // chrome.storage and windows are backed by localStorage.
    try {
      var dataPath = path.join(app.getPath('userData'), `${appId}.json`);
      var localStorageData = JSON.parse(fs.readFileSync(dataPath));
    }
    catch (e) {
      localStorageData = {};
    }

    function saveLocalStorageData() {
      fs.writeFileSync(dataPath, JSON.stringify(localStorageData))
    }


    global.localStorage = {
      getItem: function(key) {
        return localStorageData[key] || null;
      },
      setItem: function(key, value) {
        localStorageData[key] = value;
        saveLocalStorageData();
      },
      clear: function() {
        localStorageData = {};
        saveLocalStorageData();
      }
    }
  }
})();
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
  shutdownEverything,
} = require('../main/global.js');


const selfWindow = remote.getCurrentWindow();
// need to watch for a lot of close events...
if (selfWindow)
  selfWindow.setMaxListeners(1000);

var chrome = {};

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

function ensureLatestCrx(appId, currentVersion) {
  return new Promise((resolve, reject) => {
    chromeAppUpdater.getLatestVersion(appId)
    .then(latest => {
      console.log('latest version of', appId, latest.version, 'vs current', currentVersion);
      if (latest.version <= currentVersion) {
        resolve();
        return;
      }

      chromeAppUpdater.downloadCrx(appId, latest)
      .then((crxPath) => {
        try {
          return chromeAppUpdater.extractCrx(crxPath);
        }
        catch (e) {
          fs.unlinkSync(crxPath);
          throw e;
        }
      })
      .then(function() {
        resolve(latest.version);
      })
    })
  })
}

var updatePromise;
var allowImmediateUpdateCheck = true;

chrome.alarms = require('./chrome-alarms.js');
chrome.idle = require('./chrome-idle.js');

chrome.runtime = {
  id: appId,
  onInstalled: makeEvent(),
  onStartup: makeEvent(),
  onMessage: makeEvent(),
  onMessageExternal: makeEvent(),
  sendMessage: function() {
    console.error('dropping message on the floor', arguments);
  },
  // directory: appDir,
  manifest: manifest,
  onUpdateAvailable: makeEvent(),
  requestUpdateCheck: function(cb) {
    cb = cb || function() {};

    updatePromise.then(function(version) {
      if (!version) {
        cb('no_update', {
          version: '',
        });
        return;
      }

      const details = {
        version: version,
      };

      chrome.runtime.onUpdateAvailable.invokeListeners(null, [details])
      cb('update_available', details);
    })

    if (!allowImmediateUpdateCheck)
      return;

    allowImmediateUpdateCheck = false;
    setTimeout(function() {
      allowImmediateUpdateCheck = true;
      updateChecker();
    }, 30 * 60 * 1000);
  },
  reset: function() {
    localStorage.clear();
    chromeAppUpdater.clearCrxDir();
    chrome.runtime.reload();
  },
  shutdown: function() {
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
    setGlobal('wantsActivate', hadWindows);
    setTimeout(shutdownEverything, 200)
  },
  reload: function() {
    chrome.runtime.shutdown();
    setGlobal('isReloading', true);
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
}

chrome.fileSystem = {
}

const identity = require('./chrome-identity');
chrome.identity = identity.identity;

chrome.contextMenus = require('./chrome-contextmenus.js');
chrome.system = require('./chrome-system.js');
chrome.notifications = require('./chrome-notifications.js');
chrome.storage = require('./chrome-storage');
chrome.browser = require('./chrome-browser');

function updateChecker() {
  var latest;
  var promise;
  if (chromeRuntimeId) {
    console.log('checking for updates to chrome runtime', chromeRuntimeId);
    promise = ensureLatestCrx(chromeRuntimeId, chromeRuntimeVersion)
    .then(function(version) {
      // if we have an update for the runtime, just pass the existing version
      if (version) {
        console.log('found update for chrome runtime', version);
        latest = manifest.version;
      }
      return ensureLatestCrx(appId, manifest.version);
    })
  }
  else {
    console.log('checking for updates to chrome app', appId);
    promise = ensureLatestCrx(appId, manifest.version);
  }

  try {
    autoUpdater.checkForUpdates();
  }
  catch (e) {
    // ignore it, may not exist, code signature issue during dev, etc.
    console.error(e);
  }

  updatePromise = promise.then(function(version) {
    // an actual aop update
    if (version) {
      console.log('found update for chrome app', version);
      latest = version;
    }

    return latest;
  })
}

var updateCheckerId;
function startUpdateChecker() {
  clearInterval(updateCheckerId);
  updateChecker();
  // do this once a day
  updateCheckerId = setInterval(updateChecker, 24 * 60 * 60 * 1000);
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
      chrome.runtime.onStartup.invokeListeners();

      if (remote.getGlobal('wantsActivate'))
        app.emit('activate');

        if (launchUrl)
          handleLaunchUrl(launchUrl);

        // trigger an update check
        startUpdateChecker();
    })
    safeRegister(selfWindow, bg, bg.hide.bind(bg), 'show');
    // bg.loadURL(`file://${appDir}/electron-background.html`)
    var bgUrl;
    if (manifest.app.background.page)
      bgUrl = `chrome-extension://${chrome.runtime.id}/${manifest.app.background.page}`;
    else
      bgUrl = `chrome-extension://${chrome.runtime.id}/_generated_background_page.html`;
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

  // download the crx, let the main entry point extract and spew any possible errors?
  return chromeAppUpdater.downloadLatestVersion(appId)
  .then(function() {
    // reloading!
    // https://www.youtube.com/watch?v=VEjIJz077k0
    app.relaunch();
    app.exit(0);
  })
}

const init = Promise.all([
  maybeDownloadCrx(),
  identity.startAuthServer(appId),
  // registerProtocol(),
])
.then(function() {
  console.log('initialized');
  setGlobal('chrome', chrome);
  createBackground();
})

exports.createAPI = function() {
  return new Promise((resolve, reject) => {
    init.then(() => {
      resolve(chrome);
    })
    .catch(function(e) {
      reject(e);
    });
  });
}
