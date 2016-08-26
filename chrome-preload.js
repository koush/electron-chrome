(function() {
  if (navigator.userAgent.indexOf('Electron') == -1)
    return;

  const {remote, desktopCapturer, webFrame, shell, ipcRenderer} = require('electron')
  const {Menu, MenuItem, BrowserWindow} = remote;
  const {app} = remote;
  const {makeEvent, safeWrapEvent} = require('./chrome-event.js');

  webFrame.registerURLSchemeAsSecure('chrome-extension')
  webFrame.registerURLSchemeAsBypassingCSP('chrome-extension')
  webFrame.registerURLSchemeAsPrivileged('chrome-extension')

  var selfBrowserWindow = remote.getCurrentWindow();
  var selfId = selfBrowserWindow.id;

  selfBrowserWindow.webContents.insertCSS('body { -webkit-user-select: none; cursor: default; font-family: "Helvetica Neue", "Lucida Grande", sans-serif; font-size: 75%; }');
  selfBrowserWindow.webContents.insertCSS('html, body {overflow: hidden;}');



  var getWindowGlobal = remote.getGlobal('getWindowGlobal');
  var getWindowGlobals = remote.getGlobal('getWindowGlobals');
  var setWindowGlobal = remote.getGlobal('setWindowGlobal');

  (function() {
    var currentWindowGlobals = getWindowGlobals(selfBrowserWindow.id);
    for (var k in currentWindowGlobals) {
      window[k] = currentWindowGlobals[k];
    }
  })();

  const autoUnregister = remote.getGlobal('autoUnregister');
  const safeRegister = remote.getGlobal('safeRegister');

  ipcRenderer.on('contentWindow', function(e, name) {
    window[name] = getWindowGlobal(selfId, name);
  })

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

    this.onFullscreened = makeEvent();
    this.onClosed = makeEvent();


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
    ChromeShimWindow.prototype[n] = function() {
      this.w[n].apply(this.w, arguments);
    }
  }

  var passthroughs = ['setAlwaysOnTop', 'show', 'hide', 'close', 'isMaximized', 'focus'];
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

  chrome.desktopCapture = {
    chooseDesktopMedia: function(types, cb) {
      console.log('choosing');

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
  }

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
    var cw = localWindowCache[options.id];
    if (cw) {
      // cw.focus();
      return;
    }

    chromeAppWindowCreate(options, function(w, existed, settings) {
      if (existed) {
        // cw.focus();
        return;
      }

      var cw = new ChromeShimWindow(w);
      if (cb)
        cb(cw);

      // load happens after callback to allow contentWindow stuff to be set.
      // var appDir = remote.getGlobal('chromeAppDir');
      // w.loadURL(`file://${appDir}/${page}`)
      w.loadURL(`chrome-extension://${chrome.runtime.id}/${page}`);
      // this needs to happen only after the load.
      if (settings.isDevToolsOpened)
        selfWindow.w.webContents.openDevTools({mode: 'detach'});
      w.once('ready-to-show', () => {
        w.show()
      })
      // w.webContents.openDevTools({mode: 'detach'})
    });
  }

  chrome.browser = {
    openTab: function(opts) {
      shell.openExternal(opts.url);
      if (opts.cb)
        process.nextTick(opts.cb);
    }
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
  delete window.module;
})();
