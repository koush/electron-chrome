const path = require('path');

// window related globals
function setGlobal(n, v) {
  global[n] = v;
}

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


// safely handling events (window close race conditions)
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

const {makeEvent} = require(path.join('..', 'event.js'));

function safeWrapEvent(w, e) {
  var addListener = e.addListener;

  e.addListener = function(f) {
    autoUnregister(w, e, f);
    addListener(f);
  }
}

// open _blank pages in a real browser window.
function preventBrowserWindow(w) {
  w.webContents.on('new-window', function(e, url) {
    e.preventDefault();
    require('electron').shell.openExternal(url);
  })
}

exports.setGlobal = setGlobal;
exports.setWindowGlobal = setWindowGlobal;
exports.createWindowGlobals = createWindowGlobals;
exports.deleteWindowGlobals = deleteWindowGlobals;
exports.getWindowGlobal = getWindowGlobal;
exports.getWindowGlobals = getWindowGlobals;

exports.makeEvent = makeEvent;
exports.safeWrapEvent = safeWrapEvent;
exports.safeRegister = safeRegister;
exports.autoUnregister = autoUnregister;
exports.safeCallback = safeCallback;

exports.preventBrowserWindow = preventBrowserWindow;

// variables
exports.windowGlobals = {};

// if remote, grab the main process version of these.
const {remote} = require('electron');
if (remote) {
  for (var key in exports) {
    exports[key] = remote.getGlobal(key);
  }
}
else {
  for (var key in exports) {
    global[key] = exports[key];
  }
}
