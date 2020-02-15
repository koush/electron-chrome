# `electron-chrome`

**Run Chrome apps in Electron.** (Because Google thought it would be a good idea to kill Chrome apps.)

This is basically an incomplete polyfill on the Chrome APIs.

## Install
```
git clone https://github.com/koush/electron-chrome.git
cd electron-chrome
npm install
```

Electron is required, and is not installed by the `npm install`. 
Install by running `npm install -g electron` or `yarn global add electron`.

## Run:
```
electron --enable-logging . --app-dir=/path/to/chrome-app/
```

Or run directly from the chrome store, by providing a chrome store app id.
This will also download updates as they become available. For example, to run [Vysor](https://chrome.google.com/webstore/detail/vysor/gidgenkbbabolejbgbpnhbimgjbffefm) from the Chrome store:

```
electron --enable-logging . --app-id=gidgenkbbabolejbgbpnhbimgjbffefm
```

### Build Installer (must be run on host platform, Mac or Windows. Linux not supported.):
```
npm run package -- --app-dir=/path/to/chrome/app/
```

## Goals
Chrome apps are being phased out on all platforms but ChromeOS.

I want to continue distributing Chrome apps (Vysor) on the Chrome store (which works on ChromeOS). After the phase out, this project will allow an simple way to distribute and run Chrome apps on desktop systems. Directly from the Chrome store, including automatic updates.

Having to build and distribute a 100MB+ Electron binary per platform, per app update is not ideal. So runtime and app updates will be decoupled from the Electron update, and from each other. Ideally, the updates to Chrome apps running on electron-chrome
are just the CRX that you get from the Chrome store, or the handful of runtime files which polyfill the chrome.* API.

### Mostly implemented:

chrome.identity

chrome.desktopCapture

chrome.storage.local

chrome.notifications

chrome.app.window

### Want to implement:

chrome.usb

### Not implemented (and no plans to implement):

chrome.socket: This Chrome API is kinda crap. I ended up wrapping it with my own, and then wrapped node.js Socket as well.
