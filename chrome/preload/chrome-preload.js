if (navigator.userAgent.indexOf('Electron') == -1)
  return;

const {remote, desktopCapturer, webFrame, shell, ipcRenderer} = require('electron')
const {Menu, MenuItem, BrowserWindow} = remote;
const {app} = remote;
const path = require('path');
const {
  makeEvent,
  safeWrapEvent,
  getWindowGlobal,
  getWindowGlobals,
  autoUnregister,
  safeRegister,
} = require(path.join(__dirname, '..', 'main', 'global.js'));

webFrame.registerURLSchemeAsSecure('chrome-extension')
webFrame.registerURLSchemeAsBypassingCSP('chrome-extension')
webFrame.registerURLSchemeAsPrivileged('chrome-extension')

const selfBrowserWindow = remote.getCurrentWindow();
const selfId = selfBrowserWindow.id;

selfBrowserWindow.webContents.insertCSS('body { -webkit-user-select: none; cursor: default; font-family: "Helvetica Neue", "Lucida Grande", sans-serif; font-size: 75%; }');
selfBrowserWindow.webContents.insertCSS('html, body {overflow: hidden;}');

(function() {
  var currentWindowGlobals = getWindowGlobals(selfBrowserWindow.id);
  for (var k in currentWindowGlobals) {
    window[k] = currentWindowGlobals[k];
  }
})();

// hook the onload with whatever a creator default if it wants it.
window.onload = function() {
  var l = getWindowGlobal(remote.getCurrentWindow().id, 'onload');
  if (l)
    l();
}

ipcRenderer.on('contentWindow', function(e, name) {
  window[name] = getWindowGlobal(selfId, name);
})

chrome = remote.getGlobal('chrome');
function deepCopy(o, t) {
  for (var k in o) {
    var v = o[k];
    if (v.constructor == Object)
      t[k] = deepCopy(v, {});
    else
      t[k] = v;
  }
  return t;
}

chrome = deepCopy(chrome, {});

chrome.desktopCapture = require('./chrome-desktopcapture.js');

function unremote(v) {
  return JSON.parse(JSON.stringify(v))
}

function errorWrappedCallback(cb) {
  return function(e, v) {
    if (!cb)
      return;
    if (e) {
      try {
        chrome.runtime.lastError = new Error(e);
        if (cb) {
          cb();
        }
      }
      finally {
        delete chrome.runtime.lastError;
      }
    }
    else {
      cb(unremote(v));
    }
  }
}

function wrap0Arg(f) {
  return function(cb) {
    return f(errorWrappedCallback(cb));
  }
}

function wrap1Arg(f) {
  return function(v, cb) {
    return f(v, errorWrappedCallback(cb));
  }
}

chrome.identity.getProfileUserInfo = wrap0Arg(chrome.identity.getProfileUserInfo);
chrome.identity.getAuthToken = wrap1Arg(chrome.identity.getAuthToken);
chrome.identity.launchWebAuthFlow = wrap1Arg(chrome.identity.launchWebAuthFlow);
chrome.identity.getRedirectURL = function(path) {
  path = path || '';
  return `http://localhost:${chrome.identity.authServerPort}/${path}`
}

var chromeNotificationsCreate = chrome.notifications.create;
chrome.notifications.create = function() {
  var nid;
  var opts;
  var cb;
  if (arguments.length == 0)
    throw new Error('arguments: (optional) notificationId, options, (optional) callback');
  var i = 0;
  if (typeof arguments[0] == 'string') {
    if (arguments.length == 1)
      throw new Error('arguments: (optional) notificationId, options, (optional) callback');
    nid = arguments[i++];
  }
  opts = arguments[i++];
  if (i < arguments.length)
    cb = arguments[i++];
  else
    cb = function() {};

  chromeNotificationsCreate(nid, opts, cb);
}

var chromeStorageLocalGet = chrome.storage.local.get;
chrome.storage.local.get = function(k, cb) {
  chromeStorageLocalGet(k, function(d) {
    // need to do this or we get a weird remoting object.
    if (cb)
      cb(unremote(d))
  })
}

var chromeRequestSyncFileSystem = chrome.syncFileSystem.requestFileSystem;

chrome.syncFileSystem.requestFileSystem = function(cb) {
  chromeRequestSyncFileSystem(errorWrappedCallback(cb));
};


(function() {
  let rightClickPosition = null

  const menu = new Menu()
  menu.append(new MenuItem({label: 'Reload App', click() { chrome.runtime.reload() }}))
  menu.append(new MenuItem({type: 'separator'}))
  menu.append(new MenuItem({label: 'Inspect', click() {
    // can't call these in succession, electron crashes
    if (selfBrowserWindow.isDevToolsOpened())
      selfBrowserWindow.inspectElement(rightClickPosition.x, rightClickPosition.y)
    else
      selfBrowserWindow.webContents.openDevTools({mode: 'detach'})
  }}))
  menu.append(new MenuItem({label: 'Inspect Background Page', click() { chrome.app.window.get('__background').w.webContents.openDevTools({mode: 'detach'}) }}))

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    rightClickPosition = {x: e.x, y: e.y}
    menu.popup(remote.getCurrentWindow())
  }, false)
})();

safeWrapEvent(selfBrowserWindow, chrome.storage.onChanged);
safeWrapEvent(selfBrowserWindow, chrome.runtime.onMessage);
safeWrapEvent(selfBrowserWindow, chrome.runtime.onMessageExternal);
safeWrapEvent(selfBrowserWindow, chrome.app.runtime.onLaunched);

const {AppWindow, getChromeAppWindow, selfWindow} = require('./chrome-app-window.js');
window.sharedGlobals = selfWindow.contentWindow;

chrome.app.window = getChromeAppWindow(chrome.app.window);

//var chromeManifest = require('fs').readFileSync(`${__dirname}/../manifest.json`).toString();
var chromeManifest = JSON.stringify(chrome.runtime.manifest);
chrome.runtime.getManifest = function() {
  return JSON.parse(chromeManifest);
};
chrome.runtime.getBackgroundPage = function(cb) {
  if (cb) {
    process.nextTick(function() {
      cb(chrome.app.window.get('__background').contentWindow);
    })
  }
}


window.chrome = chrome;
window.require = require;

// allow jquery to load
delete window.module;
