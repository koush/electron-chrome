const electron = require('electron');
const {app, protocol} = electron;
const {BrowserWindow} = electron;
const path = require('path');
const fs = require('fs');
const os = require('os');

global.chromeManifest = null;
global.chromeAppDir;
(function() {
  var appDir;
  for (var arg of process.argv) {
    if (arg.startsWith('--app-dir=')) {
      appDir = arg.substring('--app-dir='.length)
      break;
    }
  }

  if (!appDir) {
    console.error('Usage: electron . --app-dir=/path/to/chrome/app');
    app.exit(1);
  }

  appDir = path.join(__dirname, appDir);
  console.log(`starting chrome app at ${appDir}`);
  chromeAppDir = appDir;

  var manifestPath = path.join(appDir, 'manifest.json');
  try {
    var manifest = JSON.parse(fs.readFileSync(manifestPath).toString());
    chromeManifest = manifest;
  }
  catch (e) {
    console.error('unable to load manifest.json', e);
    app.exit(1);
  }

  if (manifest.nacl_modules) {
    // https://developer.chrome.com/extensions/manifest/nacl_modules

    // this nmf file needs to exist, and needs to have these entries.
    // normally, it would be cross platform toolchains like clang-newlib, or glibc,
    // but electron does not support nacl or pnacl.
    // electron only supports host pepper plugins.
    // put in these invalid native host entries that Chrome happily ignores.
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
      "win" : "windows",
      "linux": "linux",
    }

    var host = hostMap[os.platform()];
    if (host) {
      for (var nacl_module of manifest.nacl_modules) {
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

global.chromeRuntimeWindow = null;
function makeRuntimeWindow() {
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
  chromeRuntimeWindow.loadURL(`file://${__dirname}/chrome-runtime.html`)
  chromeRuntimeWindow.webContents.openDevTools({mode: 'detach'});
  chromeRuntimeWindow.hide();
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', function() {
  if (process.argv.indexOf('--silent') != -1)
    wantsActivate = false;
  makeRuntimeWindow();
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
    console.log(args);
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
