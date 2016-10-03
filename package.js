const process = require('process');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const mkdirp = require('mkdirp');
const os = require('os');
const electronInstaller = require('electron-winstaller');

var deleteRecursive = function(inPath) {
  // existsSync follows symlinks and crap, so just try to delete straight up first
  try {
    fs.unlinkSync(inPath);
  }
  catch (ignore) {
  }

  if (fs.existsSync(inPath) && fs.lstatSync(inPath).isDirectory()) {
    fs.readdirSync(inPath).forEach(function(file,index) {
      var curPath = path.join(inPath, file);
      deleteRecursive(curPath);
    });
    fs.rmdirSync(inPath);
  }
};

const buildPath = path.join(__dirname, 'build');
deleteRecursive(buildPath);
mkdirp.sync(buildPath);

var appDir;
var appId;
var runtimeId;
var assets;
for (var arg of process.argv) {
  if (arg.startsWith('--app-id=')) {
    appId = arg.substring('--app-id='.length)
  }
  else if (arg.startsWith('--app-dir=')) {
    appDir = arg.substring('--app-dir='.length)
  }
  else if (arg.startsWith('--runtime-id=')) {
    runtimeId = arg.substring('--runtime-id='.length)
  }
  else if (arg.startsWith('--assets=')) {
    assets = arg.substring('--assets='.length)
  }
}

if (!appDir) {
  console.error('missing --app-dir argument');
  console.error('example: --app-dir=/path/to/chrome/app')
  process.exit(-1);
}

var manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'manifest.json')).toString());
var chrome;
try {
  chrome = JSON.parse(fs.readFileSync(path.join(appDir, 'electron.json')).toString());
}
catch (e) {
}

runtimeId = runtimeId || (chrome && chrome.runtimeId);

if (!runtimeId) {
  console.warn('missing --runtime-id')
  console.warn('Chrome runtime will only be updated with full electron upgrades.')
  console.warn('');
}
else {
  console.log(`chrome runtime id ${runtimeId}`)
  console.log();
}

function withAppId() {
  // grab largest
  var key = Object.keys(manifest.icons).sort((a,b) => parseInt(a) < parseInt(b))[0].toString();
  var icon = path.join(appDir, manifest.icons[key]);
  var child = require('child_process').exec(`icon.sh ${icon}`)
  child.stdout.pipe(process.stdout)
  child.on('exit', function() {
    startPackager();
  })
}

const platformIconExtensions = {
  win32: '.ico',
  darwin: '.icns',
  linux: '.png',
}

const platformIcon = path.join(process.cwd(), 'build/MyIcon' + platformIconExtensions[os.platform()]);

function startPackager() {
  var packager = require('electron-packager')
  var out = path.join(__dirname, 'build');
  packager({
    dir: __dirname,
    out: out,
    platform: os.platform(),
    arch: 'all',

    name: manifest.name,
    icon: platformIcon,
    'app-version': manifest.version,
    'build-version': manifest.version,
    'app-copyright': 'Copyright ' + (manifest.author || manifest.name),
    overwrite: true,

    // windows file details (needed for shortcut and stuff)
    win32metadata: {
      CompanyName: manifest.author || manifest.name,
      FileDescription: manifest.name,
      ProductName: manifest.name,
      InternalName: manifest.name,
    },

    // mac signing and url handler
    'osx-sign': true,
    protocols: [
      {
        name: manifest.name,
        schemes: [ `ec-${appId}` ]
      }
    ],

    // all: true,
    afterCopy: [function(buildPath, electronVersion, platform, arch, callback) {
      var ncp = require('ncp').ncp;

      console.log(appDir, buildPath);

      var electronJson = path.join(buildPath, 'package.json');
      var electronPackage = JSON.parse(fs.readFileSync(electronJson).toString());
      electronPackage.name = manifest.name;
      electronPackage.description = manifest.description;
      electronPackage.version = manifest.version;
      chrome = chrome || {};
      chrome.runtimeId = chrome.runtimeId || runtimeId;
      chrome.appId = chrome.appId || appId;
      electronPackage.chrome = chrome;
      fs.writeFileSync(electronJson, JSON.stringify(electronPackage, null, 2));

      console.log('copying app into place');
      ncp(appDir, path.join(buildPath, 'unpacked-crx'), {
        clobber: false,
        dereference: true,
      },
      function (err) {
        if (err) {
          console.error(err);
          process.exit(-1);
        }
        console.log('app copied into place');
        if (!assets) {
          callback();
          return;
        }

        console.log('copying platform-assets into place for', os.platform());
        var platformAssets = path.join(assets, os.platform());
        var platformAssetsDest = path.join(buildPath, 'platform-assets', os.platform());
        mkdirp.sync(platformAssetsDest);
        ncp(platformAssets, platformAssetsDest, {
          clobber: false,
          dereference: true,
        }, function(err) {
          if (err) {
            console.error(err);
            process.exit(-1);
          }
          console.log('platform-assets copied into place');
          callback();
        })
      });
    }]
  }, function (err, appPaths) {
    if (err) {
      console.error(err);
      throw err;
    }
    function makeMacZip(appPath) {
      var child = require('child_process').spawn('zip', ['-ry', `${manifest.name}-mac.zip`, `${manifest.name}.app`], {
        cwd: appPath,
      });
      child.stdout.pipe(process.stdout);
      child.on('exit', function() {
        console.log('zip complete');
      })
    }

    appPaths
    .filter(appPath => appPath.indexOf('darwin') != -1)
    .forEach(appPath => {
      console.log(appPath);
      /*
      var infoPlist = path.join(appPath, manifest.name + '.app', 'Contents', 'Info.plist');
      console.log(infoPlist);
      var child = require('child_process').exec(`defaults write ${infoPlist} CFBundleURLTypes '<array><dict><key>CFBundleURLName</key><string>${manifest.name}</string><key>CFBundleURLSchemes</key><array><string>ec-${appId}</string></array></dict></array>'`)
      child.stdout.pipe(process.stdout);
      child.on('exit', function() {
        makeMacZip();
      })
      */
      makeMacZip(appPath);
    })

    appPaths
    .filter(appPath => appPath.indexOf('win32') != -1)
    .forEach(appPath => {
      var key = Object.keys(manifest.icons).sort((a,b) => parseInt(a) < parseInt(b))[0].toString();
      var icon = path.join(appDir, manifest.icons[key]);
      var iconUrl = 'file://' + icon.replace(/\\/g, '/').replace(':', '');

      iconUrl = 'file://' + path.join(process.cwd(), platformIcon).replace(/\\/g, '/').replace(':', '');
      console.log(iconUrl);

      var resultPromise = electronInstaller.createWindowsInstaller({
        appDirectory: appPath,
        outputDirectory: appPath + '-installer',
        authors: manifest.author || manifest.name,
        version: manifest.version,
        exe: manifest.name + '.exe',
        setupExe: path.basename(appPath) + '.exe',
        productName: manifest.name,
        title: manifest.name,
        name: manifest.name,
        iconUrl: iconUrl,
        description: manifest.description,
        noMsi: true,
      });

      resultPromise.then(() => console.log("Windows Intaller created."), (e) => { console.log(`Windows Installer failed: ${e.message}`); console.log(e); } );
    })

  })
}

function needAppId() {
  console.error('missing --app-id argument');
  console.error('example: --app-id=gidgenkbbabolejbgbpnhbimgjbffefm')
  process.exit(-1);
}

if (!appId) {
  if (!manifest.key) {
    needAppId();
    return;
  }
  require('./chrome/main/chrome-app-id.js').calculateId(manifest.key)
  .then(id => {
    appId = id;
    withAppId();
  })
  .catch(() => {
    needAppId();
  })
}
else {
  withAppId();
}
