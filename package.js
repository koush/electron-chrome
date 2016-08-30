const process = require('process');
const path = require('path');
const fs = require('fs');

var appDir;
var appId;
for (var arg of process.argv) {
  if (arg.startsWith('--app-id=')) {
    appId = arg.substring('--app-id='.length)
  }
  else if (arg.startsWith('--app-dir=')) {
    appDir = arg.substring('--app-dir='.length)
  }
}

if (!appId) {
  console.error('missing --app-id argument');
  console.error('example: --app-id=gidgenkbbabolejbgbpnhbimgjbffefm')
  process.exit(0);
}

if (!appDir) {
  console.error('missing --app-dir argument');
  console.error('example: --app-dir=/path/to/chrome/app')
  process.exit(0);
}

var manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'manifest.json')).toString());

var packager = require('electron-packager')
var out = path.join(__dirname, 'build');
packager({
  dir: __dirname,
  out: out,
  platform: 'darwin',
  arch: 'all',
  name: manifest.name,
  'app-version': manifest.version,
  // all: true,
  afterCopy: [function(buildPath, electronVersion, platform, arch, callback) {
    var ncp = require('ncp').ncp;

    console.log(appDir, buildPath);

    var electronJson = path.join(buildPath, 'package.json');
    var electronPackage = JSON.parse(fs.readFileSync(electronJson).toString());
    electronPackage.name = manifest.name;
    electronPackage.description = manifest.description;
    electronPackage.version = manifest.version;
    fs.writeFileSync(electronJson, JSON.stringify(electronPackage));

    ncp(appDir, path.join(buildPath, appId + '.crx'), {
      clobber: false,
      dereference: true,
    },
    function (err) {
      if (err) {
        console.error(err);
        process.exit(-1);
      }
      console.log('app copied into place');
      callback();
    });
  }]
}, function (err, appPaths) {

})
