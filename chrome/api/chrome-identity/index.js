const {electron, remote} = require('../electron-remote.js');
const {BrowserWindow} = electron;
const manifest = remote.getGlobal('chromeManifest');
const {shell} = require('electron');
const path = require('path');

const {
  makeEvent,
  safeRegister,
} = require('../../main/global.js');

var appId;

var authServer = new require('http').Server();
var authCallback;
function startAuthServer(chromeAppId) {
  appId = chromeAppId;
  return new Promise((resolve, reject) => {
    authServer.on('error', function() {
      resolve();
    });
    authServer.listen(45613, function() {
      identity.authServerPort = authServer.address().port;
      resolve();
    })
    authServer.on('request', function(req, res) {
      try {
        var random = req.url.split('?')[0].split('/')[1];
        cb = authCallback;
        if (!cb) {
          res.writeHead(404);
          res.end('electron chrome auth server callback not found');
          return;
        }
        authCallback = null;
        res.end('<html><head><script>window.close();</script></head><body>Logged in.</body></html>')
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

function exchangeCodeForToken(code, redirect_uri) {
  if (!code)
    return Promise.reject('code not provided');

  var params = {
      code: code,
      client_id: manifest.oauth2.client_id,
      // client_secret: manifest.oauth2.client_secret,
      redirect_uri: redirect_uri,
      grant_type: 'authorization_code',
      access_type: 'offline',
  };

  params.redirect_uri = 'urn:ietf:wg:oauth:2.0:oob';

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

function maybeRefreshToken(key) {
  try {
    var tokenInfo = JSON.parse(localStorage.getItem(key));
    if (!tokenInfo.refresh_token || !tokenInfo.expires)
      throw new Error();
  }
  catch (e) {
    return Promise.reject('not logged in');
  }

  if (tokenInfo.access_token && tokenInfo.expires >= Date.now())
    return Promise.resolve(tokenInfo);

  var params = {
      client_id: manifest.oauth2.client_id,
      // client_secret: manifest.oauth2.client_secret,
      refresh_token: tokenInfo.refresh_token,
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
    // what sort of error codes do we get here that are recoverable via another interactive request?
    if (res.status != 200)
      return Promise.reject('received status: ' + res.status);
    return res.json();
  })
  .then(function(json) {
    tokenInfo.access_token = json.access_token;
    tokenInfo.expires_in = json.expires_in;
    tokenInfo.token_type = json.token_type;
    saveToken(key, tokenInfo);
    return tokenInfo;
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

const uriOutOfBrowser = 'urn:ietf:wg:oauth:2.0:oob';
var cachedProfileUserInfo;
var identity = {
  onSignInChanged: makeEvent(),

  getProfileUserInfo: function(cb) {
    if (cachedProfileUserInfo) {
      cb(null, cachedProfileUserInfo);
      return;
    }

    maybeRefreshToken('_auth_getProfileUserInfo')
    .then(function(json) {
      return getProfileUserInfo(json.access_token);
    })
    .then(function(json) {
      cachedProfileUserInfo = json;
      cb(null, json)
    })
    .catch(function(s) {
      cb(s);
    });
  },
  getRedirectURL: function(path) {
    path = path || '';
    return `http://localhost:${chrome.identity.authServerPort}/${path}`;
    // path = 'test';
    // return `https://example.com/${path}`;
    // return `http://localhost:${chrome.identity.authServerPort}/${path}`;
    // return `https://koush.github.io/electron-chrome/auth?port=${chrome.identity.authServerPort}&path=${path}`;
    // return `https://koush.github.io/electron-chrome/auth`;
  },
  launchWebAuthFlow: function(opts, cb) {
    var url = opts.url;
    var interactive = true || opts.interactive;
    if (!opts.oob) {
      if (url.indexOf('?') == -1)
        url += '?';
      authCallback = cb;
      // always interactive..
      shell.openExternal(finalUrl);
    }
    else {
      var opts = {
        width: 640,
        height: 400,
        title: 'Google Login',
        resizable: false,
        alwaysOnTop: true,
      };

      const w = new BrowserWindow(opts);
      var encodedUrl = encodeURIComponent(url);
      w.loadURL(`file://${__dirname}/chrome-identity.html?url=${encodedUrl}`);
      // w.webContents.openDevTools({mode: 'detach'});
      var gotCode;
      safeRegister(remote.getCurrentWindow(), w.webContents, function(code) {
        gotCode = true;
        cb(code);
      }, 'code');
      safeRegister(remote.getCurrentWindow(), w.webContents, function(code) {
        if (!gotCode)
          cb();
      }, 'close');
    }
  },
  getAuthToken: function(opts, cb) {
    if (!manifest.oauth2 || !manifest.oauth2.scopes || !manifest.oauth2.client_id) {
      cb('oauth2 requires manifest to contain oauth2.scopes, oauth2.client_id, and oauth2.client_secret')
      return;
    }

    opts.scopes = opts.scopes || manifest.oauth2.scopes.slice();
    var scopes = [];
    for (var scope of opts.scopes) {
      scopes.push(scope);
    }
    // hack to implement getProfileUserInfo
    scopes.push('email', 'profile');
    scopes = scopes.join(' ');

    var key = 'auth ' + scopes;

    try {
      // check for a token first, if non exists, lets get bail and try interactive.
      var tokenInfo = JSON.parse(localStorage.getItem(key));
      if (!tokenInfo.refresh_token || !tokenInfo.expires)
        throw new Error();

      maybeRefreshToken(key)
      .then(function(json) {
        cb(null, json.access_token);
      })
      .catch(function(s) {
        cb(s);
      });
      return;
    }
    catch (e) {
      if (!opts.interactive) {
        cb('Oauth2 not granted yet for these scopes. Request interactive.');
        return;
      }
    }

    new Promise(function(resolve, reject) {
      var escapedScopes = encodeURIComponent(scopes);
      var redirect_uri = encodeURIComponent(uriOutOfBrowser);
      var url = `https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&scope=${escapedScopes}&response_type=code&client_id=${manifest.oauth2.client_id}&redirect_uri=${redirect_uri}`;
      chrome.identity.launchWebAuthFlow({
        url: url,
        oob: true,
        interactive: true,
      }, function(code) {
        resolve(exchangeCodeForToken(code, redirect_uri));
      });
    })
    .then(function(json) {
      saveToken(key, json);
      cb(null, json.access_token);
      identity.onSignInChanged.invokeListeners();
    })
    .catch(function(s) {
      cb(s);
    });
  }
}

exports.identity = identity;
exports.startAuthServer = startAuthServer;
