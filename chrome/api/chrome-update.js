const querystring = require('querystring');
const electron = require('electron').remote || require('electron');
const {app} = electron;
const path = require('path');
const fs = require('fs');
const jq = require('../common/jquery-2.1.1.min.js')
const mkdirp = require('mkdirp')
const AdmZip = require('adm-zip');
const compareChromeVersions = require('../main/chrome-app-version.js').compare;
const pjson = require('package.json');

function getCrxDir(id) {
  id = id || '';
  return path.join(app.getPath('userData'), 'crx', id);
}

function getLatestVersion(id) {
  return new Promise((resolve, reject) => {
    var updateParams = {
      id: id,
      installsource: 'ondemand',
      uc: '',
    }
    // guess we're downloading it...
    var params = {
      prodversion: require('process').versions.chrome,
      x: querystring.stringify(updateParams)
    }
    var encodedParams = querystring.stringify(params);
    var updateUrl = (pjson.chrome && pjson.chrome.updateUrl) || 'https://clients2.google.com/service/update2/crx';
    var crxInfoUrl = `${updateUrl}?${encodedParams}`
    console.log(crxInfoUrl);

    var crxs = getCrxDir(id);
    mkdirp.sync(crxs);

    return fetch(crxInfoUrl)
    .then(res => {
      return res.text();
    })
    .then(text => {
      console.log('server version');
      console.log(text);
      var d = jq.parseXML(text);
      var updatecheck = jq(d).find('app[appid="' + id + '"]>updatecheck')[0];
      var updateResult = {
        codebase: updatecheck.getAttribute('codebase'),
        version: updatecheck.getAttribute('version'),
      };
      resolve(updateResult);
    });
  });
}

function downloadCrx(id, crxInfo) {
  const {version, codebase} = crxInfo;
  return new Promise((resolve, reject) => {
    var crxs = getCrxDir(id);
    var crxPath = path.join(crxs, 'app-' + version + '.crx');
    if (fs.existsSync(crxPath)) {
      console.log('crx exists');
      resolve(crxPath);
    }
    else {
      console.log(`fetching crx ${codebase}`);
      return fetch(codebase)
      .then(res => {
        // ugh barf, whatever. fix this later to stream to file.
        return res.arrayBuffer();
      })
      .then(ab => {
        // save to tmp, then rename to prevent partial writes.
        var crxTmpPath = crxPath + '.tmp';
        console.log(`writing crx to ${crxPath}`)
        fs.writeFile(crxTmpPath, Buffer.from(ab), function(e) {
          console.log('done writing');
          if (e)
            reject('unable to save crx file');
          else {
            deleteRecursive(crxPath);
            fs.renameSync(crxTmpPath, crxPath);
            resolve(crxPath);
          }
        })
      })
    }
  });
}

function downloadLatestVersion(id) {
  return getLatestVersion(id)
  .then(latest => {
    return downloadCrx(id, latest);
  });
}

var deleteRecursive = function(inPath) {
  // existsSync follows symlinks and crap, so just try to delete straight up first
  try {
    fs.unlinkSync(inPath);
  }
  catch (ignore) {
  }

  if (fs.existsSync(inPath) && fs.lstatSync(inPath).isDirectory()) {
    try {
      fs.readdirSync(inPath).forEach(function(file,index) {
        var curPath = path.join(inPath, file);
        deleteRecursive(curPath);
      });
    }
    catch (ignore) {
    }

    try {
      fs.rmdirSync(inPath);
    }
    catch (ignore) {
    }
  }
};

function clearCrxDir() {
  deleteRecursive(getCrxDir());
}

function extractCrx(crxPath) {
  if (!crxPath)
    return null;
  var unpackedPath = crxPath + '-unpacked';
  if (fs.existsSync(unpackedPath)) {
    return {
      manifest: JSON.parse(fs.readFileSync(path.join(unpackedPath, 'manifest.json'))),
      path: unpackedPath,
    };
  }

  console.log('extracting', crxPath);
  var b = fs.readFileSync(crxPath);
  var arrayBuffer = new Uint8Array(b).buffer;
  var ui32 = new DataView(arrayBuffer);
  // maybe this is a zip. check the zip magic.
  if (ui32.getInt32(0, true) != 0x04034b50) {
    var pklen = ui32.getInt32(8, true);
    var siglen = ui32.getInt32(12, true);

    var offset = 4 * 4 + pklen + siglen;
    console.log(offset);
    b = Buffer.from(arrayBuffer, offset);
  }
  var zip = new AdmZip(b);

  var tmp = unpackedPath + '.tmp';
  deleteRecursive(unpackedPath);
  deleteRecursive(tmp);
  zip.extractAllTo(tmp, true);
  fs.renameSync(tmp, unpackedPath);

  console.log('extracted', unpackedPath);
  return {
    manifest: JSON.parse(fs.readFileSync(path.join(unpackedPath, 'manifest.json'))),
    path: unpackedPath,
  }
}

function getLatestInstalledCrx(id, purge) {
  var dir = getCrxDir(id);
  if (!fs.existsSync(dir))
    return null;
  var crxs = fs.readdirSync(dir)
  .filter(s => s.endsWith('.crx') && s.startsWith('app-'))
  .sort(function(dir1, dir2) {
    dir1 = dir1.replace('app-', '').replace('.crx', '');
    dir2 = dir2.replace('app-', '').replace('.crx', '');
    return compareChromeVersions(dir1, dir2);
  });
  if (!crxs.length)
    return null;
  var ret = crxs.pop();
  if (purge) {
    var clear = fs.readdirSync(dir)
    .filter(s => s.indexOf(ret) == -1);
    clear.forEach(function(extra, index) {
      console.log(`deleting ${extra}`);
      var del = path.join(dir, extra);
      deleteRecursive(del);
      try {
        // if the old path can't be deleted for whatever reason (running binary),
        // just rename it so the directory can be used.
        // there was a bug in vysor where reset + upgrade failed because
        // an adb binary was sticking around daemonized.
        var random = Math.round(Math.random() * (1 << 30)).toString(16);
        fs.renameSync(del, path.join(dir, 'failed-delete-' + random));
      }
      catch (ignored) {
      }
    });
  }
  return path.join(dir, ret);
}

function unpackLatestInstalledCrx(id, purge) {
  // happily throw up errors
  // let the caller handle them and download the app again, etc.
  return extractCrx(getLatestInstalledCrx(id, purge));
}

exports.clearCrxDir = clearCrxDir;
exports.getLatestVersion = getLatestVersion;
exports.downloadCrx = downloadCrx;
exports.extractCrx = extractCrx;
exports.downloadLatestVersion = downloadLatestVersion;
exports.unpackLatestInstalledCrx = unpackLatestInstalledCrx;
