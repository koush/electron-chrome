const path = require('path');
const {remote} = require('electron');
const {BrowserWindow} = remote;
const {
  makeEvent,
  safeWrapEvent,
  safeRegister,
  getWindowGlobal,
  setWindowGlobal,
}  = require(path.join('..', 'main', 'global.js'));

const selfBrowserWindow = remote.getCurrentWindow();
const selfId = selfBrowserWindow.id;

const localWindowCache = {};
function AppWindow(w) {
  // cache this for close events, becomes inaccessible.
  var nativeId = w.id;
  this.w = w;
  var windowMappings = remote.getGlobal('windowMappings');
  this.id = windowMappings.electronToChrome[nativeId];
  localWindowCache[this.id] = this;
  if (!this.id)
    console.error('window id null?')

  this.onFullscreened = makeEvent();
  this.onMinimized = makeEvent();
  this.onMaximized = makeEvent();
  this.onRestored = makeEvent();
  this.onClosed = makeEvent();

  safeRegister(selfBrowserWindow, w, this.onMinimized.invokeListeners, 'minimize');
  safeRegister(selfBrowserWindow, w, this.onMaximized.invokeListeners, 'maximize');
  safeRegister(selfBrowserWindow, w, this.onRestored.invokeListeners, 'restore');
  safeRegister(selfBrowserWindow, w, this.onFullscreened.invokeListeners, 'enter-full-screen');

  var closed;
  safeRegister(selfBrowserWindow, w, function() {
    closed = true;
    this.onClosed.invokeListeners();
    delete localWindowCache[this.id];
  }.bind(this), 'close')

  this.contentWindow = new Proxy({}, {
    get: function(target, name) {
      return getWindowGlobal(nativeId, name);
    },
    set: function(target, name, value) {
      setWindowGlobal(nativeId, name, value);
      if (nativeId == selfId)
        window[name] = value;
      else if (!closed)
        w.webContents.send('contentWindow', name);
      return value;
    }
  });


  this.innerBounds = {
    get left() {
      return w.getContentBounds().x;
    },
    set left(left) {
      var n = w.getContentBounds();
      n.x = left;
      w.setContentBounds(n)
    },
    get top() {
      return w.getContentBounds().y;
    },
    set top(top) {
      var n = w.getContentBounds();
      n.y = top;
      w.setContentBounds(n)
    },

    get width() {
      return w.getContentBounds().width;
    },
    set width(width) {
      var n = w.getContentBounds();
      n.width = width;
      w.setContentBounds(n)
    },
    get height() {
      return w.getContentBounds().height;
    },
    set height(h) {
      var n = w.getContentBounds();
      n.height = h;
      w.setContentBounds(n)
    }
  }
}

function passthroughPrototype(n) {
  // todo: liveness check?
  AppWindow.prototype[n] = function() {
    this.w[n].apply(this.w, arguments);
  }
}

// allow these AppWindow calls to go directly to the BrowserWindow
var passthroughs = ['setAlwaysOnTop', 'show', 'hide', 'close', 'isMaximized', 'focus'];
for (var p of passthroughs) {
  passthroughPrototype(p);
}

AppWindow.prototype.restore = function() {
  if (this.w.isMaximized())
    this.w.unmaximize();
  else if (this.w.isMinimized())
    this.w.restore();
  else if (this.w.isFullScreen())
    this.w.setFullScreen(false);
}

function getAppWindowForNativeId(id) {
  return localWindowCache[id];
}

function getChromeAppWindow(chromeAppWindow) {
  const chromeAppWindowCreate = chromeAppWindow.create;

  chromeAppWindow.create = function(page, options, cb) {
    var cw = getAppWindowForNativeId(options.id);
    if (cw) {
      // cw.focus();
      return;
    }

    chromeAppWindowCreate(options, function(w, existed, settings) {
      if (existed) {
        // cw.focus();
        return;
      }

      var cw = new AppWindow(w);
      if (cb)
        cb(cw);

      // load happens after callback to allow contentWindow stuff to be set.
      // var appDir = remote.getGlobal('chromeAppDir');
      // w.loadURL(`file://${appDir}/${page}`)
      w.once('ready-to-show', () => {
        w.show()
      })
      w.loadURL(`chrome-extension://${chrome.runtime.id}/${page}`);
      // this needs to happen only after the load.
      console.log(settings);
      if (settings.isDevToolsOpened)
        w.webContents.openDevTools({mode: 'detach'});
    });
  }

  return chromeAppWindow;
}


chrome.app.window.get = function(id) {
  var windowMappings = remote.getGlobal('windowMappings');
  var mappedId = windowMappings.chromeToElectron[id];
  if (!mappedId)
    return;
  var w = BrowserWindow.fromId(mappedId);
  if (!w) {
    console.error('mapped id found, but window does not exist?');
    return;
  }
  var cw = getAppWindowForNativeId(id);
  if (cw)
    return cw;
  return new AppWindow(w);
}

chrome.app.window.getAll = function() {
  var windowMappings = remote.getGlobal('windowMappings');
  return BrowserWindow.getAllWindows()
  .map(b => windowMappings.electronToChrome[b.id])
  .filter(id => id != null && id != '__background')
  .map(id => chrome.app.window.get(id));
}

const selfWindow = new AppWindow(selfBrowserWindow);

chrome.app.window.current = function() {
  return selfWindow;
}

exports.selfWindow = selfWindow;
exports.AppWindow = AppWindow;
exports.getAppWindowForNativeId = getAppWindowForNativeId;
exports.getChromeAppWindow = getChromeAppWindow;
