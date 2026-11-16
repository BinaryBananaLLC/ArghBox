/*
 * Fake Cloudflare Turnstile for tests. Served by page.route('https://challenges.cloudflare.com/**').
 * Implements window.turnstile.{render, execute, reset, remove, getResponse}.
 *
 * Behaviour is chosen at run time through window.__turnstileMode (set it with
 * page.evaluate / page.addInitScript, or the setTurnstileMode helper in servers.mjs):
 *   'pass'        (default) call callback with a fake token after a few ms
 *   'interactive' call before-interactive-callback, wait 150 ms, call after-interactive-callback, then callback
 *   'error'       call error-callback
 * Call counters are on window.__turnstileCalls = {render, execute, reset, remove}; the options given to
 * the last render are on window.__turnstileLastRender.
 */
(function () {
  var calls = { render: 0, execute: 0, reset: 0, remove: 0 };
  var widgets = {};
  var n = 0;
  window.__turnstileCalls = calls;

  function run(id) {
    var w = widgets[id];
    if (!w) return;
    var o = w.opts;
    var mode = window.__turnstileMode || 'pass';
    var token = 'stub-token-' + ++n;
    w.token = null;
    if (mode === 'error') {
      setTimeout(function () { o['error-callback'] && o['error-callback']('300000'); }, 5);
    } else if (mode === 'interactive') {
      setTimeout(function () {
        o['before-interactive-callback'] && o['before-interactive-callback']();
        setTimeout(function () {
          o['after-interactive-callback'] && o['after-interactive-callback']();
          w.token = token;
          o.callback && o.callback(token);
        }, 150);
      }, 5);
    } else {
      setTimeout(function () { w.token = token; o.callback && o.callback(token); }, 5);
    }
  }

  window.turnstile = {
    render: function (el, opts) {
      var id = 'ts-' + (Object.keys(widgets).length + 1);
      widgets[id] = { el: el, opts: opts || {} };
      window.__turnstileLastRender = opts;
      calls.render++;
      if ((opts || {}).execution !== 'execute') run(id);
      return id;
    },
    execute: function (id) { calls.execute++; run(id); },
    reset: function () { calls.reset++; },
    remove: function (id) { calls.remove++; delete widgets[id]; },
    getResponse: function (id) { return widgets[id] && widgets[id].token; }
  };
})();
