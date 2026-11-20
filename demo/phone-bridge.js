// Demo only (GitHub Pages build): loaded by arghbox/app.html before app-page.js. When the app page runs in the
// phone of the Contoso demo page, this stands in for the native app's bridge, so the page shows every message
// (open, vote, add, close, link) the way an iOS or Android app would receive it. A real install never loads it.
(function () {
  'use strict';
  try {
    var host = window.parent !== window && window.parent.ContosoPhone;
    if (host && !window.ReactNativeWebView) window.ReactNativeWebView = { postMessage: function (s) { host.receive(s); } };
  } catch (e) { /* a parent on another origin: no bridge */ }
})();
