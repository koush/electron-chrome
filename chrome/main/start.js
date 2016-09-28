const electron = require('electron');
const {autoUpdater} = electron;
const {Menu} = electron;
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const notifier = require('../api/electron-notifications');

const isChromeAppUpgrade = require('./chrome-app-version.js').isUpgrade;

if (electron == null)
  throw new Error('must be started from main process');

const {app, protocol, BrowserWindow, shell} = electron;

// these need to be global scope for ipc
var mainGlobals = require('./global.js');

// the runtime will need these two values later
global.chrome = null;
global.chromeManifest = null;
global.chromeAppId = null;
global.chromeAppDir = null;

// a comment
var shouldQuit = app.makeSingleInstance((commandLine, workingDirectory) => {
  if (!global.chrome)
    return;

  if (commandLine.length == 2 && commandLine[1].startsWith('ec-' + global.chromeAppId + "://")) {
    app.emit('open-url', null, commandLine[1]);
  }
  else {
    chrome.app.runtime.onLaunched.invokeListeners(null, [{
      commandLine: commandLine,
      isKioskSession: false,
      isPublicSession: false,
      source: "command_line"
    }]);
  }
});

if (shouldQuit) {
  app.quit()
  return;
}

(function() {
  // app id search search:
  // 0) --app-id argument
  // 1) packageJosn.chrome.appId

  // app directory search order:
  // 0) --app-dir argument
  // 1) embededed unpacked-crx
  // 2) if app id was specified, use latest packed/downloaded version

  const pjson = require('package.json');

  var electronChromeManifest = pjson.chrome;
  if (electronChromeManifest && electronChromeManifest.autoUpdater) {
    var platform = os.platform() + '_' + os.arch();
    var version = app.getVersion();
    var feedUrl;
    if (electronChromeManifest.autoUpdater.nutsFeedBaseUrl) {
      // https://nuts.gitbook.com/update-osx.html
      //  electronChromeManifest.autoUpdater.nutsFeedBaseUrl = https://nuts.example.com/
      feedUrl = electronChromeManifest.autoUpdater.nutsFeedBaseUrl + 'update/' + platform + '/' + version ;
      // feedUrl = https://nuts.example.com/update/darwin_x64/1.1.4.0
    }
    if (feedUrl) {
      console.log(`autoUpdater feed url ${feedUrl}`)
      autoUpdater.setFeedURL(feedUrl);
      try {
        autoUpdater.checkForUpdates();
      }
      catch (e) {
        // ignore it, may not exist, code signature issue during dev, etc.
        console.error(e);
      }
    }
  }

  global.chromeAppId = pjson.chrome && pjson.chrome.appId;

  for (var arg of process.argv) {
    if (arg.startsWith('--app-dir=')) {
      // load an unpacked app
      global.chromeAppDir = arg.substring('--app-dir='.length)
    }
    else if (arg.startsWith('--app-id=')) {
      // load an app from the chrome store, will download crx.
      global.chromeAppId = arg.substring('--app-id='.length);
    }
  }

  if (!global.chromeAppDir) {
    var embeddedPath = path.join(app.getAppPath(), 'unpacked-crx');
    if (fs.existsSync(embeddedPath)) {
      global.chromeAppDir = embeddedPath;
      console.log(`embedded ${global.chromeAppDir} found`);
    }
  }

  if (global.chromeAppDir) {
    // global.chromeAppDir = path.join(__dirname, global.chromeAppDir);
    // console.log(`starting chrome app at ${global.chromeAppDir}`);

    var manifestPath = path.join(global.chromeAppDir, 'manifest.json');
    try {
      global.chromeManifest = JSON.parse(fs.readFileSync(manifestPath).toString());
    }
    catch (e) {
      console.error('unable to load manifest.json', e);
      app.exit(1);
    }
  }

  if (global.chromeAppId) {
    try {
      var result = require('../api/chrome-update.js').unpackLatestInstalledCrx(global.chromeAppId);
      if (result) {
        if (!global.chromeManifest || isChromeAppUpgrade(global.chromeManifest.version, result.manifest.version)) {
          global.chromeManifest = result.manifest;
          global.chromeAppDir = result.path;
        }
      }
      else {
        if (!global.chromeManifest)
          console.log('app not installed, fetching...');
      }
    }
    catch (e) {
      console.error(e);
      // having only this will trigger the runtime to attempt a download from the chrome store.
    }
  }

  if (!global.chromeAppId &&! global.chromeManifest) {
    console.error('Usage:');
    console.error('electron . --app-dir=/path/to/chrome/app');
    console.error('electron . --app-id=gidgenkbbabolejbgbpnhbimgjbffefm');
    app.exit(1);
  }

  if (!global.chromeRuntimeId && electronChromeManifest) {
    global.chromeRuntimeId = electronChromeManifest.runtimeId;
  }

  if (global.chromeRuntimeId)
    console.log('chrome runtime id', global.chromeRuntimeId);
  if (global.chromeAppId)
    console.log('chrome app id', global.chromeAppId);
  if (global.chromeAppDir)
    console.log('chrome app directory', global.chromeAppDir);

  autoUpdater.on('error', function() {
    console.error('autoUpdater error');
    console.error(arguments);
  })

  autoUpdater.on('update-downloaded', function() {
    const notification = notifier.notify(global.chromeManifest.name, {
      vertical: true,
      message: `There is an update available for ${chromeManifest.name}.`,
      icon: path.join(global.chromeAppDir, chromeManifest.icons[128]),
      buttons: [`Restart ${chromeManifest.name}`],
    })

    notification.once('buttonClicked', function(text, index) {
      BrowserWindow.getAllWindows().forEach(w => {
        w.close();
      })

      autoUpdater.quitAndInstall();
    });
  })

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
    //     "darwin": {
    //       "url": "darwin/video_decode.so"
    //     },
    //     "win32": {
    //       "url": "win32/video_decode.dll"
    //     },
    //     "linux": {
    //       "url": "linux/video_decode.so"
    //     }
    //   }
    // }


    var host = os.platform();
    for (var nacl_module of global.chromeManifest.nacl_modules) {
      if (!nacl_module.path || !nacl_module.mime_type) {
        console.error('nacl_module must have both path and mime_type keys');
        continue;
      }

      var nmfPath = path.join(global.chromeAppDir, nacl_module.path);
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

      // search relative to nmf, and also search relative to platform-assets
      var ppapiPath = path.join(path.dirname(nmfPath), url);
      if (!fs.existsSync(ppapiPath)) {
        console.error(`${ppapiPath} not found.`);
        ppapiPath = path.join(app.getAppPath(), 'platform-assets', url);
        if (!fs.existsSync(ppapiPath)) {
          console.error(`${ppapiPath} not found.`);
          continue;
        }
      }

      var flag = ppapiPath + ';' + nacl_module.mime_type;
      // console.log('PPAPI path ' +  ppapiPath + ';application/x-ppapi-vysor');
      console.log('PPAPI path ' + flag);
      app.commandLine.appendSwitch('register-pepper-plugins', flag);
    }
  }
})();

global.launchUrl = null;
app.on('open-url', function(event, url) {
  if (event)
    event.preventDefault();
  console.log(`custom url: ${url}`)
  if (!chromeRuntimeWindow)
    launchUrl = url;
});

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
    console.log('windows remaining', BrowserWindow.getAllWindows())
    chromeRuntimeWindow = null;
  })
  var runtimePath = path.join(__dirname, '..', 'api', 'chrome-runtime.html');
  chromeRuntimeWindow.loadURL(`file://${runtimePath}`);
  // chromeRuntimeWindow.webContents.openDevTools({mode: 'detach'});
  chromeRuntimeWindow.hide();
  chromeRuntimeWindow.on('show', chromeRuntimeWindow.hide.bind(chromeRuntimeWindow));
}

function calculateId() {
  if (global.chromeAppId) {
    return Promise.resolve(global.chromeAppId);
  }
  if (!global.chromeManifest.key) {
    return Promise.reject('no key in manifest, please provide an --app-id')
  }
  return require('./chrome-app-id.js').calculateId(global.chromeManifest.key);
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
        file = path.join(global.chromeAppDir, file);
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


  // Create the Application's main menu
  var template = [{
      label: "Application",
      submenu: [
          { label: "About Application", selector: "orderFrontStandardAboutPanel:" },
          { type: "separator" },
          { label: "Reset Application", click: function() {
            if (global.chrome)
              global.chrome.runtime.reset();
          }},
          { label: "Quit", accelerator: "Command+Q", click: function() { app.quit(); }}
      ]}, {
      label: "Edit",
      submenu: [
          { label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },
          { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
          { type: "separator" },
          { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
          { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
          { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
          { label: "Select All", accelerator: "CmdOrCtrl+A", selector: "selectAll:" }
      ]}
  ];

  if (process.platform == 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  Promise.all([
    calculateId(),
    registerProtocol(),
  ])
  .then(function() {
    makeRuntimeWindow();
  })
  .catch(function(e) {
    console.error(e);
    app.exit(-1);
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
