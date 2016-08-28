const fs = require('fs');
const path = require('path');

global.chromeRuntimeId = null;
global.chromeRuntimeVersion = null;

// search for the runtime id
for (var arg of process.argv) {
  if (arg.startsWith('--runtime-id=')) {
    // specify the runtime id, which is the app id for the runtime, on the chrome store.
    // this will download the crx, and replace the chrome runtime if necessary.
    // updates happen independent of the app.
    // for example: lhaagglfcbekgaiedemenlgbkbhjepnk
    // https://chrome.google.com/webstore/detail/electron-chrome-runtime/lhaagglfcbekgaiedemenlgbkbhjepnk?authuser=1
    global.chromeRuntimeId = arg.substring('--runtime-id='.length);
    console.log('chrome runtime id', global.chromeRuntimeId);
    break;
  }
}

function getManifestVersion(runtimePath) {
  return JSON.parse(fs.readFileSync(path.join(runtimePath, 'manifest.json')).toString()).version;
}

var myManifestVersion = getManifestVersion(__dirname);

function useCurrent() {
  global.chromeRuntimeVersion = myManifestVersion;
  console.log('using chrome runtime', myManifestVersion);
  // grab this, or grab latest one
  exports.start = function() {
    require('./main/start.js');
  }
}

(function() {
  try {
    // use packaged
    if (!global.chromeRuntimeId)
      return useCurrent();

    const {unpackLatestInstalledCrx} = require('./api/chrome-update.js');
    const unpackResult = unpackLatestInstalledCrx(global.chromeRuntimeId);
    if (unpackResult.manifest.version <= myManifestVersion)
      return useCurrent();

    console.log('found newer chrome runtime', unpackResult.manifest.version);
    exports.start = require(unpackResult.path).start;
  }
  catch (e) {
    console.error('error while trying to find latest chrome runtime', e);
    useCurrent();
  }
})();
