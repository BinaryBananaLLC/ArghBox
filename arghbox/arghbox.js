/*! ArghBox 0.1.1 | MIT | arghbox.com */
(function (window, document) {
  'use strict';
  var VERSION = '0.1.1';
  /* arghbox:labels:start */
  var LABELS = {"en":"Feedback"};
  /* arghbox:labels:end */
  /* arghbox:langs:start */
  var LANGS = ["en"];
  /* arghbox:langs:end */
  var api = window.ArghBox = window.ArghBox || { version: VERSION };
  if (api._on) return;
  var cur = document.currentScript;
  if (!api.open) api.open = api.close = api.showTab = api.hideTab = function () { return Promise.resolve(); };
  if (window.__arghboxTest) api._h = { matchLang: matchLang, parseHash: parseHash };

  function matchLang(want, list) {
    want = String(want || '').toLowerCase().replace('_', '-');
    function find(w) { return list.filter(function (l) { return l.toLowerCase() === w; })[0]; }
    return find(want) || find(want.split('-')[0]) || 'en';
  }
  function parseHash(hash) {
    var m = /^#arghbox(?:-(add|bug|[0-9]+))?$/i.exec(hash || '');
    if (!m) return null;
    var k = m[1] && m[1].toLowerCase();
    return k === 'add' ? { view: 'add', type: 'idea' } : k === 'bug' ? { view: 'add', type: 'bug' } : { view: 'list', id: +k || 0 };
  }

  var CSS = '.ab{all:initial;font:600 14px/1.2 var(--arghbox-font,system-ui,sans-serif);--ac:var(--arghbox-accent,#e8553d);--acs:color-mix(in srgb,var(--ac) 78%,#000)}' +
    '@supports(color:oklch(from red l c h)){.ab{--acs:oklch(from color-mix(in srgb,var(--ac) 78%,#000) min(l,.5) c h)}}' +
    '.tw:not([hidden]),.t{display:flex;flex-direction:column}' +
    '.tw{position:fixed;top:var(--off);z-index:var(--z);width:40px;transform:translateY(-50%);background:var(--acs);color:#fff;box-shadow:0 2px 14px #0005}' +
    '[data-pos=right] .tw{right:0;border-radius:14px 0 0 14px}' +
    '[data-pos=left] .tw{left:0;border-radius:0 14px 14px 0;flex-direction:column-reverse}' +
    ':where(.tw button){all:unset;cursor:pointer}' +
    '.t{align-items:center;gap:8px;padding:12px 0}.t[aria-busy]{opacity:.7}' +
    '.l{writing-mode:vertical-rl}[data-pos=left] .l{transform:rotate(180deg)}' +
    '.x{line-height:32px;text-align:center;font-size:20px;border-block:1px solid #fff6}' +
    '.tw :focus-visible{outline:3px solid #fff;outline-offset:-5px}' +
    '.t svg{width:28px;padding:3px;border-radius:50%;background:#fff6e9}' +
    '.t path{fill:var(--ac);stroke:#2b1d1a;stroke-width:2;stroke-linejoin:round}.t path:first-child{fill:#ffc83d}' +
    '.m{position:absolute;right:48px;width:240px;padding:10px;border-radius:10px;background:#2b1d1a;color:#fff}[data-pos=left] .m{right:auto;left:48px}';

  var cfg, wrap, shadow, host, tw, tabBtn, ctl, appP, prefetched;
  var forced, memDismiss, tabOff, preview, days, narrow, seq = 0, lastHash = '', shown;

  function ls(k, v) {
    try {
      return v === undefined ? localStorage.getItem(k) : v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch (e) { }
  }
  function emit(name, detail) { dispatchEvent(new CustomEvent(name, { detail: detail })); }
  function paintTab() {
    var h = !forced && (tabOff || memDismiss || (preview && !ls('arghbox:preview')) || (narrow && narrow.matches) || +ls('arghbox:hidden') > Date.now());
    tw.hidden = h;
    if (shown !== !h) {
      shown = !h;
      host.setAttribute('data-tab', shown ? 'shown' : 'hidden');
      emit('arghbox:tab', { visible: shown });
    }
  }
  function hide() { forced = 0; memDismiss = 1; paintTab(); }
  function attach() {
    if (!host.isConnected && document.body) document.body.appendChild(host);
  }

  function loadApp() {
    return window.__arghboxApp ? Promise.resolve(window.__arghboxApp) : appP || (appP = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.nonce = cfg.nonce;
      s.src = cfg.su(cfg.appUrl);
      s.onload = s.onerror = function () {
        s.remove();
        if (window.__arghboxApp) resolve(window.__arghboxApp); else { appP = 0; reject(); }
      };
      document.head.appendChild(s);
    }));
  }

  function open(o) {
    attach();
    var from = document.activeElement;
    while (from && from.shadowRoot && from.shadowRoot.activeElement) from = from.shadowRoot.activeElement;
    if (!from || from === document.body) from = tabBtn;
    var me = ++seq;
    tabBtn.setAttribute('aria-busy', 'true');
    return loadApp().then(function (app) {
      if (me !== seq) return;
      ctl = ctl || app.mount(shadow, cfg);
      ctl.open(o || {}, from);
    }).catch(function () {
      if (me !== seq) return;
      var m = shadow.querySelector('.m') || tw.appendChild(document.createElement('div'));
      m.className = 'm';
      m.setAttribute('role', 'alert');
      m.textContent = 'Could not load. Are you offline?';
      setTimeout(function () { m.remove(); }, 7000);
    }).then(function () { if (me === seq) tabBtn.removeAttribute('aria-busy'); });
  }

  function go(r) {
    ls('arghbox:preview', '1');
    paintTab();
    open(r);
  }
  function route() {
    var r = parseHash(location.hash);
    if (!r) return;
    history.replaceState(history.state, '', location.pathname + location.search + lastHash);
    go(r);
  }
  function onClick(ev) {
    if (ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    var p = ev.composedPath(), i, a, r;
    for (i = 0; i < p.length; i++) {
      a = p[i];
      if (a.tagName === 'A') {
        r = a.target != '_blank' && a.href.split('#')[0] === location.href.split('#')[0] && parseHash(a.hash);
        if (r) { ev.preventDefault(); go(r); }
        return;
      }
    }
  }

  function init() {
    var script = cur;
    if (!script) { var l = document.querySelectorAll('script[src*="arghbox.js"]'); script = l[l.length - 1]; }
    if (!script) return;
    var src = script.src;
    function data(n, d) { return script.getAttribute('data-' + n) || d; }
    var base = src.replace(/[^\/?#]*([?#].*)?$/, '');
    var v = (/[?&]v=([^&#]*)/.exec(src) || [0, VERSION])[1];
    var lang = matchLang(data('lang', document.documentElement.lang), LANGS);
    var pos = data('position') === 'left' ? 'left' : 'right';
    var off = Math.min(90, Math.max(10, parseFloat(data('offset', 50)) || 50));
    var label = data('label', LABELS[lang] || LABELS.en);
    var pol;
    try { pol = trustedTypes && trustedTypes.createPolicy('arghbox', { createScriptURL: function (u) { return u; } }); } catch (e) { }
    days = parseFloat(data('dismiss-days', 30));
    tabOff = data('tab') === 'off';
    preview = data('preview') === 'on';
    var mw = parseFloat(data('tab-min-width', 0));
    narrow = mw > 0 && matchMedia('(max-width:' + (mw - 0.02) + 'px)');

    wrap = document.createElement('div');
    cfg = {
      api: data('api', base + 'api.php'), base: base, ver: v,
      appUrl: base + 'arghbox-app.js?v=' + v, lang: lang, wrap: wrap, theme: data('theme', 'auto'),
      tone: data('tone') === 'neutral' ? 'neutral' : 'funny', position: pos, z: parseInt(data('z'), 10) || 2147483000,
      credit: data('credit') !== 'off', page: data('page', ''), nonce: script.nonce,
      su: function (u) { return pol ? pol.createScriptURL(u) : u; }
    };

    host = document.createElement('div');
    host.id = 'arghbox-root';
    host.style.cssText = 'all:initial!important;position:fixed!important;z-index:' + cfg.z + '!important';
    ['letter-spacing', 'word-spacing', 'line-height'].forEach(function (p) { host.style.removeProperty(p); });
    shadow = host.attachShadow({ mode: 'open' });
    var sh = new CSSStyleSheet();
    sh.replaceSync(CSS);
    shadow.adoptedStyleSheets = [sh];
    wrap.className = 'ab';
    wrap.setAttribute('data-pos', pos);
    wrap.style.cssText = '--z:' + cfg.z + ';--off:' + off + '%';
    if (data('accent')) wrap.style.setProperty('--arghbox-accent', data('accent'));

    tw = document.createElement('div');
    tw.className = 'tw';
    tabBtn = tw.appendChild(document.createElement('button'));
    tabBtn.className = 't';
    tabBtn.setAttribute('aria-haspopup', 'dialog');
    var NS = 'http://www.w3.org/2000/svg', svg = tabBtn.appendChild(document.createElementNS(NS, 'svg'));
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.appendChild(document.createElementNS(NS, 'path')).setAttribute('d', 'M17 1l2 4h3l-1 4 3 3-4 1-1 4-3-3-4 3v-5l-3-1 2-3-1-4 4 1z');
    svg.appendChild(document.createElementNS(NS, 'path')).setAttribute('d', 'M3 13h26v8H3zM5 21v8h22v-8M10 17h12');
    tabBtn.appendChild(document.createElement('span')).className = 'l';
    tabBtn.lastChild.textContent = label;
    tabBtn.onclick = function () { open({}); };
    tabBtn.onpointerenter = tabBtn.onfocus = function () {
      if (!prefetched) { prefetched = 1; fetch(cfg.appUrl, { credentials: 'omit', mode: 'no-cors' }).catch(function () {}); }
    };
    if (data('closable') !== 'off') {
      var x = tw.appendChild(document.createElement('button'));
      x.className = 'x';
      x.setAttribute('aria-label', 'Hide feedback button');
      x.textContent = '\u00d7';
      x.onclick = function () {
        if (days > 0) ls('arghbox:hidden', String(Date.now() + days * 864e5));
        hide();
        emit('arghbox:dismiss');
      };
    }
    wrap.appendChild(tw);
    shadow.appendChild(wrap);
    paintTab();
    document.body.appendChild(host);
    if (!parseHash(location.hash)) lastHash = location.hash;
    function onHash() { if (!parseHash(location.hash)) lastHash = location.hash; try { route(); } catch (e) {} }
    addEventListener('hashchange', onHash);
    document.addEventListener('click', onClick, true);
    if (narrow) narrow.addEventListener('change', paintTab);
    var mo = new MutationObserver(function () { attach(); watch(); });
    function watch() {
      mo.observe(document.documentElement, { childList: true });
      mo.observe(document.body, { childList: true });
    }
    watch();
    host._off = function () {
      removeEventListener('hashchange', onHash);
      document.removeEventListener('click', onClick, true);
      if (narrow) narrow.removeEventListener('change', paintTab);
      mo.disconnect();
      if (ctl) ctl.destroy();
      host.remove();
    };
    api.open = open;
    api.close = function () { seq++; tabBtn.removeAttribute('aria-busy'); try { ctl.close(); } catch (e) {} };
    api.showTab = function () { attach(); forced = 1; memDismiss = 0; ls('arghbox:hidden', null); paintTab(); };
    api.hideTab = hide;
    api._on = 1;
    route();
    emit('arghbox:ready');
  }

  function start() {
    if (api._on) return;
    var old = document.getElementById('arghbox-root');
    if (old && old._off) old._off();
    try { init(); } catch (e) { if (host) host.remove(); }
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})(window, document);
