/*! ArghBox 0.1.2 | app: the dialog | MIT | https://github.com/BinaryBananaLLC/ArghBox */
(function (window, document) {
  'use strict';

  var VERSION = '0.1.2';
  var FONT = 'var(--arghbox-font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif)';

  // ArghBox palette (art/README.md); hosts override it with --arghbox-* properties (docs/configuration.md)
  var CSS =
    '.ab{--bg:var(--arghbox-bg,#fff);--fg:var(--arghbox-fg,#2b1d1a);--mut:var(--arghbox-muted,#6e5d56);--line:var(--arghbox-line,#eee3d6);' +
    '--ib:var(--arghbox-border,#8f7c73);--card:var(--arghbox-card,#fff6e9);--ring:#1a56db;' +
    '--act:var(--acs);--shadow:0 14px 44px rgba(43,29,26,.3);--tint:color-mix(in srgb,var(--ac) 10%,var(--bg));--hov:color-mix(in srgb,var(--fg) 8%,transparent)}' +
    '.ab[data-dark]{--bg:var(--arghbox-bg,#1f1613);--fg:var(--arghbox-fg,#fff6e9);--mut:var(--arghbox-muted,#b8a8a0);--line:var(--arghbox-line,#3b2d28);' +
    '--ib:var(--arghbox-border,#8a7870);--card:var(--arghbox-card,#2c211d);--ring:#8ab4ff;' +
    '--act:color-mix(in srgb,var(--ac) 62%,#fff);--shadow:0 14px 44px rgba(0,0,0,.65);--tint:color-mix(in srgb,var(--ac) 16%,var(--bg))}' +
    '.ab *{box-sizing:border-box}' +
    '.ov{position:fixed;inset:0;overscroll-behavior:contain;z-index:calc(var(--z,2147483000) + 1);background:rgba(31,22,19,.4);font:400 14px/1.45 ' + FONT + ';color:var(--fg)}' +
    '.panel{position:absolute;top:12px;bottom:12px;right:12px;width:420px;max-width:calc(100% - 24px);display:flex;flex-direction:column;' +
    'background:var(--bg);color:var(--fg);border-radius:16px;box-shadow:var(--shadow);overflow:hidden;outline:0}' +
    '[data-pos=left] .panel{right:auto;left:12px}' +
    ':where(.panel button,.panel input,.panel textarea){font:inherit;color:inherit;margin:0}' +
    ':where(.panel button){appearance:none;background:none;border:0;padding:0;cursor:pointer;text-align:inherit}' +
    '.panel :focus-visible{outline:2px solid var(--ring);outline-offset:2px;border-radius:6px}' +
    '.hd{display:flex;align-items:flex-start;gap:8px;padding:14px 8px 8px 20px;touch-action:none}' +
    '.hd.bk{padding-left:8px}' +
    '.hdt{flex:1;min-width:0;padding-top:6px}' +
    'h2{margin:0;font:700 20px/1.25 ' + FONT + ';overflow-wrap:anywhere}' +
    '.panel h2:focus{outline:0}' + // beats .panel :focus-visible: a heading takes focus for screen readers, no ring
    'h3{margin:18px 0 6px;font:700 12px/1.3 ' + FONT + ';text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}' +
    '.sub{margin:2px 0 0;color:var(--mut)}' +
    '.ib{display:inline-flex;align-items:center;justify-content:center;gap:2px;min-width:44px;height:44px;padding:0 10px;border-radius:12px;color:var(--fg)}' +
        '.ic{display:inline-flex}.ic svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}' +
    '.banner{margin:0 16px 8px;padding:10px 12px;border-radius:10px;background:#fde8e6;color:#8c1d12;font-weight:500}' +
    '.ab[data-dark] .banner{background:#4a1f1b;color:#ffd5cf}' +
    '.banner[hidden],.sim[hidden],.fe[hidden]{display:none}' +
    '.vw{flex:1;min-height:0;display:flex;flex-direction:column;margin:0}' +
    '.sc{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:0 20px 16px}' +
    '.ft{touch-action:none;padding:12px 20px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--line);display:flex;flex-direction:column;gap:8px}' +
    '.pri,.sec{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;padding:0 18px;border-radius:12px;font-weight:600;text-align:center}' +
    '.pri{background:var(--acs);color:#fff}.pri[disabled]{opacity:.65;cursor:progress}' +
    '@media(hover:hover){:where(.ib,.sec,.chip,.vote,.srt button):hover,:where(.ty:hover span){background:var(--hov)}' +
    '.pri:not([disabled]):hover{background:color-mix(in srgb,var(--acs) 85%,#000)}.tabs button:hover,.rp:hover{color:var(--fg)}}' +
    '.sec{border:1.5px solid var(--ib)}' +
    '.cr{text-align:center;font-size:12px}.cr a{color:var(--mut)}' +
    '.mk{width:16px;height:16px;margin-right:5px;vertical-align:-3px;shape-rendering:crispEdges;fill:var(--fg)}' +
    '.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}' +
    '.tabs{display:flex;flex:1;background:var(--card);border-radius:12px;padding:3px;gap:3px;min-width:200px}' +
    '.tabs button{flex:1;min-height:44px;border-radius:9px;font-weight:600;color:var(--mut);text-align:center}' +
    '.tabs button[aria-selected=true]{background:var(--bg);color:var(--fg);box-shadow:0 1px 3px rgba(0,0,0,.22)}' +
    '.srt{display:flex;gap:2px;align-items:center;color:var(--mut)}' +
    '.srt button{min-height:44px;padding:0 10px;border-radius:10px;color:var(--mut);text-align:center}' +
    '.srt button[aria-pressed=true]{color:var(--act);font-weight:700;background:var(--tint)}' +
    '.q{display:block;width:100%;height:44px;padding:0 12px;border:1.5px solid var(--ib);border-radius:12px;background:var(--bg);font-size:16px}' +
    '.q::placeholder,.in::placeholder{color:var(--mut);opacity:1}' +
    '.wel{margin:4px 0 8px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--mut)}.wel[hidden],.chips[hidden]{display:none}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 2px}' +
    '.chip{display:inline-flex;align-items:center;gap:4px;min-height:32px;padding:0 11px;border:1.5px solid var(--ib);border-radius:99px;font-size:13px;color:var(--fg)}' +
    '.chip[aria-pressed=true]{background:var(--acs);border-color:var(--acs);color:#fff}' +
    '.items{list-style:none;margin:0;padding:0}' +
    '.it{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);align-items:flex-start}' +
    '.vote{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:none;width:60px;min-height:62px;gap:1px;border:1.5px solid var(--ib);border-radius:12px;color:var(--fg);text-align:center}' +
    '.vote .ic svg{width:18px;height:18px}.vl{font:600 11px/1.2 ' + FONT + '}' +
    '.vote b{font-weight:700;font-size:15px;line-height:1.1}' +
    '.vote.on{border-color:var(--act);background:var(--tint);color:var(--act)}' +
    '.vote[aria-busy=true]{border-style:dashed;cursor:progress}' +
    '.card{flex:1;min-width:0;display:block;padding:0}' +
    '.card .tt{display:block;font-weight:600;font-size:15px;line-height:1.35;overflow-wrap:anywhere}' +
    '.card:hover .tt{text-decoration:underline}' +
    '.ex{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--mut);margin-top:2px;overflow-wrap:anywhere}' +
    '.meta{display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:6px;align-items:center;color:var(--mut);font-size:13px}' +
    '.bd{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:600;background:color-mix(in srgb,var(--c,var(--mut)) 16%,var(--bg));color:color-mix(in srgb,var(--c,var(--mut)) 55%,var(--fg))}' +
    '.planned{--c:#1d5fb8}.in_progress{--c:#d98a00}.done{--c:#1f9d55}.declined{--c:#6b6877}.question{--c:#7c3aed}.team{--c:var(--act)}' +
    '.tg{color:var(--mut)}' +
    '.ch{display:flex;align-items:center;gap:6px;width:100%;min-height:44px;margin-top:10px;font-weight:700;color:var(--mut)}' +
    '.ch .ic{transition:transform .15s}.ch[aria-expanded=true] .ic{transform:rotate(90deg)}' +
    '.empty{padding:28px 8px;text-align:center;color:var(--mut)}' +
    '.mine{margin:10px 0 4px;border:1.5px solid var(--line);border-radius:12px;padding:0 12px}' +
    '.mine summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:700}' +
    '.mine ul{list-style:none;margin:0;padding:0 0 8px}.mine li{padding:6px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}.mine .ex{display:block}' +
    '.mine .card .tt{font-size:14px}' +
    '.lk{color:var(--act);text-decoration:underline}' +
    '.types{display:flex;gap:6px;margin:6px 0 14px;border:0;padding:0}' +
    '.ty{flex:1;position:relative}' +
    '.ty input{position:absolute;opacity:0;inset:0;width:100%;height:100%;margin:0;cursor:pointer}' +
    '.ty span{display:flex;align-items:center;justify-content:center;min-height:44px;border:1.5px solid var(--ib);border-radius:12px;font-weight:600}' +
    '.ty input:checked+span{background:var(--acs);border-color:var(--acs);color:#fff}' +
    '.ty input:focus-visible+span{outline:2px solid var(--ring);outline-offset:2px}' +
    'label{display:block;margin:12px 0 4px;font-weight:600}' +
    '.in{display:block;width:100%;padding:10px 12px;border:1.5px solid var(--ib);border-radius:12px;background:var(--bg);font-size:16px;line-height:1.4;resize:vertical}' +
    'textarea.in{field-sizing:content;min-height:calc(4lh + 23px);max-height:50vh}' +
    '.in[aria-invalid=true]{border-color:#c0392b}' +
    '.fe{margin:4px 0 0;color:#b3261e;font-size:13px;font-weight:500}.ab[data-dark] .fe{color:#ff9b8f}' +
    '.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}' +
    '.sim{margin-top:14px;padding:4px 12px;border-radius:12px;background:var(--card)}' +
    '.sm{flex:1;min-width:0}.sim h3{margin-top:10px}.sim .it:last-child{border:0}' +
    '.ctx{margin:14px 0 0;color:var(--mut);font-size:13px}' +
    '.dt .body{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}' +
    '.cm{margin:8px 0;padding:10px 12px;border-left:3px solid var(--acs);background:var(--card);border-radius:0 10px 10px 0}' +
    '.cm time{display:block;font-size:12px;color:var(--mut);margin-bottom:2px}.cm p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '.al{margin:0;padding-left:18px}.al,.sub,.meta,.ctx,.empty,.fe,.banner{overflow-wrap:anywhere}' +
    '.vbig{display:flex;align-items:center;gap:12px;margin:14px 0}' +
    '.vbig .vote{min-height:56px}' +
    '.thx{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:36px 8px}.thx p{margin:0;max-width:30ch;color:var(--mut);text-wrap:balance}.thx .ok{display:flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;background:var(--tint);color:var(--act)}.thx .ok svg{width:32px;height:32px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}' +
    '.panel[aria-busy=true]{align-items:center;justify-content:center}.panel[aria-busy=true]::after{content:"";width:28px;height:28px;border:3px solid var(--line);border-top-color:var(--act);border-radius:50%}' +
    '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
    '@media(prefers-reduced-motion:no-preference){' +
    '.panel[aria-busy=true]::after{animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}' +
    '.ov{animation:fade .18s ease-out}.panel{animation:slide .22s ease-out}' +
    '@keyframes fade{from{background-color:transparent}}@keyframes slide{from{transform:translateX(24px)}}' +
    '[data-pos=left] .panel{animation-name:slidel}@keyframes slidel{from{transform:translateX(-24px)}}}' +
    '@media(max-width:639px){.chips{flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;padding-bottom:4px;margin-right:-20px;padding-right:20px}.chip{flex:none;min-height:44px}.ov{background:var(--bg)}.panel{inset:0!important;width:auto;max-width:none;border-radius:0;box-shadow:none}' +
    '.hd{padding-top:calc(10px + env(safe-area-inset-top))}' +
    '@media(prefers-reduced-motion:no-preference){.panel,[data-pos=left] .panel{animation-name:up}@keyframes up{from{transform:translateY(24px)}}}}' +
    '.cr a{display:inline-block;padding:8px 6px}' +
    '.rpt{margin:6px 0 10px}.rp{min-height:44px;padding:0 4px;color:var(--mut);text-decoration:underline}' +
    '.rs{flex-direction:column;min-width:0}.rs .ty{flex:none}legend{padding:0;margin:0 0 6px;font-weight:600}' +
    '.pg .ov{background:var(--bg)}.pg .panel{inset:0!important;width:auto;max-width:none;border-radius:0;box-shadow:none}' +
    '.pg .hd,.pg .sc,.pg .ft{--pl:max(20px,env(safe-area-inset-left),calc((100% - 640px)/2));--pr:max(20px,env(safe-area-inset-right),calc((100% - 640px)/2));padding-left:var(--pl);padding-right:var(--pr)}' +
    '.pg .hd{padding-top:calc(10px + env(safe-area-inset-top));padding-right:calc(var(--pr) - 12px)}.pg .hd.bk{padding-left:calc(var(--pl) - 12px)}' +
    '@media print{.ov{display:none}}';

  var ICONS = {
    up: 'M6 14l6-6 6 6',
    x: 'M6 6l12 12M18 6L6 18',
    back: 'M15 6l-6 6 6 6',
    next: 'M9 6l6 6-6 6',
    ok: 'M5 12.5l4.5 4.5L19 7.5'
  };


  var SPECIAL = { '\u0142': 'l', '\u00f8': 'o', '\u0111': 'd', '\u00df': 'ss', '\u00e6': 'ae', '\u0153': 'oe', '\u0131': 'i', '\u00f0': 'd', '\u00fe': 'th' };
  var STOP = {};
  'a an the to of and or in on for is it my i we be can you please with this that me us'.split(' ').forEach(function (w) { STOP[w] = 1; });

  function fold(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u0142\u00f8\u0111\u00df\u00e6\u0153\u0131\u00f0\u00fe]/g, function (c) { return SPECIAL[c]; })
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  function tokens(s) {
    return fold(s).split(' ').filter(function (w) { return w.length > 1 && !STOP[w]; });
  }
  function wordScore(q, words) {
    var best = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var s = w === q ? 1 : (q.length >= 3 && w.length >= 3 && (w.indexOf(q) === 0 || q.indexOf(w) === 0)) ? 0.75 : 0;
      if (s > best) best = s;
    }
    return best;
  }
  function textScore(qt, tt) {
    if (!qt.length || !tt.length) return 0;
    var sum = 0;
    qt.forEach(function (q) { sum += wordScore(q, tt); });
    return 0.7 * sum / qt.length + 0.3 * sum / tt.length;
  }
  function fields(e) {
    if (!e.__f) {
      e.__f = [e.title].concat(e.aliases || [], [(e.tags || []).join(' '), String(e.body || '').slice(0, 160)]).map(tokens);
    }
    return e.__f;
  }
  function rank(query, entries, min) {
    var qt = tokens(query);
    if (!qt.length) return null;
    var out = [];
    entries.forEach(function (e) {
      var best = 0;
      fields(e).forEach(function (f) { best = Math.max(best, textScore(qt, f)); });
      if (best >= min) out.push({ e: e, s: best });
    });
    out.sort(function (a, b) { return b.s - a.s || b.e.votes - a.e.votes; });
    return out;
  }
  function similar(query, entries, max) {
    return (rank(query, entries, 0.5) || []).slice(0, max || 3).map(function (x) { return x.e; });
  }

  function byNew(a, b) { return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id; }
  function sortEntries(list, mode) {
    return list.slice().sort(function (a, b) { return mode === 'new' ? byNew(a, b) : (b.votes - a.votes) || byNew(a, b); });
  }
  function isClosed(e) { return e.status === 'done' || e.status === 'declined'; }
  function splitEntries(list) {
    return {
      open: list.filter(function (e) { return !isClosed(e); }),
      closed: list.filter(function (e) { return e.status === 'done'; }).concat(list.filter(function (e) { return e.status === 'declined'; }))
    };
  }
  function tabEntries(entries, tab) {
    return entries.filter(function (e) { return tab === 'bugs' ? e.type === 'bug' : e.type !== 'bug'; });
  }

  var PLURALS = {};
  function pluralCat(lang, n) {
    try { return (PLURALS[lang] || (PLURALS[lang] = new Intl.PluralRules(lang))).select(n); } catch (e) { return n === 1 ? 'one' : 'other'; }
  }
  function lookup(dict, key, tone, cat) {
    var tones = [tone, ''], cats = cat ? [cat, 'other', ''] : [''];
    for (var i = 0; i < 2; i++) {
      for (var j = 0; j < cats.length; j++) {
        var v = dict && dict[key + (tones[i] ? '.' + tones[i] : '') + (cats[j] ? '.' + cats[j] : '')];
        if (typeof v === 'string') return v;
      }
    }
    return undefined;
  }
  function format(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; });
  }
  function translate(dict, fallback, lang, tone, key, vars) {
    var cat = vars && vars.n != null ? pluralCat(lang, vars.n) : '';
    var s = lookup(dict, key, tone, cat);
    if (s === undefined) s = lookup(fallback, key, tone, cat);
    return format(s === undefined ? key : s, vars);
  }

  function parseUA(ua) {
    ua = ua || '';
    var b = '', o = '';
    if (/Edg(e|A|iOS)?\//.test(ua)) b = 'Edge';
    else if (/OPR\/|Opera/.test(ua)) b = 'Opera';
    else if (/SamsungBrowser/.test(ua)) b = 'Samsung Internet';
    else if (/Firefox\/|FxiOS/.test(ua)) b = 'Firefox';
    else if (/Chrome\/|CriOS/.test(ua)) b = 'Chrome';
    else if (/Safari\//.test(ua)) b = 'Safari';
    if (/iPhone|iPad|iPod/.test(ua)) o = 'iOS';
    else if (/Android/.test(ua)) o = 'Android';
    else if (/Windows/.test(ua)) o = 'Windows';
    else if (/Mac OS X|Macintosh/.test(ua)) o = 'macOS';
    else if (/CrOS/.test(ua)) o = 'ChromeOS';
    else if (/Linux|X11/.test(ua)) o = 'Linux';
    return { browser: b, os: o };
  }
  function fromBrands(uad) {
    var b = '', o = '';
    ((uad && uad.brands) || []).forEach(function (x) {
      var n = String(x.brand || '');
      if (b || /not.?a.?brand/i.test(n)) return;
      b = /edge/i.test(n) ? 'Edge' : /opera/i.test(n) ? 'Opera' : /chrom/i.test(n) ? (/google/i.test(n) ? 'Chrome' : '') : n.slice(0, 40);
    });
    if (!b && uad && uad.brands && uad.brands.some(function (x) { return /chromium/i.test(x.brand); })) b = 'Chrome';
    var p = String((uad && uad.platform) || '');
    o = /windows/i.test(p) ? 'Windows' : /mac/i.test(p) ? 'macOS' : /android/i.test(p) ? 'Android' : /chrome ?os/i.test(p) ? 'ChromeOS' : /linux/i.test(p) ? 'Linux' : /ios/i.test(p) ? 'iOS' : '';
    return { browser: b, os: o };
  }
  function screenClass(w) { return w < 640 ? 'small' : w < 1200 ? 'medium' : 'large'; }
  function buildContext(env) {
    var ua = parseUA(env.ua), ch = fromBrands(env.uaData);
    var os = ch.os || ua.os;
    if (os === 'macOS' && env.maxTouchPoints > 1) os = 'iOS';
    var lang = String(env.lang || '').replace(/_/g, '-').replace(/[^A-Za-z-]/g, '').slice(0, 12);
    return { page: String(env.pathname || '/').slice(0, 200), lang: lang, browser: ch.browser || ua.browser, os: os, screen: screenClass(env.width) };
  }

  var ERR_KEYS = {};
  ('bad_request invalid_input method_not_allowed not_found origin_not_allowed turnstile_failed turnstile_not_configured pass_invalid ' +
    'pass_expired rate_limited unauthorized conflict not_configured server_error network turnstile_unavailable title_short forbidden busy').split(' ')
    .forEach(function (c) { ERR_KEYS[c] = 'err.' + c; });
  function errorInfo(code, retryAfter, field) {
    if (code === 'rate_limited') return { key: 'err.rate_limited', vars: { n: Math.max(1, Math.ceil((+retryAfter || 60) / 60)) } };
    if (code === 'invalid_input' && /^(title|body|type)$/.test(field || '')) return { key: 'err.invalid_input.' + field };
    return { key: ERR_KEYS[code] || 'err.unknown' };
  }

  function fmtDate(iso, lang) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    try { return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(d); } catch (e) { return String(iso).slice(0, 10); }
  }
  // Owner-written text only (welcome, comments): split into text and http(s) links.
  // Trailing . , ! ? ; : quotes and unbalanced ) are not part of the URL. Never used for visitor text.
  function linkify(text) {
    text = String(text == null ? '' : text);
    var out = [], last = 0, m, re = /\bhttps?:\/\/[^\s<>"]+/gi;
    while ((m = re.exec(text))) {
      var u = m[0];
      for (;;) {
        var c = u.slice(-1);
        var open = u.split('(').length, shut = u.split(')').length;
        if (/[.,!?;:'"\]]/.test(c) || (c === ')' && shut > open)) u = u.slice(0, -1); else break;
      }
      if (!/^https?:\/\/[^\/?#]+/i.test(u)) continue;
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      out.push({ url: u, label: u.length > 48 ? u.slice(0, 30) + '\u2026' + u.slice(-15) : u });
      last = m.index + u.length;
      re.lastIndex = last;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }

  function countLinks(title, body) {
    // no lookbehind (old Safari would fail to parse the whole file): the char before a bare www. is part of the match
    var m = (String(title == null ? '' : title) + '\n' + String(body == null ? '' : body)).match(/https?:\/\/\S+|(?:^|[^A-Za-z0-9.-])www\.\S+/gi);
    return m ? m.length : 0;
  }
  // The page recorded with an entry. data-page (a fixed path) wins over everything; otherwise the host's
  // window.ArghBoxConfig.redactPage(path) may change it, or return '' for "no page at all". A hook that throws or
  // returns anything but a path fails closed: no page is recorded, the real one never leaks.
  function pagePath(fixed, real, conf) {
    if (fixed) return fixed;
    var p = real || '/', fn = conf && conf.redactPage;
    if (typeof fn === 'function') {
      try { p = fn(p); } catch (e) { p = ''; }
      if (typeof p !== 'string' || p.charAt(0) !== '/') p = '';
    }
    return p;
  }
  function appCtx(a) {
    var o = {};
    a = a || {};
    if (/^(ios|android|other)$/.test(a.platform)) o.platform = a.platform;
    if (typeof a.version === 'string' && /^[0-9A-Za-z._+-]{1,20}$/.test(a.version)) o.version = a.version;
    return o;
  }
  function contactUrl(u) { return typeof u === 'string' && /^(https?:\/\/|mailto:)[^\s<>"]+$/i.test(u) ? u : ''; }
  function dropHidden(entries, counts, ids) {
    var gone = {};
    var keep = ids.length ? entries.filter(function (e) {
      if (ids.indexOf(e.id) < 0) return true;
      (e.tags || []).forEach(function (g) { gone[g] = (gone[g] || 0) + 1; });
      return false;
    }) : entries;
    return { entries: keep, counts: counts.map(function (c) { return { tag: c.tag, count: c.count - (gone[c.tag] || 0) }; }).filter(function (c) { return c.count > 0; }) };
  }
  function clip(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '\u2026' : s;
  }
  function newVoterKey(cryptoObj, btoaFn) {
    var a = new Uint8Array(18);
    cryptoObj.getRandomValues(a);
    return btoaFn(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function toMs(v) {
    var n = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
    return isNaN(n) ? Date.now() + 25 * 60000 : n;
  }

  var helpers = {
    fold: fold, tokens: tokens, rank: rank, similar: similar, sortEntries: sortEntries, splitEntries: splitEntries,
    tabEntries: tabEntries, pluralCat: pluralCat, lookup: lookup, format: format, translate: translate, parseUA: parseUA,
    fromBrands: fromBrands, screenClass: screenClass, buildContext: buildContext, errorInfo: errorInfo, fmtDate: fmtDate,
    fetchBody: fetchBody, clip: clip, pagePath: pagePath, countLinks: countLinks, ratio: ratio, appCtx: appCtx, contactUrl: contactUrl, dropHidden: dropHidden, linkify: linkify, newVoterKey: newVoterKey, toMs: toMs, isClosed: isClosed
  };


  function h(tag, a, kids) {
    var el = document.createElement(tag);
    if (a) {
      Object.keys(a).forEach(function (k) {
        var v = a[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    (kids || []).forEach(function (c) {
      if (c != null && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  // DOM nodes for owner text: text nodes plus <a> elements, never innerHTML.
  function rich(text) {
    return linkify(text).map(function (p) {
      return p.url ? h('a', { class: 'lk', href: p.url, target: '_blank', rel: 'noopener nofollow ugc', title: p.label === p.url ? null : p.url, text: p.label }) : p.text;
    });
  }
  function ic(name) {
    var s = h('span', { class: 'ic', 'aria-hidden': 'true' });
    var NS = 'http://www.w3.org/2000/svg', g = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
    g.setAttribute('viewBox', '0 0 24 24');
    p.setAttribute('d', ICONS[name]);
    g.appendChild(p);
    s.appendChild(g);
    return s;
  }
  // the ArghBox mark for the credit
  function mark() {
    var NS = 'http://www.w3.org/2000/svg', g = document.createElementNS(NS, 'svg');
    g.setAttribute('viewBox', '0 0 16 16');
    g.setAttribute('class', 'mk');
    g.setAttribute('aria-hidden', 'true');
    g.appendChild(document.createElementNS(NS, 'path')).setAttribute('d', 'M0 1h16v4H0zM1 5h14v10H1zM1 2v2h14V2zM2 5v9h12V5zM3 7h2v1H3zM5 8h1v3H4V9h1zM11 7h2v1h-2zM10 8h1v1h1v2h-2zM6 12h4v1H6zM5 13h1v1H5zM10 13h1v1h-1z');
    return g;
  }
  // a key an input method is composing with (Safari: keyCode 229)
  function ime(ev) { return ev.isComposing || ev.keyCode === 229; }
  function deepActive() {
    var a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }
  function emit(name, detail) {
    try { window.dispatchEvent(new window.CustomEvent(name, { detail: detail || {} })); } catch (e) { }
  }
  function addSheet(root, css, nonce) {
    try {
      var sh = new window.CSSStyleSheet();
      sh.replaceSync(css);
      root.adoptedStyleSheets = (root.adoptedStyleSheets || []).concat(sh);
    } catch (e) {
      var st = document.createElement('style');
      if (nonce) st.setAttribute('nonce', nonce);
      st.textContent = css;
      root.appendChild(st);
    }
  }
  // fetch + body that gives up: a hung connection (even one that stalls while the body streams) must end in an
  // error the visitor can retry, never a spinner forever. Resolves {r, txt}.
  function fetchBody(url, init, ms) {
    var ctl = window.AbortController ? new window.AbortController() : null;
    if (ctl) init.signal = ctl.signal;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { if (ctl) ctl.abort(); reject(new Error('timeout')); }, ms);
      window.fetch(url, init).then(function (r) {
        return r.text().then(function (txt) { return { r: r, txt: txt }; });
      }).then(function (x) { clearTimeout(timer); resolve(x); }, function (e) { clearTimeout(timer); reject(e); });
    });
  }
  function getJSON(url) {
    return fetchBody(url, { credentials: 'omit' }, 15000).then(function (x) {
      if (!x.r.ok) throw new Error('http');
      return JSON.parse(x.txt);
    });
  }

  function applyTheme(wrap, mode) {
    function set(dark) { if (dark) wrap.setAttribute('data-dark', ''); else wrap.removeAttribute('data-dark'); }
    var html = document.documentElement;
    if (mode === 'dark' || mode === 'light') return set(mode === 'dark');
    if (mode === 'host') {
      var check = function () { set(html.classList.contains('dark') || html.getAttribute('data-theme') === 'dark'); };
      check();
      new window.MutationObserver(check).observe(html, { attributes: true, attributeFilter: ['class', 'data-theme'] });
      return;
    }
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    set(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', function (e) { set(e.matches); });
  }

  // Hosts set their own accent. Darken it until white text on it passes AA (buttons), and in dark mode
  // lighten the text accent until it passes on the dark card. Falls back to the CSS defaults on any doubt.
  function lum(c) {
    var f = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function fitAccent(wrap) {
    try {
      var p = document.createElement('i'), m;
      p.style.color = 'var(--ac)';
      wrap.appendChild(p);
      m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(window.getComputedStyle(p).color);
      wrap.removeChild(p);
      if (!m) return;
      var ac = [+m[1], +m[2], +m[3]], dark = wrap.hasAttribute('data-dark'), pct, c;
      var mix = function (to, k) { return ac.map(function (v, i) { return v * k + to[i] * (1 - k); }); };
      for (pct = 78; pct > 30; pct -= 6) if (ratio(mix([0, 0, 0], pct / 100), [255, 255, 255]) >= 4.7) break;
      wrap.style.setProperty('--acs', 'color-mix(in srgb,var(--ac) ' + pct + '%,#000)');
      if (dark) {
        for (pct = 62; pct > 10; pct -= 8) if (ratio(mix([255, 255, 255], pct / 100), [44, 33, 29]) >= 5) break;
        wrap.style.setProperty('--act', 'color-mix(in srgb,var(--ac) ' + pct + '%,#fff)');
      } else wrap.style.removeProperty('--act');
    } catch (e) { }
  }

  var mounted = null;


  function mount(shadow, cfg) {
    if (mounted && mounted.shadow === shadow) return mounted;
    var wrap = cfg.wrap || shadow;
    var A = (window.ArghBoxConfig || {}).app, pg = !!A && typeof A === 'object';
    if (pg && wrap.classList) wrap.classList.add('pg');
    addSheet(shadow, CSS, cfg.nonce);
    applyTheme(wrap, cfg.theme);

    var S = {
      isOpen: false, view: 'list', prev: 'list', tab: 'ideas', sort: 'top', q: '', tag: '', closedOpen: null,
      entries: [], idx: new Map(), tagCounts: [], voted: {}, busy: {}, site: {}, listState: 'loading', listAt: 0, key: '',
      moderation: 'pending', maxLinks: 2, credit: true, welcome: '', mine: [], draft: { type: 'idea', title: '', body: '' },
      strings: null, en: null, pass: null, passExp: 0, passP: null, refs: {}, scroll: 0, detailId: 0
    };
    var tone = cfg.tone === 'neutral' ? 'neutral' : 'funny';
    var stringsP = null, listP = null, tsP = null, tsBox = null, tsWid = null, tsPending = null;

    function t(key, vars) { return translate(S.strings, S.en, cfg.lang, tone, key, vars); }
    function siteName() { return S.site.name || window.location.hostname; }
    function emitType(name, type) { emit(name, type ? { type: type } : {}); }

    function store(k, v) {
      try {
        if (v === undefined) return window.localStorage.getItem(k);
        window.localStorage.setItem(k, v);
      } catch (e) { }
      return null;
    }
    function voter() {
      if (S.voter) return S.voter;
      var k = store('arghbox:voter');
      if (!k || !/^[A-Za-z0-9_-]{22,64}$/.test(k)) {
        k = newVoterKey(window.crypto, function (s) { return window.btoa(s); });
        store('arghbox:voter', k);
      }
      S.voter = k;
      return k;
    }
    function receipts() {
      if (!S.receipts) {
        try { S.receipts = JSON.parse(store('arghbox:receipts') || '[]'); } catch (e) { S.receipts = []; }
        if (!Array.isArray(S.receipts)) S.receipts = [];
      }
      return S.receipts;
    }
    function addReceipt(r) {
      var a = receipts();
      a.push(r);
      S.receipts = a.slice(-50);
      store('arghbox:receipts', JSON.stringify(S.receipts));
    }

    // not the loader's `arghbox:hidden` (the tab's dismissal time)
    function hiddenIds() {
      var a;
      try { a = JSON.parse(store('arghbox:reported') || '[]'); } catch (e) { }
      return Array.isArray(a) ? a.filter(function (n) { return n > 0; }).slice(-200) : [];
    }

    function call(action, o) {
      o = o || {};
      if (S.dev) return S.dev(action, o.body || {});
      var headers = {};
      var init = { method: o.body ? 'POST' : 'GET', headers: headers, credentials: 'omit' };
      if (o.voter) headers['X-ArghBox-Voter'] = voter();
      if (o.body) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(o.body); }
      var url = cfg.api + (cfg.api.indexOf('?') < 0 ? '?' : '&') + 'action=' + action;
      return fetchBody(url, init, o.body ? 25000 : 15000).then(function (x) {
        var r = x.r, j = null;
        try { j = JSON.parse(x.txt); } catch (e) { }
        if (!j) throw { code: 'server_error', raw: 1 }; // not JSON: no ArghBox answered
        if (j.ok === false || !r.ok) throw { code: j.error || 'server_error', field: j.field, retry_after: j.retry_after || +r.headers.get('Retry-After') || 0 };
        return j;
      }, function () { throw { code: 'network' }; }).catch(function (e) {
        // "busy" means the server did not touch anything: wait as told (at most 10 s) and try once more
        if (!e || e.code !== 'busy' || o.again) throw e;
        return new Promise(function (go) { setTimeout(go, Math.min(10, Math.max(1, e.retry_after || 2)) * 1000); }).then(function () {
          return call(action, { body: o.body, voter: o.voter, again: 1 });
        });
      });
    }

    function loadStrings() {
      if (stringsP) return stringsP;
      var u = function (l) { return cfg.base + 'i18n/' + l + '.json?v=' + cfg.ver; };
      var en = getJSON(u('en')).catch(function () { return null; });
      var own = cfg.lang === 'en' ? en : getJSON(u(cfg.lang)).catch(function () { return null; });
      stringsP = Promise.all([own, en]).then(function (r) {
        S.strings = r[0] || r[1];
        S.en = r[1] || {};
        if (!S.strings) stringsP = null;
        return !!S.strings;
      });
      return stringsP;
    }

    // Local preview (SPEC 8): on localhost with no ArghBox answering, sample entries from arghbox-preview.js
    function preview(e) {
      if (S.dev || (window.ArghBoxConfig || {}).localPreview === false || !(e.code === 'network' || e.code === 'not_configured' || e.raw) ||
        !/^(localhost|127.0.0.1|[::1])$|.localhost$/.test(window.location.hostname)) return Promise.reject(e);
      return new Promise(function (ok, no) {
        var s = document.createElement('script');
        if (cfg.nonce) s.nonce = cfg.nonce;
        s.src = cfg.su(cfg.base + 'arghbox-preview.js?v=' + cfg.ver);
        s.onload = s.onerror = function () {
          s.remove();
          S.dev = window.__arghboxPreview && window.__arghboxPreview(cfg.api, e.code);
          if (S.dev) ok(); else no(e);
        };
        document.head.appendChild(s);
      });
    }
    function loadList() {
      if (!listP) {
        var get = function () { return call('list', { voter: true }); };
        listP = get().catch(function (e) { return preview(e).then(get); }).then(function (r) {
          var vis = dropHidden(r.entries || [], r.tag_counts || [], hiddenIds());
          setEntries(vis.entries);
          S.tagCounts = vis.counts;
          S.contact = contactUrl(r.contact);
          S.appPass = (pg || !!S.dev) && r.app_pass === true;
          S.voted = {};
          (r.voted || []).forEach(function (id) { S.voted[id] = 1; });
          S.site = r.site || {};
          S.welcome = r.welcome || '';
          S.key = r.turnstile_site_key || '';
          S.moderation = r.moderation;
          S.maxLinks = r.max_links > 0 ? +r.max_links : 2;
          S.credit = r.credit !== false;
          S.listState = 'ok';
          S.listAt = Date.now();
          if (S.key && !S.appPass && S.isOpen) tsLoad().catch(function () { });
          return loadMine();
        }).catch(function (e) {
          S.listState = S.entries.length ? 'ok' : 'error';
          S.listErr = e;
        }).then(function () {
          listP = null;
          if (S.isOpen) refresh();
        });
      }
      return listP;
    }

    function loadMine() {
      var r = receipts();
      if (!r.length) return Promise.resolve();
      return call('mine', { body: { receipts: r } }).then(function (res) {
        S.mine = (res.entries || []).sort(function (a, b) { return r.indexOf(b.receipt) - r.indexOf(a.receipt); });
      }).catch(function () { });
    }

    function tsLoad() {
      if (tsP) return tsP;
      tsP = new Promise(function (resolve, reject) {
        if (window.turnstile) return resolve(window.turnstile);
        var s = document.createElement('script');
        if (cfg.nonce) s.nonce = cfg.nonce;
        s.src = cfg.su('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
        s.async = true;
        s.onload = function () { window.turnstile ? resolve(window.turnstile) : reject(new Error('ts')); };
        s.onerror = function () { reject(new Error('ts')); };
        setTimeout(function () { reject(new Error('ts')); }, 15000);
        document.head.appendChild(s);
      });
      tsP.catch(function () { tsP = null; });
      return tsP;
    }
    function tsShow(on) {
      if (!tsBox) return;
      if (on && !S.isOpen) on = false; // a late challenge must never pop up over the host page after the dialog closed
      var small = pg || window.innerWidth < 640, side = cfg.position === 'left' ? 'left' : 'right';
      tsBox.style.display = on ? 'block' : 'none';
      if (on) {
        tsBox.style.left = tsBox.style.right = 'auto';
        if (small) { tsBox.style.left = '50%'; tsBox.style.transform = 'translateX(-50%)'; } else { tsBox.style[side] = '24px'; tsBox.style.transform = 'none'; }
      }
    }
    // Settles the CURRENT pending challenge (callbacks of an older render still land here) and stops its timer.
    function tsSettle(tok, err) {
      var p = tsPending;
      tsShow(false);
      if (!p) return;
      tsPending = null;
      clearTimeout(p.timer);
      if (err) p.reject(err); else p.resolve(tok);
    }
    function tsCancel() {
      var had = !!tsPending;
      tsSettle(null, { code: 'cancelled' });
      try { if (had && tsWid != null && window.turnstile) window.turnstile.reset(tsWid); } catch (e) { }
    }
    function tsToken() {
      return tsLoad().catch(function () { throw { code: 'turnstile_unavailable' }; }).then(function (ts) {
        return new Promise(function (resolve, reject) {
          if (tsPending) tsSettle(null, { code: 'cancelled' });
          if (tsBox && !tsBox.isConnected) { // the host swapped its <body>: the old box and widget are gone
            try { if (tsWid != null) ts.remove(tsWid); } catch (e) { }
            tsBox = null;
            tsWid = null;
          }
          if (!tsBox) {
            tsBox = document.createElement('div');
            tsBox.id = 'arghbox-turnstile';
            tsBox.style.cssText = 'position:fixed;bottom:92px;width:300px;height:65px;display:none;z-index:' + (cfg.z + 2);
            document.body.appendChild(tsBox);
          }
          tsPending = { resolve: resolve, reject: reject, timer: setTimeout(function () { tsSettle(null, { code: 'turnstile_failed' }); }, 120000) };
          if (tsWid == null) {
            tsWid = ts.render(tsBox, {
              sitekey: S.key, action: 'arghbox', appearance: 'interaction-only', execution: 'execute',
              theme: wrap.hasAttribute && wrap.hasAttribute('data-dark') ? 'dark' : 'light',
              callback: function (tok) { tsSettle(tok); },
              'error-callback': function () { tsSettle(null, { code: 'turnstile_failed' }); },
              'timeout-callback': function () { tsSettle(null, { code: 'turnstile_failed' }); },
              'before-interactive-callback': function () { tsShow(true); },
              'after-interactive-callback': function () { tsShow(false); }
            });
          } else {
            ts.reset(tsWid);
          }
          ts.execute(tsWid);
        });
      });
    }
    function ensurePass() {
      if (S.pass && S.passExp - 30000 > Date.now()) return Promise.resolve(S.pass);
      if (S.passP) return S.passP;
      if (!S.key && !S.appPass) return Promise.reject({ code: S.listState === 'ok' ? 'turnstile_not_configured' : 'network' });
      S.passP = (S.appPass ? Promise.resolve() : tsToken()).then(function (tok) {
        return call('session', { body: S.appPass ? { app: true } : { turnstile: tok } });
      }).then(function (r) {
        S.pass = r.pass;
        S.passExp = r.expires_in > 0 ? Date.now() + r.expires_in * 1000 : toMs(r.expires_at);
        S.passP = null;
        return S.pass;
      }, function (e) {
        S.passP = null;
        throw e;
      });
      return S.passP;
    }
    function withPass(fn) {
      return ensurePass().then(fn).catch(function (e) {
        if (e && (e.code === 'pass_invalid' || e.code === 'pass_expired')) {
          S.pass = null;
          return ensurePass().then(fn);
        }
        throw e;
      });
    }

    // Two persistent live regions (a region that is inserted together with its text is often not announced):
    // polite status for successes, assertive alert for errors. Cleared first so a repeated text is read again.
    function speak(region, msg) {
      if (!S[region]) return;
      S[region].textContent = '';
      if (msg) setTimeout(function () { if (S[region]) S[region].textContent = msg; }, 40);
    }
    function say(msg) { speak('live', msg); }
    function banner(msg) {
      if (!S.banner) return;
      S.banner.textContent = msg || '';
      S.banner.hidden = !msg;
      speak('alert', msg);
    }
    function fail(err, field) {
      var info = errorInfo(err && err.code, err && err.retry_after, field);
      banner(t(info.key, info.vars));
    }

    function closeBtn() {
      return h('button', { type: 'button', class: 'ib', 'aria-label': t('dialog.close'), onclick: close }, [ic('x')]);
    }
    function header(title, sub, back) {
      return h('div', { class: 'hd' + (back ? ' bk' : '') }, [
        back ? h('button', { type: 'button', class: 'ib', onclick: back }, [ic('back'), t('nav.back')]) : null,
        h('div', { class: 'hdt' }, [h('h2', { id: 'ab-title', tabindex: '-1', dir: 'auto', text: title }), sub ? h('p', { class: 'sub', text: sub }) : null]),
        closeBtn()
      ]);
    }
    function credit() {
      var a = [];
      if (S.contact) a.push(h('a', { href: S.contact, target: '_blank', rel: 'noopener', text: t('contact') }));
      if (S.credit && cfg.credit !== false) a.push(h('a', { href: 'https://arghbox.com/', target: '_blank', rel: 'noopener' }, [mark(), t('credit')]));
      if (a.length > 1) a.splice(1, 0, ' \u00b7 ');
      return a.length ? h('div', { class: 'cr' }, a) : null;
    }
    function badge(cls, text) { return h('span', { class: 'bd ' + cls, text: text }); }
    function badges(e) {
      return [
        e.type === 'question' ? badge('question', t('badge.question')) : null,
        e.source === 'owner' ? badge('team', t('badge.team')) : null,
        e.status && e.status !== 'open' ? badge(e.status, t('status.' + e.status)) : null
      ];
    }
    function byId(id) { return S.idx.get(id) || null; }
    function setEntries(list) {
      S.entries = list;
      S.idx = new Map();
      list.forEach(function (e) { S.idx.set(e.id, e); });
    }

    function voteBtn(e) {
      var b = h('button', { type: 'button', class: 'vote', 'data-id': e.id, onclick: function () { vote(e.id); } }, [ic('up'), h('b', { class: 'n' }), ' ', h('i', { class: 'vl' })]);
      paintVote(b, e);
      return b;
    }
    function paintVote(b, e) {
      var on = !!S.voted[e.id];
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', t('vote.name', { label: t(on ? 'vote.upped' : 'vote.up'), title: e.title, n: e.votes }));
      b.setAttribute('title', t('votes', { n: e.votes }));
      b.setAttribute('aria-busy', S.busy[e.id] ? 'true' : 'false');
      b.classList.toggle('on', on);
      b.querySelector('.n').textContent = e.votes;
      b.querySelector('.vl').textContent = t(on ? 'vote.upped' : 'vote.up');
    }
    function paintVotes() {
      if (!S.panel) return;
      Array.prototype.forEach.call(S.panel.querySelectorAll('.vote'), function (b) {
        var e = byId(+b.getAttribute('data-id'));
        if (e) paintVote(b, e);
      });
    }
    function setVoted(e, on) {
      if (!!S.voted[e.id] === on) return;
      S.voted[e.id] = on ? 1 : 0;
      e.votes += on ? 1 : -1;
    }
    function vote(id) {
      var e = byId(id);
      if (!e || S.busy[id]) return;
      var on = !S.voted[id];
      banner('');
      S.busy[id] = 1;
      setVoted(e, on);
      paintVotes();
      withPass(function (pass) {
        return call('vote', { body: { pass: pass, voter: voter(), id: id, on: on } });
      }).then(function (r) {
        var target = r.id !== id ? byId(r.id) : e;
        if (target !== e) setVoted(e, !on);
        if (target) {
          target.votes = r.votes;
          S.voted[target.id] = r.voted ? 1 : 0;
        }
        say(t(r.voted ? 'vote.on' : 'vote.off', { votes: t('votes', { n: r.votes }) }));
        emit('arghbox:vote', { on: !!r.voted });
      }).catch(function (err) {
        setVoted(e, !on);
        fail(err);
      }).then(function () {
        delete S.busy[id];
        paintVotes();
      });
    }

    function card(e, extra) {
      if (!extra && e.__li) {
        paintVote(e.__li.firstChild, e); // the count may have changed while the card was off screen
        return e.__li;
      }
      var meta = [];
      meta.push.apply(meta, badges(e));
      (e.tags || []).forEach(function (g) { meta.push(h('span', { class: 'tg', text: '#' + g })); });
      if (e.similar > 0) meta.push(h('span', { title: (e.aliases || []).join(' | '), text: t('card.similar', { n: e.similar }) }));
      if (e.comments && e.comments.length) meta.push(h('span', { text: t('card.comments', { n: e.comments.length }) }));
      var li = h('li', { class: 'it', 'data-id': e.id }, [
        voteBtn(e),
        h('button', { type: 'button', class: 'card', 'data-open': e.id, onclick: function () { showDetail(e.id); } }, [
          h('span', { class: 'tt', dir: 'auto', text: e.title }),
          e.body ? h('span', { class: 'ex', dir: 'auto', text: clip(e.body, 160) }) : null,
          meta.length ? h('span', { class: 'meta' }, meta) : null
        ].concat(extra || []))
      ]);
      if (!extra) e.__li = li;
      return li;
    }

    function paintList() {
      var R = S.refs;
      if (S.view !== 'list' || !R.box) return;
      var box = R.box;
      box.textContent = '';
      if (S.listState === 'loading') { box.appendChild(h('p', { class: 'empty', text: t('list.loading') })); return; }
      if (S.listState === 'error') {
        var info = errorInfo(S.listErr && S.listErr.code, S.listErr && S.listErr.retry_after);
        box.appendChild(h('div', { class: 'empty' }, [
          h('p', { text: t(info.key, info.vars) }),
          h('button', { type: 'button', class: 'sec', onclick: function () { S.listState = 'loading'; paintList(); loadList(); }, text: t('list.retry') })
        ]));
        return;
      }
      var list = tabEntries(S.entries, S.tab);
      if (S.tag) list = list.filter(function (e) { return (e.tags || []).indexOf(S.tag) >= 0; });
      var ranked = S.q ? rank(S.q, list, 0.4) : null;
      list = ranked ? ranked.map(function (x) { return x.e; }) : sortEntries(list, S.sort);
      var sp = splitEntries(list);
      if (!list.length) {
        var none = S.q || S.tag ? t('list.noresults') : S.tab === 'bugs' ? t('list.empty.bugs') : t('list.empty');
        box.appendChild(h('div', { class: 'empty' }, [h('p', { text: none }), S.q ? h('button', { type: 'button', class: 'lk', text: t('list.noresults.add'), onclick: function () {
          S.draft.title = S.q;
          setView('add');
        } }) : null]));
        return;
      }
      if (sp.open.length) {
        box.appendChild(h('h3', { text: t('list.open') }));
        box.appendChild(h('ul', { class: 'items' }, sp.open.map(function (e) { return card(e); })));
      }
      if (sp.closed.length) {
        var openC = S.closedOpen === null ? !!(S.q || S.tag) : S.closedOpen;
        var ul = h('ul', { class: 'items', id: 'ab-closed', hidden: !openC }, sp.closed.map(function (e) { return card(e); }));
        box.appendChild(h('button', {
          type: 'button', class: 'ch', 'aria-expanded': openC ? 'true' : 'false', 'aria-controls': 'ab-closed',
          onclick: function () { S.closedOpen = !openC; paintList(); R.box.querySelector('.ch').focus(); }
        }, [ic('next'), t('list.closed', { n: sp.closed.length })]));
        box.appendChild(ul);
      }
    }

    function paintChips() {
      var R = S.refs;
      R.chips.textContent = '';
      R.chipBtns = S.tagCounts.slice(0, 14).map(function (g) {
        var b = h('button', { type: 'button', class: 'chip', 'data-tag': g.tag, onclick: function () { S.tag = S.tag === g.tag ? '' : g.tag; paintControls(); paintList(); } }, ['#' + g.tag + ' ' + g.count]);
        R.chips.appendChild(b);
        return b;
      });
      R.chips.hidden = !R.chipBtns.length;
      R.wel.textContent = '';
      rich(S.welcome).forEach(function (n) { R.wel.appendChild(typeof n === 'string' ? document.createTextNode(n) : n); });
      R.wel.hidden = !S.welcome;
      paintControls();
    }
    function paintControls() {
      var R = S.refs;
      ['ideas', 'bugs'].forEach(function (k) {
        var b = R.tabs[k];
        b.setAttribute('aria-selected', S.tab === k ? 'true' : 'false');
        b.tabIndex = S.tab === k ? 0 : -1;
      });
      R.sortBtns.forEach(function (b) { b.setAttribute('aria-pressed', S.sort === b.getAttribute('data-sort') ? 'true' : 'false'); });
      R.chipBtns.forEach(function (b) { b.setAttribute('aria-pressed', S.tag === b.getAttribute('data-tag') ? 'true' : 'false'); });
    }

    function paintMine() {
      var R = S.refs;
      if (S.view !== 'list' || !R.mine) return;
      var m = R.mine;
      m.textContent = '';
      m.hidden = !S.mine.length;
      if (!S.mine.length) return;
      var ul = h('ul');
      S.mine.forEach(function (e) {
        var state = e.state, line = [], title;
        var target = e.merged_into ? byId(e.merged_into) : null;
        if (state === 'published') {
          title = h('button', { type: 'button', class: 'lk', dir: 'auto', onclick: function () { showDetail(e.id); }, text: e.title });
          if (!byId(e.id)) title = h('span', { dir: 'auto', text: e.title });
          line.push(t('mine.published'));
        } else if (state === 'merged') {
          title = h('span', { dir: 'auto', text: e.title });
          var mt = e.merged_into_title || (target && target.title) || '';
          var txt = t('mine.merged', { id: e.merged_into, title: '\u2068' + mt + '\u2069' });
          line.push(target ? h('button', { type: 'button', class: 'lk', onclick: function () { showDetail(target.id); }, text: txt }) : txt);
        } else if (state === 'rejected') {
          title = h('span', { dir: 'auto', text: e.title });
          var rs = /^(spam|abuse|off_topic|test|unclear)$/.test(e.reject_reason || '') ? t('reason.' + e.reject_reason) : '';
          line.push(rs ? t('mine.rejected.reason', { reason: rs }) : t('mine.rejected'));
        } else {
          title = h('span', { dir: 'auto', text: e.title });
          line.push(t('mine.pending'));
        }
        var cm = e.comments && e.comments.length ? e.comments[e.comments.length - 1].body : '';
        ul.appendChild(h('li', null, [
          h('div', null, [title]),
          h('div', { class: 'meta' }, [e.status && e.status !== 'open' ? badge(e.status, t('status.' + e.status)) : null].concat(line)),
          cm ? h('div', { class: 'ex', dir: 'auto' }, [t('mine.comment', { text: '' })].concat(rich(cm))) : null
        ]));
      });
      m.appendChild(h('summary', { text: t('mine.title') + ' (' + S.mine.length + ')' }));
      m.appendChild(ul);
      if (!S.mineInit) {
        S.mineInit = 1;
        if (S.mine.length <= 3) m.setAttribute('open', '');
      }
    }

    function viewList() {
      var R = S.refs = {};
      R.tabs = {};
      var tabsEl = h('div', { class: 'tabs', role: 'tablist', 'aria-label': t('list.show'), onkeydown: function (ev) {
        var i = ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(ev.key);
        if (i < 0) return;
        ev.preventDefault();
        S.tab = ev.key === 'ArrowLeft' || ev.key === 'Home' ? 'ideas' : 'bugs';
        paintControls(); paintList();
        R.tabs[S.tab].focus();
      } });
      ['ideas', 'bugs'].forEach(function (k) {
        R.tabs[k] = h('button', { type: 'button', role: 'tab', id: 'tab-' + k, 'aria-controls': 'ab-panel', text: t('tab.' + k), onclick: function () { S.tab = k; paintControls(); paintList(); } });
        tabsEl.appendChild(R.tabs[k]);
      });
      R.sortBtns = ['top', 'new'].map(function (k) {
        return h('button', { type: 'button', 'data-sort': k, text: t('sort.' + k), onclick: function () { S.sort = k; paintControls(); paintList(); } });
      });
      var q = h('input', { type: 'search', class: 'q', 'aria-label': t('search.label'), placeholder: t('search.placeholder'), autocomplete: 'off', value: S.q, oninput: function () { S.q = q.value; clearTimeout(S.qt); S.qt = setTimeout(paintList, 120); } });
      R.chips = h('div', { class: 'chips', role: 'group', 'aria-label': t('tags.label') });
      R.wel = h('p', { class: 'wel' });
      R.mine = h('details', { class: 'mine', hidden: true });
      R.q = q;
      R.box = h('div', { id: 'ab-panel', role: 'tabpanel' });
      R.sc = h('div', { class: 'sc' }, [
        S.note ? h('p', { class: 'sim', text: S.note }) : null,
        R.wel,
        R.mine,
        h('div', { class: 'row' }, [tabsEl, h('div', { class: 'srt', role: 'group', 'aria-label': t('sort.label') }, R.sortBtns)]),
        q,
        R.chips,
        R.box
      ]);
      paintChips(); paintMine(); paintList();
      return {
        hd: header(t('dialog.title'), t('dialog.subtitle', { site: siteName() })),
        vw: h('div', { class: 'vw' }, [R.sc, h('div', { class: 'ft' }, [
          h('button', { type: 'button', class: 'pri', onclick: function () { setView('add'); }, text: t('list.add') }),
          credit()
        ])]),
        focus: null
      };
    }

    function showDetail(id) {
      if (!byId(id)) return;
      if (S.view === 'list' && S.refs.sc) S.scroll = S.refs.sc.scrollTop;
      S.prev = S.view === 'detail' ? S.prev : S.view;
      S.detailId = id;
      setView('detail');
    }
    function viewDetail() {
      var e = byId(S.detailId);
      var back = function () { setView(S.prev || 'list'); };
      if (!e) return { hd: header('', '', back), vw: h('div', { class: 'vw' }) };
      var since = e.status && e.status !== 'open' && e.status_at
        ? t('detail.status', { status: t('status.' + e.status), date: fmtDate(e.status_at, cfg.lang) })
        : t('detail.asked', { date: fmtDate(e.created_at, cfg.lang) });
      var sc = h('div', { class: 'sc dt' }, [
        h('div', { class: 'meta' }, badges(e).concat([since])),
        e.body ? h('p', { class: 'body', dir: 'auto', text: e.body }) : null,
        (e.tags || []).length ? h('div', { class: 'meta' }, e.tags.map(function (g) { return h('span', { class: 'tg', text: '#' + g }); })) : null,
        h('div', { class: 'vbig' }, [voteBtn(e), h('span', { text: t('votes', { n: e.votes }) })]),
        e.source === 'visitor' ? reportBox(e) : null,
        (e.aliases || []).length ? h('div', null, [h('h3', { text: t('detail.also') }), h('ul', { class: 'al' }, e.aliases.map(function (a) { return h('li', { dir: 'auto', text: a }); }))]) : null,
        (e.comments || []).length ? h('div', null, [h('h3', { text: t('detail.comments', { site: siteName() }) })].concat(e.comments.map(function (c) {
          return h('div', { class: 'cm' }, [h('time', { datetime: c.at, text: fmtDate(c.at, cfg.lang) }), h('p', { dir: 'auto' }, rich(c.body))]);
        }))) : null
      ]);
      return { hd: header(e.title, '', back), vw: h('div', { class: 'vw' }, [sc, h('div', { class: 'ft' }, [credit()])]) };
    }

    function reportBox(e) {
      var box = h('div', { class: 'rpt' });
      function button() {
        box.textContent = '';
        box.appendChild(h('button', { type: 'button', class: 'rp', text: t('report.button'), onclick: form }));
      }
      function form() {
        var sel = '', send, radios;
        banner('');
        radios = ['spam', 'abusive', 'off_topic', 'other'].map(function (k) {
          var i = h('input', { type: 'radio', name: 'ab-reason', value: k, onchange: function () { sel = k; banner(''); } });
          return h('label', { class: 'ty' }, [i, h('span', { text: t('report.' + k) })]);
        });
        send = h('button', { type: 'button', class: 'pri', text: t('report.send'), onclick: function () {
          if (!sel) { banner(t('report.pick')); radios[0].firstChild.focus(); return; }
          banner('');
          send.disabled = true;
          send.textContent = t('add.sending');
          withPass(function (pass) {
            return call('report', { body: { pass: pass, voter: voter(), id: e.id, reason: sel } });
          }).then(function () {
            var ids = hiddenIds();
            ids.push(e.id);
            store('arghbox:reported', JSON.stringify(ids.slice(-200)));
            var vis = dropHidden(S.entries, S.tagCounts, [e.id]);
            setEntries(vis.entries);
            S.tagCounts = vis.counts;
            if (!S.isOpen) return;
            S.note = t('report.done');
            setView('list');
            say(S.note);
          }).catch(function (err) {
            send.disabled = false;
            send.textContent = t('report.send');
            fail(err);
          });
        } });
        box.textContent = '';
        box.appendChild(h('fieldset', { class: 'types rs' }, [h('legend', { text: t('report.legend') })].concat(radios)));
        box.appendChild(h('div', { class: 'row' }, [send, h('button', { type: 'button', class: 'sec', text: t('report.cancel'), onclick: function () {
          banner('');
          button();
          box.firstChild.focus();
        } })]));
        radios[0].firstChild.focus();
        send.scrollIntoView({ block: 'nearest' }); // the Send button must not sit under the sticky footer
      }
      button();
      return box;
    }

    function currentContext() {
      var page = pagePath(cfg.page, window.location.pathname, window.ArghBoxConfig);
      var ctx = buildContext({
        pathname: page || '/', lang: document.documentElement.lang || window.navigator.language,
        ua: window.navigator.userAgent, uaData: window.navigator.userAgentData, maxTouchPoints: window.navigator.maxTouchPoints,
        width: window.innerWidth
      });
      if (!page) delete ctx.page; // nothing to record: the key is not sent at all
      var ap = pg ? appCtx(A) : {};
      if (Object.keys(ap).length) ctx.app = ap;
      return ctx;
    }
    function viewAdd() {
      var d = S.draft, ctx = currentContext(), t0 = Date.now(), F = {};
      var back = function () { setView('list'); };
      var types = h('div', { class: 'types', role: 'radiogroup', 'aria-label': t('add.type') });
      ['idea', 'bug', 'question'].forEach(function (k) {
        var inp = h('input', { type: 'radio', name: 'type', value: k, onchange: function () { d.type = k; paintType(); } });
        inp.checked = d.type === k;
        types.appendChild(h('label', { class: 'ty' }, [inp, h('span', { text: t('type.' + k) })]));
      });
      F.title = h('input', { type: 'text', class: 'in', id: 'f-title', dir: 'auto', maxlength: '120', autocomplete: 'off', 'aria-required': 'true', value: d.title });
      F.body = h('textarea', { class: 'in', id: 'f-body', dir: 'auto', maxlength: '2000', rows: '4' });
      F.body.value = d.body;
      F.hp = h('input', { type: 'text', name: 'ab-q7', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
      F.et = h('p', { class: 'fe', id: 'e-title', hidden: true });
      F.eb = h('p', { class: 'fe', id: 'e-body', hidden: true });
      F.sim = h('div', { class: 'sim', hidden: true });
      F.ctx = h('p', { class: 'ctx' });
      F.submit = h('button', { type: 'submit', class: 'pri', text: t('add.submit') });

      function fe(name, msg) {
        var inp = F[name], p = name === 'title' ? F.et : F.eb;
        p.textContent = msg || '';
        p.hidden = !msg;
        if (msg) speak('alert', msg);
        inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
        if (msg) inp.setAttribute('aria-describedby', p.id); else inp.removeAttribute('aria-describedby');
      }
      function paintType() {
        F.title.setAttribute('placeholder', t('add.ph.' + d.type));
        F.ctx.textContent = t(d.type === 'bug' ? 'add.context.bug' : 'add.context', {
          page: ctx.page || t('ctx.nopage'), lang: ctx.lang || t('ctx.unknown'), browser: ctx.browser || t('ctx.unknown'), os: ctx.os || t('ctx.unknown'), screen: t('screen.' + ctx.screen)
        });
        paintSim();
      }
      function simItem(e) {
        var closed = isClosed(e), last = e.comments && e.comments.length ? e.comments[e.comments.length - 1].body : '';
        var open = h('button', { type: 'button', class: 'card', onclick: function () { showDetail(e.id); } }, [h('span', { class: 'tt', dir: 'auto', text: e.title })]);
        // the excerpt is owner text with links, so it sits outside the button
        var ex = closed ? h('div', { class: 'ex' }, last ? [t('similar.closed', { status: t('status.' + e.status), text: '' })].concat(rich(last)) : [t('status.' + e.status)]) : null;
        return h('li', { class: 'it' }, [closed ? null : voteBtn(e), h('div', { class: 'sm' }, [open, ex])]);
      }
      function paintSim() {
        var list = F.title.value.trim().length >= 3 ? similar(F.title.value, S.entries, 3) : [];
        var key = list.map(function (e) { return e.id; }).join();
        if (key === F.simKey) return;
        F.simKey = key;
        F.sim.textContent = '';
        F.sim.hidden = !list.length;
        if (!list.length) return;
        F.sim.appendChild(h('h3', { text: t('add.similar') }));
        F.sim.appendChild(h('ul', { class: 'items' }, list.map(simItem)));
        say(t('add.similar.n', { n: list.length }));
      }
      var timer;
      F.title.addEventListener('input', function () { d.title = F.title.value; fe('title', ''); clearTimeout(timer); timer = setTimeout(paintSim, 150); });
      F.body.addEventListener('input', function () { d.body = F.body.value; fe('body', ''); });
      paintType();

      // Enter in the title goes on to the details; Ctrl/Cmd+Enter sends
      var form = h('form', { class: 'vw', novalidate: true, onkeydown: function (ev) {
        if (ev.key !== 'Enter' || ime(ev)) return;
        if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); F.submit.click(); } else if (ev.target === F.title) { ev.preventDefault(); F.body.focus(); }
      }, onsubmit: function (ev) {
        ev.preventDefault();
        banner('');
        var title = F.title.value.replace(/\s+/g, ' ').trim();
        if (title.length < 4) { fe('title', t('err.title_short')); F.title.focus(); return; }
        if (countLinks(title, F.body.value) > S.maxLinks) { fe('title', t('err.links', { n: S.maxLinks })); F.title.focus(); return; }
        F.submit.disabled = true;
        F.submit.textContent = t('add.sending');
        var type = d.type;
        // The server drops forms filled in under ~2.5 s as robots (silently). A fast human gets a short wait, not a lost report.
        var pause = new Promise(function (go) { setTimeout(go, Math.max(0, 2700 - (Date.now() - t0))); });
        withPass(function (pass) {
          return pause.then(function () { return call('add', { body: { pass: pass, voter: voter(), type: type, title: title, body: F.body.value, context: ctx, hp: F.hp.value, elapsed_ms: Date.now() - t0 } }); });
        }).then(function (r) {
          var en = r.entry || {};
          if (r.receipt) addReceipt(r.receipt);
          if (en.state === 'published' && en.id && !byId(en.id)) {
            en.votes = en.votes || 1; en.similar = 0; en.aliases = en.aliases || []; en.tags = en.tags || []; en.comments = en.comments || []; en.status = en.status || 'open';
            S.entries.push(en);
            S.idx.set(en.id, en);
            S.voted[en.id] = 1;
          }
          S.draft = { type: 'idea', title: '', body: '' };
          S.thanks = en.state === 'published' ? 'published' : 'pending';
          emitType('arghbox:add', type);
          setView('thanks');
          say(t(S.thanks === 'published' ? 'thanks.published' : 'thanks.pending'));
          loadMine().then(function () { paintMine(); });
        }).catch(function (err) {
          F.submit.disabled = false;
          F.submit.textContent = t('add.submit');
          if (err && err.code === 'invalid_input' && (err.field === 'title' || err.field === 'body')) {
            fe(err.field, t(errorInfo('invalid_input', 0, err.field).key));
            F[err.field].focus();
          } else fail(err);
        });
      } }, [
        h('div', { class: 'sc' }, [
          types,
          h('label', { for: 'f-title', text: t('add.field.title') }), F.title, F.et,
          F.sim,
          h('label', { for: 'f-body', text: t('add.field.body') }), F.body, F.eb,
          h('div', { class: 'hp', 'aria-hidden': 'true' }, [F.hp]),
          F.ctx
        ]),
        h('div', { class: 'ft' }, [F.submit, credit()])
      ]);
      if (!S.entries.length && S.listState === 'ok') F.sim.hidden = true;
      return { hd: header(t('add.title'), t('add.subtitle', { site: siteName() }), back), vw: form, focus: F.title };
    }

    function viewThanks() {
      var pub = S.thanks === 'published';
      return {
        hd: header(t(pub ? 'thanks.published' : 'thanks.pending'), ''),
        vw: h('div', { class: 'vw' }, [
          h('div', { class: 'sc thx' }, [h('span', { class: 'ok', 'aria-hidden': 'true' }, [ic('ok')]), h('p', { text: t(pub ? 'thanks.published.text' : 'thanks.pending.text', { site: siteName() }) })]),
          h('div', { class: 'ft' }, [
            h('button', { type: 'button', class: 'pri', text: t('thanks.back'), onclick: function () { setView('list'); } }),
            h('button', { type: 'button', class: 'sec', text: t('thanks.again'), onclick: function () { setView('add'); } }),
            credit()
          ])
        ])
      };
    }

    function setView(v) {
      S.view = v;
      if (v !== 'list') S.note = '';
      clearTimeout(S.qt); // a pending search paint must not redraw (and unfocus) the view we are switching to
      if (!S.panel) return;
      var parts = v === 'add' ? viewAdd() : v === 'detail' ? viewDetail() : v === 'thanks' ? viewThanks() : viewList();
      S.panel.textContent = '';
      S.banner = h('div', { class: 'banner', hidden: true }); // announced through the alert region, not by itself
      S.panel.appendChild(parts.hd);
      S.panel.appendChild(S.banner);
      S.panel.appendChild(parts.vw);
      S.panel.appendChild(S.live);
      S.panel.appendChild(S.alert);
      S.panel.removeAttribute('aria-busy');
      S.panel.setAttribute('aria-labelledby', 'ab-title');
      if (v === 'list' && S.refs.sc) {
        S.refs.sc.scrollTop = S.scroll;
        var back = S.focusCard && S.refs.box.querySelector('[data-open="' + S.focusCard + '"]');
        if (back) { back.focus({ preventScroll: true }); S.focusCard = 0; return; }
      }
      if (v === 'detail') S.focusCard = S.detailId;
      else if (v !== 'list') S.focusCard = 0;
      var f = parts.focus || S.panel.querySelector('h2');
      f.focus({ preventScroll: true });
      if (v === 'add') prewarm();
    }
    function prewarm() {
      if (S.key || S.appPass) ensurePass().catch(function (e) { if (e && e.code === 'turnstile_unavailable') fail(e); });
    }
    function tryWant() {
      var id = S.want;
      if (id && S.listState === 'ok' && S.view === 'list') {
        S.want = 0;
        showDetail(id);
      }
    }
    function refresh() {
      if (!S.isOpen || !S.strings) return;
      if (S.view === 'list') {
        S.panel.querySelector('.sub').textContent = t('dialog.subtitle', { site: siteName() });
        paintChips();
        paintMine();
        paintList();
        tryWant();
      } else if (S.view === 'add' || S.view === 'detail') paintVotes();
      Array.prototype.forEach.call(S.panel.querySelectorAll('.cr'), function (n) {
        var c = credit();
        if (c) n.parentNode.replaceChild(c, n); else n.parentNode.removeChild(n);
      });
    }

    function fallbackView() {
      S.panel.textContent = '';
      S.panel.appendChild(h('div', { class: 'hd' }, [
        h('div', { class: 'hdt' }, [h('h2', { id: 'ab-title', tabindex: '-1', text: 'ArghBox' }), h('p', { class: 'sub', text: 'Could not load. Please try again.' })]),
        h('button', { type: 'button', class: 'ib', 'aria-label': 'Close', onclick: close }, [ic('x')])
      ]));
      S.panel.appendChild(h('div', { class: 'ft' }, [h('button', { type: 'button', class: 'pri', text: 'Try again', onclick: function () {
        S.panel.setAttribute('aria-busy', 'true');
        loadStrings().then(function (ok) { if (!S.isOpen) return; S.panel.removeAttribute('aria-busy'); if (ok) { go({}); loadList(); } else fallbackView(); });
      } })]));
      S.panel.setAttribute('aria-labelledby', 'ab-title');
      S.panel.querySelector('button').focus();
    }

    function go(o) {
      S.want = o.id || 0;
      var resume = // reopened with an unsent draft on screen
        !o.view && !o.type && S.view === 'add' && !!(S.draft.title || S.draft.body);
      if (o.view === 'add' || resume) { if (o.type) S.draft.type = o.type; setView('add'); } else {
        if (o.type) S.tab = o.type === 'bug' ? 'bugs' : 'ideas';
        setView('list');
        tryWant();
      }
    }
    function focusables() {
      var out = Array.prototype.filter.call(S.panel.querySelectorAll('button,input,textarea,a[href],summary'), function (el) {
        return !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0;
      });
      var ifr = tsBox && tsBox.style.display !== 'none' && tsBox.querySelector('iframe');
      if (ifr) out.push(ifr);
      return out;
    }
    function onKey(ev) {
      if (!S.isOpen || ime(ev)) return;
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        var q = S.refs.q;
        if (q && q.value && deepActive() === q) { q.value = S.q = ''; clearTimeout(S.qt); paintList(); } else close();
        return;
      }
      if (ev.key !== 'Tab') return;
      var f = focusables(), i = f.indexOf(deepActive()), last = f.length - 1;
      if (!f.length) { ev.preventDefault(); return; }
      if (ev.shiftKey && i <= 0) { f[last].focus(); ev.preventDefault(); }
      else if (!ev.shiftKey && (i === last || i < 0)) { f[0].focus(); ev.preventDefault(); }
    }
    function onFocusIn(ev) {
      if (!S.isOpen) return;
      var tg = ev.target;
      if (tg === shadow.host || (tsBox && (tg === tsBox || tsBox.contains(tg)))) return;
      var f = focusables();
      (f[0] || S.panel).focus({ preventScroll: true });
    }

    function open(o, from) {
      o = o || {};
      if (S.isOpen) { if (S.strings) go(o); return; }
      S.isOpen = true;
      fitAccent(wrap);
      S.from = from || deepActive();
      S.live = h('div', { class: 'sr', role: 'status', 'aria-live': 'polite' });
      S.alert = h('div', { class: 'sr', role: 'alert', 'aria-live': 'assertive' });
      S.panel = h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', tabindex: '-1', 'aria-busy': 'true' }, [S.live, S.alert]);
      // closes only on a press and release both on the backdrop, not a text selection dragged out of a field
      S.ov = h('div', {
        class: 'ov', onclick: function () { if (S.bd) close(); },
        onpointerdown: function (ev) { S.bd = ev.target === S.ov && !ev.button; },
        onpointerup: function (ev) { S.bd = S.bd && ev.target === S.ov; }
      }, [S.panel]);
      // the page behind must not scroll while the dialog is open (wheel over the backdrop, header or footer)
      S.ov.addEventListener('wheel', function (ev) { if (!ev.composedPath().some(function (n) { return n.classList && n.classList.contains('sc'); })) ev.preventDefault(); }, { passive: false });
      wrap.appendChild(S.ov);
      window.addEventListener('keydown', onKey, true);
      document.addEventListener('focusin', onFocusIn, true);
      S.panel.focus({ preventScroll: true });
      emitType('arghbox:open', o.type);
      if (!S.listAt || Date.now() - S.listAt > 60000) loadList();
      if (S.key && !S.appPass) tsLoad().catch(function () { });
      loadStrings().then(function (ok) {
        if (!S.isOpen) return;
        if (ok) go(o); else fallbackView();
      });
    }

    function close() {
      if (!S.isOpen) return;
      S.isOpen = false;
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn, true);
      if (S.ov && S.ov.parentNode) S.ov.parentNode.removeChild(S.ov);
      S.ov = S.panel = S.live = S.alert = S.banner = null;
      S.refs = {};
      tsCancel();
      var el = S.from;
      if (el && el.isConnected && el.focus) el.focus({ preventScroll: true });
      emit('arghbox:close');
    }

    function destroy() {
      close();
      if (tsBox && tsBox.parentNode) tsBox.parentNode.removeChild(tsBox);
    }
    mounted = { shadow: shadow, open: open, close: close, destroy: destroy, isOpen: function () { return S.isOpen; } };
    loadStrings();
    return mounted;
  }

  window.__arghboxApp = { version: VERSION, mount: mount, helpers: helpers };
})(window, document);
