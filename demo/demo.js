// Contoso Tasks, the demo site: the demo bar and the phone with the ArghBox app page.
// Works on both demo hosts: `npm run dev` (the real PHP box) and the GitHub Pages build, where
// demo/backend.js stands in for api.php and sets window.ArghBoxDemo.
(function () {
  'use strict';
  var demo = window.ArghBoxDemo;

  /* ------------------------------------------------------------------ demo bar */

  var note = document.getElementById('demo-local-note');
  var password = document.getElementById('demo-password');
  if (demo) {
    // GitHub Pages: the box lives in this browser, so it can be reset.
    note.hidden = false;
    document.getElementById('demo-reset').addEventListener('click', function () {
      demo.reset();
      window.location.reload();
    });
  } else if (password) {
    // npm run dev: the real admin page wants the dev owner token.
    password.textContent = 'with the owner token that npm run dev printed';
  }
  // Once the visitor sent an entry (on the page or in the phone), step 2 is what to do next.
  function nextStep() {
    var step = document.getElementById('demo-step-2');
    if (step) step.className = 'now';
  }
  window.addEventListener('arghbox:add', nextStep);

  /* --------------------------------------------------------------------- phone */

  var button = document.getElementById('phone-feedback');
  var webview = document.getElementById('webview');
  var screen = document.getElementById('app-screen');
  var log = document.getElementById('bridge-log');
  var APP_URL = 'arghbox/app.html?platform=ios&version=5.12.1&from=/settings&accent=%231f5fd6';
  var frame = null;
  if (!button || !webview) return;

  // What a native app's bridge receives. On GitHub Pages, demo/phone-bridge.js inside the app page calls this
  // before the board opens; on the dev server the bridge is attached when the frame has loaded.
  function receive(raw) {
    var msg;
    try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
    if (!msg || msg.source !== 'arghbox') return;
    var empty = log.querySelector('.empty');
    if (empty) empty.remove();
    var li = document.createElement('li');
    var t = document.createElement('span');
    t.className = 't';
    t.textContent = msg.type;
    li.appendChild(t);
    li.appendChild(document.createTextNode(' ' + JSON.stringify(msg.detail || {})));
    log.insertBefore(li, log.firstChild);
    while (log.children.length > 8) log.removeChild(log.lastChild);
    if (msg.type === 'close') showApp();
    if (msg.type === 'add') nextStep();
    // An app opens the board's links in the system browser; here that is a new tab.
    if (msg.type === 'link' && msg.detail && /^(https?|mailto):/i.test(msg.detail.url || '')) window.open(msg.detail.url, '_blank', 'noopener');
  }
  window.ContosoPhone = { receive: receive };

  function attachBridge() {
    try {
      var w = frame.contentWindow;
      if (w && !w.ReactNativeWebView) w.ReactNativeWebView = { postMessage: receive };
    } catch (e) { /* not reachable: nothing to attach */ }
  }

  function showApp() {
    webview.hidden = true;
    screen.hidden = false;
    button.focus();
  }

  button.addEventListener('click', function () {
    screen.hidden = true;
    webview.hidden = false;
    if (!frame) {
      frame = document.createElement('iframe');
      frame.title = 'The feedback board inside the Contoso Tasks app';
      frame.src = APP_URL;
      frame.addEventListener('load', attachBridge);
      webview.appendChild(frame);
      attachBridge();
      return;
    }
    try { frame.contentWindow.ArghBox.open({}); } catch (e) { frame.src = APP_URL; }
    frame.focus();
  });
})();
