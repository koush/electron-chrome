(function() {
  if (navigator.userAgent.indexOf('Electron') == -1)
    return;

  const {remote} = require('electron')
  const {Menu, MenuItem, BrowserWindow} = remote;
  const {app} = remote;
  const {makeEvent, safeWrapEvent} = require('./chrome-event.js');

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

  var selfBrowserWindow = remote.getCurrentWindow();

  document.addEventListener('DOMContentLoaded', function () {
      selfBrowserWindow.webContents.insertCSS('body { -webkit-user-select: none; cursor: default; font-family: "Helvetica Neue", "Lucida Grande", sans-serif; font-size: 75%; }');
  });

  var getWindowGlobal = remote.getGlobal('getWindowGlobal');
  var setWindowGlobal = remote.getGlobal('setWindowGlobal');

  const autoUnregister = remote.getGlobal('autoUnregister');
  const safeRegister = remote.getGlobal('safeRegister');

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

  chromeStorageLocalGet = chrome.storage.local.get;
  chrome.storage.local.get = function(k, cb) {
    chromeStorageLocalGet(k, function(d) {
      // need to do this or we get a weird remoting object.
      if (cb)
        cb(JSON.parse(JSON.stringify(d)))
    })
  }

  var localWindowCache = {};
  function ChromeShimWindow(w) {
    // cache this for close events, becomes inaccessible.
    var nativeId = w.id;
    this.w = w;
    var windowMappings = remote.getGlobal('windowMappings');
    this.id = windowMappings.electronToChrome[nativeId];
    localWindowCache[this.id] = this;
    if (!this.id)
      console.error('window id null?')

    this.contentWindow = new Proxy({}, {
      get: function(target, name) {
        return window[name] || getWindowGlobal(nativeId, name);
      },
      set: function(target, name, value) {
        window[name] = value;
        return setWindowGlobal(nativeId, name, value);
      }
    });

    this.onFullscreened = makeEvent();

    this.onClosed = makeEvent();

    safeRegister(selfBrowserWindow, w, function() {
      this.onClosed.invokeListeners();
      delete localWindowCache[this.id];
    }.bind(this), 'close')
  }

  function passthroughPrototype(n) {
    ChromeShimWindow.prototype[n] = function() {
      this.w[n].apply(this.w, arguments);
    }
  }

  var passthroughs = ['setAlwaysOnTop', 'show', 'hide'];
  for (var n in passthroughs) {
    (function() {
      var p = passthroughs[n];
      ChromeShimWindow.prototype[p] = function() {
        this.w[p].apply(this.w, arguments);
      }
    })();
  }

  var selfWindow = new ChromeShimWindow(selfBrowserWindow);
  window.sharedGlobals = selfWindow.contentWindow;
  window.onload = function() {
    var l = getWindowGlobal(remote.getCurrentWindow().id, 'onload');
    if (l)
      l();
  }

  function loadWindowSettings(id) {
    return JSON.parse(localStorage.getItem('window-settings-' + id)) || {};
  }

  // restore the dev tools
  var myWindowSettings = loadWindowSettings(selfWindow.id);
  if (myWindowSettings.isDevToolsOpened) {
    selfWindow.w.webContents.openDevTools({mode: 'detach'});
  }

  var saveThrottle;
  function save() {
    saveThrottle = throttleTimeout(saveThrottle, null, 1000, function() {
      var data = {
        contentBounds: selfWindow.w.getContentBounds(),
        isDevToolsOpened: selfWindow.w.webContents.isDevToolsOpened()
      }
      localStorage.setItem('window-settings-' + selfWindow.id, JSON.stringify(data));
    })
  };

  selfWindow.w.on('resize', save);
  selfWindow.w.on('move', save);
  selfWindow.w.webContents.on('devtools-opened', save);
  selfWindow.w.webContents.on('devtools-closed', save);

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
    menu.append(new MenuItem({label: 'Inspect Background Page', click() { chrome.app.window.get('background').w.webContents.openDevTools({mode: 'detach'}) }}))

    window.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      rightClickPosition = {x: e.x, y: e.y}
      menu.popup(remote.getCurrentWindow())
    }, false)
  })();

  safeWrapEvent(selfBrowserWindow, chrome.storage.onChanged);

  var chromeAppWindowCreate = chrome.app.window.create;
  chrome.app.window.create = function(page, options, cb) {
    chromeAppWindowCreate(options, function(w) {
      var cw = new ChromeShimWindow(w);
      if (cb)
        cb(cw);

      w.loadURL(`chrome-extension://${chrome.runtime.id}/${page}`);
      w.show();
      // w.loadURL(`file://${__dirname}/../${page}`)
      // w.webContents.openDevTools({mode: 'detach'})
    });
  }

  chrome.app.window.get = function(id) {
    var windowMappings = remote.getGlobal('windowMappings');
    var mappedId = windowMappings.chromeToElectron[id];
    if (!mappedId)
      return;
    var w = BrowserWindow.fromId(mappedId);
    if (!w) {
      delete localWindowCache[id];
      console.error('mapped id found, but window does not exist?');
      return;
    }
    if (localWindowCache[id])
      return localWindowCache[id];
    var cw = new ChromeShimWindow(w);
    localWindowCache[id] = cw;
    return cw;
  }

  chrome.app.window.getAll = function() {
    var windowMappings = remote.getGlobal('windowMappings');
    return BrowserWindow.getAllWindows()
    .map(b => windowMappings.electronToChrome[b.id])
    .filter(id => id != null && id != 'background')
    .map(id => chrome.app.window.get(id));
  }

  chrome.app.window.current = function() {
    return selfWindow;
  }

  //var chromeManifest = require('fs').readFileSync(`${__dirname}/../manifest.json`).toString();
  var chromeManifest = JSON.stringify(chrome.runtime.manifest);
  chrome.runtime.getManifest = function() {
    return JSON.parse(chromeManifest);
  };

  window.chrome = chrome;
  window.require = require;

  // allow jquery to load
  // delete window.module;
})();
