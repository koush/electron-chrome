const querystring = require('querystring');
const electron = require('electron').remote || require('electron');
const {app} = electron;
const path = require('path');
const fs = require('fs');
const jq = require('./jquery-2.1.1.min.js')
const mkdirp = require('mkdirp')
const AdmZip = require('adm-zip');

function getCrxDir(id) {
  return path.join(app.getPath('userData'), 'crx', id);
}

function getLatestVersion(id) {
  return new Promise((resolve, reject) => {
    var updateParams = {
      id: appId,
      installsource: 'ondemand',
      uc: '',
    }
    // guess we're downloading it...
    var params = {
      prodversion: require('process').versions.chrome,
      x: querystring.stringify(updateParams)
    }
    var encodedParams = querystring.stringify(params);
    var crxInfoUrl = `https://clients2.google.com/service/update2/crx?${encodedParams}`
    console.log(crxInfoUrl);

    var crxs = getCrxDir(id);
    mkdirp.sync(crxs);

    return fetch(crxInfoUrl)
    .then(res => {
      return res.text();
    })
    .then(text => {
      var d = jq.parseXML(text);
      var updatecheck = jq(d).find('app>updatecheck')[0];
      var codebase = updatecheck.getAttribute('codebase');
      return updatecheck.getAttribute('version');
    });
  });
}

function downloadCrx(id, version) {
  return new Promise((resolve, reject) => {
    var crxs = getCrxDir(id);
    var crxPath = path.join(crxs, 'app-' + version + '.crx');
    if (fs.existsSync(crxPath)) {
      console.log('crx exists');
      return crxPath;
    }
    else {
      console.log('fetching crx');
      return fetch(codebase)
      .then(res => {
        // ugh barf, whatever. fix this later to stream to file.
        return res.arrayBuffer();
      })
      .then(ab => {
        // save to tmp, then rename to prevent partial writes.
        return new Promise((resolve, reject) => {
          var crxTmpPath = crxPath + '.tmp';
          fs.writeFile(crxTmpPath, Buffer.from(ab), function(e) {
            if (e)
              reject('unable to save crx file');
            else {
              fs.renameSync(crxTmpPath, crxPath);
              resolve(crxPath);
            }
          })
        })
      })
    }
  });
}

function downloadLatestVersion(id) {
  return getLatestVersion(id)
  .then(version => {
    return downloadCrx(id, version);
  });
}

var deleteFolderRecursive = function(inPath) {
  if( fs.existsSync(inPath) ) {
    fs.readdirSync(inPath).forEach(function(file,index){
      var curPath = inPath + "/" + file;
      if(fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(inPath);
  }
};

function extractCrx(crxPath) {
  console.log('extracting', crxPath);
  var b = fs.readFileSync(crxPath);
  var arrayBuffer = new Uint8Array(b).buffer;
  var ui32 = new DataView(arrayBuffer);
  var pklen = ui32.getInt32(8, true);
  var siglen = ui32.getInt32(12, true);

  var offset = 4 * 4 + pklen + siglen;
  console.log(offset);
  b = Buffer.from(arrayBuffer, offset);
  var zip = new AdmZip(b);

  var unpackedPath = crxPath + '-unpacked';
  var tmp = unpackedPath + '.tmp';
  deleteFolderRecursive(unpackedPath);
  deleteFolderRecursive(tmp);
  zip.extractAllTo(tmp, true);
  fs.renameSync(tmp, unpackedPath);

  return {
    manifest: JSON.parse(fs.readFileSync(path.join(unpackedPath, 'manifest.json'))),
    path: unpackedPath,
  }
}

function getLatestInstalledCrx(id) {
  var dir = getCrxDir(id);
  return path.join(dir, fs.readdirSync(dir)
  .filter(s => s.endsWith('.crx') && s.startsWith('app-'))
  .sort()
  .pop());
}

function unpackLatestInstalledCrx(id) {
  // happily throw up errors
  // let the caller handle them and download the app again, etc.
  return extractCrx(getLatestInstalledCrx(id));
}

exports.downloadLatestVersion = downloadLatestVersion;
exports.unpackLatestInstalledCrx = unpackLatestInstalledCrx;
