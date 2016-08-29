const electron = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');


if (electron == null)
  throw new Error('must be started from main process');

const {app, protocol, BrowserWindow, shell} = electron;

// these need to be global scope for ipc
var mainGlobals = require('./global.js');

// the runtime will need these two values later
global.chromeManifest = null;
global.chromeAppId = null;
var appDir;
(function() {
  for (var arg of process.argv) {
    if (arg.startsWith('--app-dir=')) {
      // load an unpacked app
      appDir = arg.substring('--app-dir='.length)
      break;
    }
    else if (arg.startsWith('--app-id=')) {
      // load an app from the chrome store, will download crx.
      global.chromeAppId = arg.substring('--app-id='.length);
      console.log('chrome app id', global.chromeAppId);
      break;
    }
  }

  if (global.chromeAppId) {
    try {
      var result = require('../api/chrome-update.js').unpackLatestInstalledCrx(global.chromeAppId);
      if (result) {
        global.chromeManifest = result.manifest;
        appDir = result.path;
      }
      else {
        console.log('app not installed, fetching...');
      }
    }
    catch (e) {
      console.error(e);
      // having only this will trigger the runtime to attempt a download from the chrome store.
    }
  }
  else if (appDir) {
    // appDir = path.join(__dirname, appDir);
    console.log(`starting chrome app at ${appDir}`);

    var manifestPath = path.join(appDir, 'manifest.json');
    try {
      global.chromeManifest = JSON.parse(fs.readFileSync(manifestPath).toString());
    }
    catch (e) {
      console.error('unable to load manifest.json', e);
      app.exit(1);
    }
  }
  else {
    console.error('Usage:');
    console.error('electron . --app-dir=/path/to/chrome/app');
    console.error('electron . --app-id=gidgenkbbabolejbgbpnhbimgjbffefm');
    app.exit(1);
  }
  if (global.chromeManifest && global.chromeManifest.nacl_modules) {
    // https://developer.chrome.com/extensions/manifest/nacl_modules

    // this nmf file needs to exist, and needs to have these entries.
    // normally, it would be cross platform toolchains like clang-newlib, or glibc,
    // but electron does not support nacl or pnacl.
    // electron only supports host pepper plugins.
    // put in these invalid native host entries that Chrome happily ignores.
    // darwin, windows, and linux are the names of the host toolchains.
    // map these to os.platform()
    // {
    //   "files": {},
    //   "program": {
    //     "mac": {
    //       "url": "mac/video_decode.so"
    //     },
    //     "windows": {
    //       "url": "windows/video_decode.dll"
    //     },
    //     "linux": {
    //       "url": "linux/video_decode.so"
    //     }
    //   }
    // }

    var hostMap = {
      "darwin": "mac",
      "win32" : "windows",
      "linux": "linux",
    }

    var host = hostMap[os.platform()];
    if (host) {
      for (var nacl_module of global.chromeManifest.nacl_modules) {
        if (!nacl_module.path || !nacl_module.mime_type) {
          console.error('nacl_module must have both path and mime_type keys');
          continue;
        }

        var nmfPath = path.join(appDir, nacl_module.path);
        try {
          var nmf = JSON.parse(fs.readFileSync(nmfPath));
        }
        catch (e) {
          console.error('error loading', nmfPath, 'skipping plugin')
          continue;
        }
        if (!nmf.program) {
          console.error('program key not found in native manifest file', nacl_module.path);
          continue;
        }

        var program = nmf.program[host];
        if (!program) {
          console.error(host, 'key not found in native manifest file programs', nacl_module.path);
          continue;
        }

        var url = program.url;
        if (!url) {
          console.error(url, 'key not found in native manifest file programs', nacl_module.path, host);
          continue;
        }

        var ppapiPath = path.join(path.dirname(nmfPath), url);
        var flag = ppapiPath + ';' + nacl_module.mime_type;
        // console.log('PPAPI path ' +  ppapiPath + ';application/x-ppapi-vysor');
        console.log('PPAPI path ' + flag);
        app.commandLine.appendSwitch('register-pepper-plugins', flag);
      }
    }
    else {
      console.error("Not loading plugins, unknown host.");
    }
  }
})();

// app.commandLine.appendSwitch('allow-file-access-from-files', null);
// app.commandLine.appendSwitch('allow-file-access-from-files', 'true');

global.chromeRuntimeWindow = null;
function makeRuntimeWindow() {
  if (false) {
    return require(path.join('..', 'api', 'chrome-runtime.js'))
  }

  if (chromeRuntimeWindow) {
    console.error('runtime already exists');
    return;
  }

  console.log('starting runtime');
  chromeRuntimeWindow = new BrowserWindow({
    show: false,
  });
  chromeRuntimeWindow.on('close', function() {
    console.log('chromeRuntimeWindow shutdown');
    chromeRuntimeWindow = null;
  })
  var runtimePath = path.join(__dirname, '..', 'api', 'chrome-runtime.html');
  chromeRuntimeWindow.loadURL(`file://${runtimePath}`);
  chromeRuntimeWindow.webContents.openDevTools({mode: 'detach'});
  chromeRuntimeWindow.hide();
  chromeRuntimeWindow.on('show', chromeRuntimeWindow.hide.bind(chromeRuntimeWindow));
}


function calculateId() {
  if (global.chromeAppId) {
    return Promise.resolve(global.chromeAppId);
  }

  return new Promise((resolve, reject) => {
    var key = global.chromeManifest.key;
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
      global.chromeAppId = id;
      resolve(id);

    });
    hash.write(buffer);
    hash.end()
  });
}


function registerProtocol() {
  return new Promise((resolve, reject) => {
    protocol.unregisterProtocol('chrome-extension', function() {
      var cache = {};
      protocol.registerBufferProtocol('chrome-extension', function(request, callback) {
        if (request.url == `chrome-extension://${chrome.runtime.id}/_generated_background_page.html`) {
          var scripts = global.chromeManifest.app.background.scripts;
          var scriptsString = scripts
          .map(s => `<script src="${s}" type="text/javascript"></script>`)
          .join('\n');
          var html = `<!DOCTYPE html>\n<html>\n<head>\n</head>\n<body>\n${scriptsString}\n</body>\n</html>\n`
          callback(Buffer.from(html));
          return;
        }

        if (cache[request.url]) {
          callback(cache[request.url]);
          return;
        }

        var file = request.url.replace(`chrome-extension://${chrome.runtime.id}/`, '');
        file = path.join(appDir, file);
        var query = file.indexOf('?');
        if (query != -1)
          file = file.substring(0, query);
        fs.readFile(file, function(e, d) {
          var result = cache[request.url] = e || d;
          callback(result);
        })
      }, function(e) {
        if (e) {
          reject(e);
          return;
        }
        resolve();
      })
    });
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', function() {
  if (process.argv.indexOf('--silent') != -1)
    wantsActivate = false;

  Promise.all([
    calculateId(),
    registerProtocol(),
  ])
  .then(function() {
    makeRuntimeWindow();
  })
})

global.isReloading = false;
global.wantsActivate = true;
// Quit when all windows are closed.
app.on('window-all-closed', () => {
  console.log('window-all-closed');
  if (isReloading) {
    var args = process.argv.slice(1).filter(s => s != '--silent')
    if (!wantsActivate)
      args.push('--silent');
    app.relaunch({
      args: args
    });
    app.exit(0);
    return;

    makeRuntimeWindow();
    isReloading = false;
    return;
  }

  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (!chromeRuntimeWindow) {
    wantsActivate = true;
    makeRuntimeWindow();
  }
})
