if (require('electron-squirrel-startup')) return;

const path = require('path');
global.electronChromeRoot = __dirname;
require('module').globalPaths.push(global.electronChromeRoot);
require('module').globalPaths.push(path.join(global.electronChromeRoot, 'node_modules'));

const chromeMain = require('./chrome');

chromeMain.start()
