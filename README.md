Run Chrome apps in Electron.
Because Google thought it would be a good idea to kill Chrome apps.

This is basically an incomplete polyfill on the Chrome APIs.

```
electron . --app-dir=/path/to/chrome-app/
```

Or run directly from the chrome store, by providing a chrome store app id.
This will also download updates as they become available.

```
electron . --app-id=gidgenkbbabolejbgbpnhbimgjbffefm
```

A lot of stuff is implemented. Enough to run Vysor:
https://chrome.google.com/webstore/detail/vysor/gidgenkbbabolejbgbpnhbimgjbffefm

Goals:
Chrome apps are being phased out on all platforms but ChromeOS.
I want to continue distributing Chrome apps (Vysor) on the Chrome store (which
works on ChromeOS). After the phase out, this project will allow an simple way to
distribute and run Chrome apps on desktop systems. Directly from the Chrome store,
including automatic updates.
Having to build and distribute a 100MB+ Electron binary per platform, per app update
is not ideal. So runtime and app updates will be decoupled from the Electron update,
and from each other. Ideally, the updates to Chrome apps running on electron-chrome
are just the CRX that you get from the Chrome store, or the handful of runtime files
which polyfill the chrome.* API.

Main thing that is missing is chrome.fileSystem. That's an easy fix once
this bug is merged (1.3.5 I think?):
https://github.com/electron/electron/issues/6949

Mostly implemented:

chrome.identity
chrome.desktopCapture
chrome.storage.local
chrome.notifications
chrome.app.window

Want to implement:
chrome.usb

Not implemented (and no plans to implement):
chrome.socket: This Chrome API is kinda crap. I ended up wrapping it with my own, and then
wrapped node.js Socket as well.
