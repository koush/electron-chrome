const path = require('path');
const {remote} = require('electron');
const {BrowserWindow, app, protocol, shell} = remote;
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

  evalFunc(createWindowGlobals);
  evalFunc(deleteWindowGlobals);
  evalFunc(setWindowGlobal);
  evalFunc(getWindowGlobal);
})();

var getWindowGlobal = remote.getGlobal('getWindowGlobal');
var createWindowGlobals = remote.getGlobal('createWindowGlobals');
var deleteWindowGlobals = remote.getGlobal('deleteWindowGlobals');
var setWindowGlobal = remote.getGlobal('setWindowGlobal');

var chrome = {
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
  requestFileSystem: function(cb, cbError) {
    cbError(new Error('not implemented'));
  }
}

var authServer = new require('http').Server();
var authCallbacks = {};
function startAuthServer() {
  return new Promise((resolve, reject) => {
    authServer.on('error', function() {
      resolve();
    });
    authServer.listen(function() {
      chrome.identity.authServerPort = authServer.address().port;
      resolve();
    })
    authServer.on('request', function(req, res) {
      try {
        var random = req.url.split('?')[0].split('/')[1];
        cb = authCallbacks[random];
        if (!cb)
          return;
        delete authCallbacks[random];
        cb(req.url);
      }
      catch (e) {
        console.error('unexpected error during auth request', e);
      }
    })

  });
}

function getQueryVariable(variable, url) {
  if (!url)
    url = window.location;
  var query = url.search.substring(1);
  var vars = query.split('&');
  for (var i = 0; i < vars.length; i++) {
    var pair = vars[i].split('=');
    if (decodeURIComponent(pair[0]) == variable) {
      return decodeURIComponent(pair[1]);
    }
  }
}

function launchFlowForCode(scopes, cb) {
  return new Promise(function(resolve, reject) {
    var escapedScopes = encodeURIComponent(scopes);
    var url = `https://accounts.google.com/o/oauth2/v2/auth?scope=${escapedScopes}&response_type=code&client_id=${manifest.oauth2.electron_chrome_client_id}`;
    chrome.identity.launchWebAuthFlow({
      url: url,
      interactive: true,
    }, function(resultUrl) {
      var pathOnly = resultUrl.split('/')[1].split('?')[0];
      var redirect_uri = chrome.identity.getRedirectURL(pathOnly);
      var code = getQueryVariable('code', new URL(`ignored://${resultUrl}`));
      resolve(exchangeCodeForToken(code, redirect_uri));
    });
  });
}

function exchangeCodeForToken(code, redirect_uri) {
  var params = {
      code: code,
      client_id: manifest.oauth2.electron_chrome_client_id,
      client_secret: manifest.oauth2.electron_chrome_client_secret,
      redirect_uri: redirect_uri,
      grant_type: 'authorization_code',
  };

  var str = Object.keys(params)
  .map(k => `${k}=` + encodeURIComponent(params[k]))
  .join('&')

  var request = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: str
  };

  return fetch('https://www.googleapis.com/oauth2/v4/token', request)
  .then(function(res) {
    if (res.status != 200)
      return Promise.reject('received status: ' + res.status);
    return res.json();
  });
}

function maybeRefreshToken(key, tokenInfo) {
  if (tokenInfo.access_token && tokenInfo.expires >= Date.now())
    return Promise.resolve(tokenInfo);

  var params = {
      client_id: manifest.oauth2.electron_chrome_client_id,
      client_secret: manifest.oauth2.electron_chrome_client_secret,
      refresh_token: json.refresh_token,
      grant_type: 'refresh_token',
  };

  var str = Object.keys(params)
  .map(k => `${k}=` + encodeURIComponent(params[k]))
  .join('&')

  var request = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: str
  };

  return fetch('https://www.googleapis.com/oauth2/v4/token', request)
  .then(function(res) {
    if (res.status != 200)
      return Promise.reject('received status: ' + res.status);
    return res.json();
  })
  .then(function(json) {
    tokenInfo.access_token = json.access_token;
    tokenInfo.expires_in = json.expires_in;
    tokenInfo.token_type = json.token_type;
    saveToken(key, tokenInfo);
    return json;
  })
}

function saveToken(key, json) {
  json.expires = Date.now() + json.expires_in * 1000;
  localStorage.setItem(key, JSON.stringify(json));
  localStorage.setItem('_auth_getProfileUserInfo', JSON.stringify(json));
}

function getProfileUserInfo(token) {
  var request = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      },
  };

  return fetch('https://www.googleapis.com/oauth2/v1/userinfo', request)
  .then(function(res) {
    if (res.status != 200)
      return Promise.reject('received status: ' + res.status);
    return res.json();
  });
}

var cachedProfileUserInfo;
chrome.identity = {
  getProfileUserInfo: function(cb) {
    try {
      if (cachedProfileUserInfo) {
        cb(cachedProfileUserInfo);
        return;
      }

      var key = '_auth_getProfileUserInfo';
      var tokenInfo = JSON.parse(localStorage.getItem(key));
      if (!tokenInfo.refresh_token || !tokenInfo.expires)
        throw new Error('not logged in');

      maybeRefreshToken(key, tokenInfo, cb)
      .then(function(json) {
        return getProfileUserInfo(tokenInfo.access_token);
      })
      .then(function(json) {
        cachedProfileUserInfo = json;
        cb(json)
      })
      .catch(function(s) {
        cb(null, s);
      });
    }
    catch (e) {
      cb(null, e.toString());
    }
  },
  getRedirectURL: function(path) {
    path = path || '';
    return `http://localhost:${chrome.identity.authServerPort}/${path}`
  },
  launchWebAuthFlow: function(opts, cb) {
    var url = opts.url;
    if (url.indexOf('?') == -1)
      url += '?';
    var random = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 8);
    authCallbacks[random] = cb;
    var redirect_uri = chrome.identity.getRedirectURL(random);
    var escaped_uri = encodeURIComponent(redirect_uri);
    var finalUrl = `${url}&redirect_uri=${escaped_uri}`;
    // always interactive..
    var interactive = true || opts.interactive;
    console.log(finalUrl);
    shell.openExternal(finalUrl);
  },
  getAuthToken: function() {
    var cb;
    var opts;
    var i = 0;
    if (arguments.length > i && typeof arguments[i] == 'object')
      opts = arguments[i++];
    if (arguments.length > i && typeof arguments[i] == 'function')
      cb = arguments[i++];

    if (!manifest.oauth2 || !manifest.oauth2.scopes || !manifest.oauth2.electron_chrome_client_id || !manifest.oauth2.electron_chrome_client_secret) {
      cb(null, 'oauth2 requires manifest to contain oauth2.scopes, oauth2.electron_chrome_client_id, and oauth2.electron_chrome_client_secret')
      return;
    }

    opts = opts || {};
    cb = cb || function(){};
    opts.scopes = opts.scopes || manifest.oauth2.scopes.slice();

    // hack to implement getProfileUserInfo
    opts.scopes.push('email', 'profile');

    var scopes = opts.scopes.join(' ');
    var key = 'auth ' + scopes;

    try {
      var tokenInfo = JSON.parse(localStorage.getItem(key));
      if (!tokenInfo.refresh_token || !tokenInfo.expires)
        throw new Error();

      maybeRefreshToken(key, tokenInfo, cb)
      .then(function(json) {
        cb(json.access_token);
      })
      .catch(function(s) {
        cb(null, s);
      });
      return;
    }
    catch (e) {
      if (!opts.interactive) {
        cb(null, 'Oauth2 not granted yet for these scopes. Request interactive.');
        return;
      }
    }

    launchFlowForCode(scopes, cb)
    .then(function(json) {
      saveToken(key, json);
      cb(json.access_token);
    })
    .catch(function(s) {
      cb(null, s);
    });
  }
}

chrome.storage = {};
chrome.storage.onChanged = makeEvent(true);

chrome.storage.local = {
  set: function(o, cb) {
    for (var i in o) {
      var oldValue = localStorage.getItem(i);
      var newValue = o[i];
      localStorage.setItem(i, JSON.stringify(newValue));
      chrome.storage.onChanged.invokeListeners(null, {
        oldValue: oldValue,
        newValue: newValue
      })
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
    safeRegister(selfWindow, bg.webContents, hideBg, 'devtools-focused');
    safeRegister(selfWindow, bg.webContents, hideBg, 'devtools-opened');
    safeRegister(selfWindow, bg.webContents, hideBg, 'devtools-closed');
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

Promise.all([
  calculateId(),
  startAuthServer(),
  // registerProtocol(),
])
.then(function() {
  console.log('initialized');
  setGlobal('chrome', chrome);
  console.log(chrome);
  createBackground();
})
