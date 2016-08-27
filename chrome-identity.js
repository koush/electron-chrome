var authServer = new require('http').Server();
var authCallbacks = {};
function startAuthServer() {
  return new Promise((resolve, reject) => {
    authServer.on('error', function() {
      resolve();
    });
    authServer.listen(function() {
      identity.authServerPort = authServer.address().port;
      resolve();
    })
    authServer.on('request', function(req, res) {
      try {
        var random = req.url.split('?')[0].split('/')[1];
        cb = authCallbacks[random];
        if (!cb) {
          res.writeHead(404);
          res.end('electron chrome auth server callback not found');
          return;
        }
        delete authCallbacks[random];
        res.writeHead(302, {
          Location: 'https://vysor.io'
        });
        res.end('Logged into Vysor.')
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
      client_id: manifest.oauth2.electron_chrome_client_id,
      client_secret: manifest.oauth2.electron_chrome_client_secret,
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

var cachedProfileUserInfo;
var identity = {
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
    shell.openExternal(finalUrl);
  },
  getAuthToken: function(opts, cb) {
    if (!manifest.oauth2 || !manifest.oauth2.scopes || !manifest.oauth2.electron_chrome_client_id || !manifest.oauth2.electron_chrome_client_secret) {
      cbError('oauth2 requires manifest to contain oauth2.scopes, oauth2.electron_chrome_client_id, and oauth2.electron_chrome_client_secret')
      return;
    }

    opts.scopes = opts.scopes || manifest.oauth2.scopes.slice();

    // hack to implement getProfileUserInfo
    opts.scopes.push('email', 'profile');

    var scopes = opts.scopes.join(' ');
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

    launchFlowForCode(scopes, cb)
    .then(function(json) {
      saveToken(key, json);
      cb(null, json.access_token);
    })
    .catch(function(s) {
      cb(s);
    });
  }
}

exports.identity = identity;
exports.startAuthServer = startAuthServer;
