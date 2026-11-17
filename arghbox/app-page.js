/*! ArghBox 0.1.0 | mobile app page | MIT | https://github.com/BinaryBananaLLC/ArghBox */
(function (w, d) {
  'use strict';
  var q = new URLSearchParams(w.location.search), me = d.currentScript, root = d.documentElement;
  function p(k, re, f) { var v = q.get(k); if (v && f) v = f(v); return v && re.test(v) ? v : ''; }

  // An unencoded + in a query arrives as a space; the platform is read in any letter case.
  var app = {}, platform = p('platform', /^(ios|android|other)$/, function (v) { return v.toLowerCase(); }), version = p('version', /^[\w.+-]{1,20}$/, function (v) { return v.replace(/ /g, '+'); });
  if (platform) app.platform = platform;
  if (version) app.version = version;
  (w.ArghBoxConfig = w.ArghBoxConfig || {}).app = app;

  var theme = p('theme', /^(auto|light|dark)$/), accent = p('accent', /^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (theme && theme !== 'auto') root.setAttribute('data-theme', theme);
  if (accent) root.style.setProperty('--ac', accent);

  // The loader goes in after parse, with the settings as data attributes. It has no tab: this page is the dialog.
  var s = d.createElement('script'), v = /[?&]v=([^&#]*)/.exec(me ? me.src : '');
  s.src = 'arghbox.js' + (v ? '?v=' + v[1] : '');
  s.setAttribute('data-tab', 'off');
  [['page', p('from', /^\/(?!\/)[^?#\s]{0,199}$/) || '/'], ['theme', theme], ['accent', accent], ['lang', p('lang', /^[A-Za-z-]{2,12}$/)], ['tone', p('tone', /^(funny|neutral)$/)]]
    .forEach(function (a) { if (a[1]) s.setAttribute('data-' + a[0], a[1]); });
  var routed = /^#arghbox(-(add|bug|\d+))?$/i.test(w.location.hash), view = p('view', /^(list|add)$/), type = p('type', /^(idea|bug|question)$/);
  w.addEventListener('arghbox:ready', function () { if (!routed) w.ArghBox.open({ view: view || 'list', type: type || undefined }); });

  // Messages to the native app, to every bridge that exists. The detail never holds visitor text.
  var closed = d.getElementById('c'), btn = d.getElementById('o');
  function bridges() {
    var wk = w.webkit && w.webkit.messageHandlers;
    return [w.ReactNativeWebView, wk && wk.arghbox, w.ArghBoxAndroid, w.ArghBoxFlutter].map(function (b, i) { return b && { b: b, i: i }; }).filter(Boolean);
  }
  function post(type, detail) {
    var m = { source: 'arghbox', type: type, detail: detail || {} }, str = JSON.stringify(m), n = 0;
    bridges().forEach(function (x) {
      try { x.b.postMessage(x.i === 1 ? m : str); n++; } catch (e) { }
    });
    return n;
  }
  ['open', 'close', 'add', 'vote'].forEach(function (t) {
    w.addEventListener('arghbox:' + t, function (e) {
      var n = post(t, e.detail);
      closed.hidden = t !== 'close' || n > 0;
      if (!closed.hidden) {
        w.location.href = 'arghbox://close'; // fixed on purpose: an app without a bridge intercepts it
        btn.focus();
      }
    });
  });
  // Links of the dialog open in the system browser (a WKWebView ignores target=_blank). composedPath sees into the shadow root.
  d.addEventListener('click', function (e) {
    var a = e.composedPath().filter(function (n) { return n.tagName === 'A' && n.href; })[0];
    if (a && bridges().length && /^(https?|mailto):/i.test(a.href)) { e.preventDefault(); post('link', { url: a.href }); }
  });
  s.onerror = function () {
    closed.querySelector('h1').textContent = 'Feedback could not load';
    btn.textContent = 'Try again';
    btn.onclick = function () { w.location.reload(); };
    closed.hidden = false;
  };
  btn.onclick = function () { w.ArghBox.open({}); };

  d.body.appendChild(s);
})(window, document);
