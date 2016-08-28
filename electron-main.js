const path = require('path');
global.electronChromeRoot = __dirname;
require('module').globalPaths.push(global.electronChromeRoot, 'node_modules');

const chromeMain = require('./chrome');

chromeMain.start()
