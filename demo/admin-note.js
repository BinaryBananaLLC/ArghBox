// Demo only (GitHub Pages build): loaded by the admin page after demo/backend.js. Adds a slim bar that says this
// is the demo admin, with the way back to Contoso Tasks and a reset, and puts the demo password next to the
// sign-in field. The admin page itself is the real arghbox/admin/admin.js. A real install never loads this file.
(function () {
  'use strict';
  var demo = window.ArghBoxDemo;
  if (!demo) return;

  var css = [
    '.demo-note{background:#fff7e8;color:#3d2a12;border-bottom:1px solid #f0dcb4;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:.55rem 1rem;display:flex;flex-wrap:wrap;gap:.35rem 1.25rem;align-items:center}',
    '.demo-note a,.demo-note button{color:inherit;font:inherit;font-weight:600;text-decoration:underline;text-underline-offset:2px}',
    '.demo-note button{background:none;border:0;padding:0;cursor:pointer}',
    '.demo-note code{background:rgba(255,255,255,.75);border-radius:5px;padding:.05em .35em;font-weight:700}',
    '.demo-pass{margin:.75rem 0 0;font-size:.95rem}',
    '.demo-pass button{margin-left:.35rem}',
    '@media (prefers-color-scheme:dark){.demo-note{background:#2a2114;color:#f6e7cc;border-color:#4a3a20}.demo-note code{background:rgba(0,0,0,.35)}}'
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (k) { n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return n;
  }

  var reset = el('button', { type: 'button', text: 'Reset the demo' });
  reset.addEventListener('click', function () {
    demo.reset();
    window.location.reload();
  });
  var bar = el('aside', { class: 'demo-note', 'aria-label': 'About this demo' }, [
    el('span', {}, [el('strong', { text: 'ArghBox demo admin.' }), ' Owner token (the admin password): ', el('code', { text: demo.password })]),
    el('span', { text: 'The triage run on the dashboard is a recorded example: on your site, your own Claude Code does it when you say "empty the ArghBox". Changes stay in this browser.' }),
    el('a', { href: '../../', text: 'Back to Contoso Tasks' }),
    reset
  ]);
  document.body.insertBefore(bar, document.body.firstChild);

  // The sign-in form is drawn by admin.js: add the password hint whenever it appears.
  function hint() {
    var token = document.getElementById('token');
    if (!token || document.getElementById('demo-pass')) return;
    var fill = el('button', { type: 'button', class: 'btn', text: 'Fill it in' });
    fill.addEventListener('click', function () {
      token.value = demo.password;
      token.focus();
    });
    var p = el('p', { class: 'demo-pass muted', id: 'demo-pass' }, ['Demo owner token: ', el('code', { text: demo.password }), fill]);
    token.parentNode.appendChild(p);
  }
  new MutationObserver(hint).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  hint();
})();
