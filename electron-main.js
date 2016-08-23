const electron = require('electron');
const {app, protocol} = electron;
const {BrowserWindow} = electron;
const path = require('path');
const fs = require('fs');

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

  console.log(manifest.name);

  var ppapiPath = '/Volumes/Android/Gradle/Vysor/Chrome/vysor/video_decode/mac/Release/video_decode.so'
  console.log('PPAPI path ' +  ppapiPath + ';application/x-ppapi-vysor');
  app.commandLine.appendSwitch('register-pepper-plugins', ppapiPath + ';application/x-ppapi-vysor');
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
