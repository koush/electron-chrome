const process = require('process');
const path = require('path');

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

var packager = require('electron-packager')
var out = path.join(__dirname, 'build');
packager({
  dir: __dirname,
  out: out,
  platform: 'darwin',
  arch: 'all',
  // all: true,
  afterCopy: [function(buildPath, electronVersion, platform, arch, callback) {
    var ncp = require('ncp').ncp;

    console.log(buildPath);

    ncp(appDir, path.join(buildPath, appId + '.crx'), function (err) {
      if (err) {
        return console.error(err);
        process.exit(-1);
      }
      callback();
    });
  }]
}, function (err, appPaths) {

})
