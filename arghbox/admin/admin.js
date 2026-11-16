/* ArghBox admin page. Plain JavaScript, no framework, no build.
 *
 * Talks to ../api.php (admin.* actions) with the admin cookie and the CSRF header.
 * All text that visitors wrote is put into the page with textContent (through h()), never as HTML.
 *
 * Sections: helpers, API, state, shared widgets, entry card, lists, dashboard, log, shell.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ helpers */

  var TYPES = { idea: 'Idea', bug: 'Bug', question: 'Question' };
  var STATUSES = { open: 'Open', planned: 'Planned', in_progress: 'In progress', done: 'Done', declined: 'Declined' };
  var STATES = { pending: 'Pending', flagged: 'Flagged', published: 'Published', rejected: 'Rejected', merged: 'Merged', private: 'Private' };
  var REASONS = { spam: 'Spam', abuse: 'Abuse', off_topic: 'Off topic', test: 'Test', unclear: 'Unclear', other: 'Other' };
  var TAG_RE = /^[a-z0-9][a-z0-9-]{1,23}$/;
  var PAGE = 25;

  /** Create an element. props: class, text, on<event>, value/checked/disabled/selected (properties), others attributes. */
  function h(tag, props) {
    var el = document.createElement(tag);
    var late = null;
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') (late = late || {})[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    if (late) Object.keys(late).forEach(function (k) { el[k] = late[k]; });
    return el;
  }
  function add(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(function (k) { add(el, k); });
    else el.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function fill(el) {
    clear(el);
    for (var i = 1; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
  function fmt(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  function time(iso) { return h('time', { datetime: iso || null, title: iso || null, text: fmt(iso) }); }
  function option(value, label, selected) { return h('option', { value: value, text: label, selected: selected }); }
  function selectOf(map, current, extra) {
    var s = h('select');
    if (extra) s.appendChild(option('', extra));
    Object.keys(map).forEach(function (k) { s.appendChild(option(k, map[k], k === current)); });
    s.value = current || '';
    return s;
  }
  function chip(text, cls, title) { return h('span', { class: 'chip ' + (cls || ''), text: text, title: title || null }); }
  function button(label, onclick, cls, attrs) {
    var p = { type: 'button', class: 'btn ' + (cls || ''), text: label, onclick: onclick };
    if (attrs) Object.keys(attrs).forEach(function (k) { p[k] = attrs[k]; });
    return h('button', p);
  }
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var a = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, a); }, ms);
    };
  }

  /** Client-side check for the linked-issue field: empty is fine (clears it), otherwise an http(s) URL. */
  function urlProblem(v) {
    v = v.trim();
    if (!v) return '';
    if (v.length > 500) return 'The link is too long (at most 500 characters).';
    var u = null;
    try { u = new URL(v); } catch (e) { /* invalid */ }
    if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:') || /\s/.test(v)) return 'The link must be a valid http or https URL.';
    return '';
  }
  /** Copy text to the clipboard (Clipboard API, falling back to a temporary textarea). Resolves true on success. */
  function copyText(text) {
    function fallback() {
      var ta = h('textarea', { class: 'sr-only', 'aria-hidden': 'true', tabindex: '-1' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  /* ---------------------------------------------------------------------- API */

  var API_URL = new URL('../api.php', document.baseURI).href;

  function ApiError(status, code, message, data) {
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.message = message;
    this.data = data || null;
  }
  ApiError.prototype = Object.create(Error.prototype);

  var csrf = '';
  var onUnauthorized = null;

  /** api('admin.entries', {query: {...}}) or api('admin.update', {body: {...}}). Resolves to the JSON; rejects with ApiError. */
  function api(action, opts) {
    opts = opts || {};
    var qs = new URLSearchParams({ action: action });
    Object.keys(opts.query || {}).forEach(function (k) {
      var v = opts.query[k];
      if (v !== '' && v !== null && v !== undefined) qs.set(k, v);
    });
    var init = { credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) {
      init.method = 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.headers['X-ArghBox-CSRF'] = csrf;
      init.body = JSON.stringify(opts.body);
    }
    return fetch(API_URL + '?' + qs.toString(), init).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
        if (!json) {
          throw new ApiError(res.status, 'not_json', 'The server did not answer with JSON (HTTP ' + res.status + '). Is ArghBox uploaded and is api.php reachable?');
        }
        if (!json.ok) {
          var err = new ApiError(res.status, json.error || 'error', json.message || 'Something went wrong.', json);
          if (res.status === 401 && action !== 'admin.login' && action !== 'admin.me' && onUnauthorized) onUnauthorized(err);
          throw err;
        }
        return json;
      });
    }, function () {
      throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
    });
  }
  function errText(e) { return e && e.message ? e.message : 'Something went wrong.'; }

  /* -------------------------------------------------------------------- state */

  var S = {
    site: { name: '' },
    stats: null,
    tags: [],            // vocabulary [{tag, count}]
    tab: 'dashboard',
    readOnly: false      // admin.me reported actor "read": hide every write control
  };

  var root = document.getElementById('app');
  var main = null;      // <main> of the signed-in shell
  var navEl = null;
  var headingEl = null; // visually hidden <h1>: the page title and the current section
  var liveEl = null;    // global polite live region
  var renderToken = 0;

  function say(msg) { if (liveEl) liveEl.textContent = msg; }

  function loadVocabulary() {
    return api('admin.queue').then(function (q) {
      S.site = q.site || S.site;
      S.tags = q.tags || [];
      return q;
    });
  }
  /** A tag the owner just used joins the suggestions without reloading the whole queue. */
  function rememberTags(list) {
    (list || []).forEach(function (t) {
      if (!S.tags.some(function (v) { return v.tag === t; })) S.tags.push({ tag: t, count: 1 });
    });
  }
  function refreshStats() {
    return api('admin.stats').then(function (st) {
      S.stats = st;
      drawNav();
      return st;
    }, function () { /* the badge just stays as it was */ });
  }

  /* ------------------------------------------------------------ shared widgets */

  /** Chip editor for tags. Returns {el, get(), set(list)}. */
  function TagEditor(initial, label) {
    var tags = (initial || []).slice();
    var wrap = h('div', { class: 'tag-editor' });
    var chips = h('div', { class: 'tag-chips' });
    var inputId = 'tag-input-' + Math.random().toString(36).slice(2, 8);
    var input = h('input', { type: 'text', id: inputId, class: 'tag-input', 'aria-label': label || 'Add a tag', placeholder: 'Add a tag', autocomplete: 'off', maxlength: '24' });
    var problem = h('p', { class: 'field-error', role: 'alert' });
    var suggest = h('div', { class: 'tag-suggest', role: 'group', 'aria-label': 'Suggested tags' });

    function addTag(raw) {
      var t = String(raw).trim().toLowerCase().replace(/^#/, '');
      if (!t) return;
      if (!TAG_RE.test(t)) { problem.textContent = 'Tags are 2 to 24 characters: lowercase letters, digits and dashes.'; return; }
      if (tags.indexOf(t) !== -1) { input.value = ''; return; }
      if (tags.length >= 3) { problem.textContent = 'At most 3 tags.'; return; }
      problem.textContent = '';
      tags.push(t);
      tags.sort();
      input.value = '';
      draw();
    }
    function draw() {
      fill(chips, tags.map(function (t) {
        return h('span', { class: 'chip tag' }, '#' + t,
          h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remove tag ' + t, onclick: function () { tags = tags.filter(function (x) { return x !== t; }); problem.textContent = ''; draw(); } }, '×'));
      }));
      var shown = S.tags.filter(function (v) { return tags.indexOf(v.tag) === -1; }).slice(0, 10);
      fill(suggest, shown.map(function (v) {
        return h('button', { type: 'button', class: 'chip suggest', text: '+ ' + v.tag, 'aria-label': 'Use tag ' + v.tag, onclick: function () { addTag(v.tag); } });
      }));
    }
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ',') { ev.preventDefault(); addTag(input.value); }
      else if (ev.key === 'Backspace' && !input.value && tags.length) { tags.pop(); draw(); }
    });
    input.addEventListener('blur', function () { if (input.value.trim()) addTag(input.value); });
    wrap.appendChild(chips);
    wrap.appendChild(h('div', { class: 'tag-add' }, input, button('Add', function () { addTag(input.value); input.focus(); }, 'small')));
    wrap.appendChild(problem);
    wrap.appendChild(suggest);
    draw();
    return {
      el: wrap,
      get: function () { if (input.value.trim()) addTag(input.value); return tags.slice(); },
      set: function (list) { tags = (list || []).slice(); draw(); }
    };
  }

  function field(label, control, hint) {
    var id = 'f-' + Math.random().toString(36).slice(2, 9);
    if (control.setAttribute && !control.id && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)) control.id = id;
    return h('div', { class: 'field' },
      h('label', { for: control.id || null, text: label }), control, hint ? h('p', { class: 'hint', text: hint }) : null);
  }

  /* --------------------------------------------------------------- entry card */

  var STATE_CLASS = { pending: 'warn', flagged: 'flag', published: 'ok', rejected: 'bad', merged: 'muted', private: 'priv' };

  function contextLine(c) {
    if (!c) return '';
    var bits = [];
    if (c.page) bits.push('page ' + c.page);
    if (c.lang) bits.push(c.lang);
    if (c.browser) bits.push(c.browser);
    if (c.os) bits.push(c.os);
    if (c.screen) bits.push(c.screen + ' screen');
    return bits.join(' · ');
  }

  /**
   * One entry as an expandable card. entry: AdminEntry. opts: {open, onChange(entry), goLog(entryId)}.
   * Actions call the API, show the result under the buttons, and redraw the card from the returned entry.
   */
  function EntryCard(entry, opts) {
    opts = opts || {};
    var open = !!opts.open;
    var article = h('article', { class: 'entry', 'data-id': entry.id });
    var head = h('div', { class: 'entry-top' });
    var body = h('div', { class: 'entry-body' });
    var notice = h('p', { class: 'notice', role: 'status' });
    var editingComment = null;
    var busy = false;     // a write request is running
    article.appendChild(head);
    article.appendChild(body);

    function say2(msg, bad) {
      notice.textContent = msg || '';
      notice.className = 'notice' + (msg ? (bad ? ' bad' : ' ok') : '');
    }
    function setEntry(e, msg) {
      entry = e;
      draw();
      if (msg) say2(msg, false);
      refreshStats();
      if (opts.onChange) opts.onChange(entry);
    }
    /** Run an API call that returns {entry}; show success or the API's message. */
    function run(label, action, payload, okMsg, after) {
      if (busy) return Promise.resolve(); // a double click must not post twice
      busy = true;
      var frozen = [].slice.call(article.querySelectorAll('button:not(:disabled)'));
      frozen.forEach(function (b) { b.disabled = true; });
      article.setAttribute('aria-busy', 'true');
      function settle() {
        busy = false;
        article.removeAttribute('aria-busy');
        frozen.forEach(function (b) { b.disabled = false; });
      }
      say2('');
      return api(action, { body: payload }).then(function (res) {
        settle();
        if (after) after(res);
        setEntry(res.entry, okMsg || (label + ': done.'));
        return res;
      }, function (err) {
        settle();
        say2(label + ' failed: ' + errText(err), true);
      });
    }
    function update(label, fields, okMsg) {
      var payload = { id: entry.id };
      Object.keys(fields).forEach(function (k) { payload[k] = fields[k]; });
      return run(label, 'admin.update', payload, okMsg);
    }

    function drawHead() {
      var stateChip = chip(STATES[entry.state] || entry.state, STATE_CLASS[entry.state] || '');
      var toggle = h('button', {
        type: 'button', class: 'entry-toggle', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'entry-body-' + entry.id,
        onclick: function () { open = !open; draw(); }
      },
        h('span', { class: 'entry-id', text: '#' + entry.id }),
        h('span', { class: 'entry-title', text: entry.title }));
      fill(head,
        toggle,
        h('div', { class: 'entry-meta' },
          chip(TYPES[entry.type] || entry.type, 'type-' + entry.type),
          stateChip,
          entry.state === 'published' || entry.state === 'private' ? chip(STATUSES[entry.status] || entry.status, 'status status-' + entry.status) : null,
          entry.source === 'owner' ? chip('My item', 'mine') : null,
          entry.state === 'merged' && entry.merged_into ? chip('into #' + entry.merged_into, 'muted') : null,
          entry.state === 'rejected' && entry.reject_reason ? chip(REASONS[entry.reject_reason] || entry.reject_reason, 'bad') : null,
          entry.state !== 'private' ? chip(plural(entry.votes, 'vote'), 'votes') : null,
          (entry.tags || []).map(function (t) { return chip('#' + t, 'tag'); }),
          entry.ai && !entry.ai.applied ? chip('needs you', 'flag', 'The AI was not confident enough to apply its decision.') : null,
          h('span', { class: 'when' }, time(entry.created_at))));
    }

    function drawBody() {
      if (!open) { body.hidden = true; clear(body); return; }
      body.hidden = false;
      body.id = 'entry-body-' + entry.id;
      fill(body,
        factsEl(),
        h('div', { class: 'entry-text' },
          entry.body ? h('p', { class: 'pre', text: entry.body }) : h('p', { class: 'muted', text: 'No details.' })),
        originalsEl(),
        aliasesEl(),
        aiEl(),
        S.readOnly ? null : actionsEl(),
        notice,
        S.readOnly ? null : mergeEl(),
        S.readOnly ? null : editEl(),
        S.readOnly ? null : statusTagsEl(),
        commentsEl(),
        historyEl());
    }
    function draw() { drawHead(); drawBody(); }

    function dl(pairs) {
      var d = h('dl', { class: 'facts' });
      pairs.forEach(function (p) { if (p[1] !== null && p[1] !== '' && p[1] !== undefined) d.appendChild(h('div', null, h('dt', { text: p[0] }), h('dd', null, p[1]))); });
      return d;
    }
    function factsEl() {
      var ctx = contextLine(entry.context);
      return dl([
        ['Created', time(entry.created_at)],
        ['Updated', time(entry.updated_at)],
        ['Source', entry.source === 'owner' ? 'You (admin page)' : 'Visitor'],
        ['Author', entry.author ? h('code', { text: entry.author, title: 'Start of the anonymous source hash. Same value = same source.' }) : null],
        ['Votes', entry.state === 'private' ? null : String(entry.votes)],
        ['Status', entry.status ? (STATUSES[entry.status] || entry.status) + (entry.status_at ? ' since ' + fmt(entry.status_at) : '') : null],
        ['Context', ctx || null],
        ['Merged into', entry.merged_into ? '#' + entry.merged_into : null],
        ['Linked issue', entry.external_url ? h('a', { class: 'external-link', href: entry.external_url, target: '_blank', rel: 'noopener noreferrer', text: entry.external_url }) : null],
        ['Reject reason', entry.state === 'rejected' ? (REASONS[entry.reject_reason] || entry.reject_reason || '') : null]
      ]);
    }
    function originalsEl() {
      var t = entry.title_original !== entry.title;
      var b = entry.body_original !== entry.body;
      if (!t && !b) return null;
      return h('details', { class: 'originals' },
        h('summary', { text: 'Original wording from the visitor' }),
        t ? h('p', null, h('strong', { text: 'Title: ' }), h('span', { text: entry.title_original })) : null,
        b ? h('p', { class: 'pre', text: entry.body_original || '(empty)' }) : null);
    }
    function aliasesEl() {
      if (!entry.aliases || !entry.aliases.length) return null;
      return h('div', { class: 'aliases' }, h('strong', { text: plural(entry.similar || entry.aliases.length, 'entry', 'entries') + ' merged into this one: ' }),
        h('ul', null, entry.aliases.map(function (a) { return h('li', { text: a }); })));
    }
    function aiEl() {
      var a = entry.ai;
      if (!a) return null;
      var verdict = (a.action || '?') + (a.action === 'merge' && a.merge_into ? ' into #' + a.merge_into : '') + (a.action === 'reject' && a.reject_reason ? ' (' + (REASONS[a.reject_reason] || a.reject_reason) + ')' : '');
      return h('section', { class: 'ai', 'aria-label': 'AI note' },
        h('h2', { class: 'sub', text: 'AI note' }),
        h('p', null,
          h('strong', { text: 'Suggested: ' + verdict }),
          typeof a.confidence === 'number' ? ' · confidence ' + a.confidence + '%' : '',
          a.applied === false ? h('span', { class: 'chip flag', text: 'not applied, flagged for you' }) : null),
        a.reason ? h('p', { class: 'pre', text: a.reason }) : null,
        a.title_en ? h('p', null, h('em', { text: 'English: ' }), a.title_en) : null,
        h('p', { class: 'muted small' }, 'Reviewer ' + (a.reviewer || 'unknown') + (a.run_id ? ', run #' + a.run_id : '') + ', ', time(a.at)));
    }

    function actionsEl() {
      var st = entry.state;
      var visitor = entry.source !== 'owner';
      var row = h('div', { class: 'actions', role: 'group', 'aria-label': 'Actions' });
      if (st === 'merged') {
        row.appendChild(h('p', { class: 'muted', text: 'This entry was merged into #' + entry.merged_into + '. To change that, undo the merge in the log.' }));
        row.appendChild(button('Show in log', function () { if (opts.goLog) opts.goLog(entry.id); }, 'small'));
        return row;
      }
      if (st !== 'published') row.appendChild(button(st === 'private' ? 'Make public' : 'Publish', function () { update(st === 'private' ? 'Make public' : 'Publish', { state: 'published' }, 'Published.'); }, 'primary'));
      if (st !== 'flagged' && visitor) row.appendChild(button('Flag', function () { update('Flag', { state: 'flagged' }, 'Flagged for you.'); }));
      if (st !== 'pending' && visitor) row.appendChild(button('Back to pending', function () { update('Back to pending', { state: 'pending' }, 'Back in the triage queue.'); }));
      if (entry.source === 'owner' && st === 'published') row.appendChild(button('Make private', function () { update('Make private', { state: 'private' }, 'Now private.'); }));
      if (st !== 'rejected') {
        var reason = selectOf(REASONS, visitor ? 'other' : 'other');
        reason.setAttribute('aria-label', 'Reject reason');
        row.appendChild(h('span', { class: 'inline-group' }, reason,
          button('Reject', function () { update('Reject', { state: 'rejected', reject_reason: reason.value }, 'Rejected (' + REASONS[reason.value] + ').'); }, 'danger')));
      } else {
        var r2 = selectOf(REASONS, entry.reject_reason || 'other');
        r2.setAttribute('aria-label', 'Change reject reason');
        row.appendChild(h('span', { class: 'inline-group' }, r2,
          button('Change reason', function () { update('Change reason', { state: 'rejected', reject_reason: r2.value }, 'Reason updated.'); })));
      }
      row.appendChild(button('Show in log', function () { if (opts.goLog) opts.goLog(entry.id); }, 'small ghost'));
      return row;
    }

    function mergeEl() {
      if (entry.state === 'merged' || entry.state === 'private') return null;
      var picked = null;
      var q = h('input', { type: 'search', 'aria-label': 'Search published entries to merge into', placeholder: 'Search published entries' });
      var results = h('ul', { class: 'picker-results' });
      var go = button('Merge', null, 'primary', { disabled: true });
      var info = h('p', { class: 'muted small', text: 'Merge copies this entry’s votes to the target. You can undo it in the log.' });
      function showResults(list) {
        fill(results, list.length ? list.map(function (e) {
          var li = h('li');
          li.appendChild(h('button', {
            type: 'button', class: 'pick' + (picked === e.id ? ' picked' : ''), 'aria-pressed': picked === e.id ? 'true' : 'false',
            onclick: function () {
              picked = e.id;
              go.disabled = false;
              go.textContent = 'Merge into #' + e.id;
              showResults(list);
            }
          }, h('span', { class: 'entry-id', text: '#' + e.id }), h('span', { text: e.title }), h('span', { class: 'muted small', text: plural(e.votes, 'vote') })));
          return li;
        }) : h('li', { class: 'muted', text: 'Nothing found.' }));
      }
      var searchSeq = 0;
      var search = function () {
        var mine = ++searchSeq;
        api('admin.entries', { query: { state: 'published', q: q.value.trim(), limit: 8 } }).then(function (r) {
          if (mine !== searchSeq) return; // an older answer arriving late must not win
          showResults(r.entries.filter(function (e) { return e.id !== entry.id; }));
        }, function (err) { say2('Search failed: ' + errText(err), true); });
      };
      q.addEventListener('input', debounce(search, 250));
      go.addEventListener('click', function () {
        if (!picked) return;
        update('Merge', { merge_into: picked }, 'Merged into #' + picked + '.');
      });
      var d = h('details', { class: 'panel merge' },
        h('summary', { text: 'Merge into another entry' }),
        h('div', { class: 'panel-body' }, q, results, h('div', { class: 'row' }, go), info));
      d.addEventListener('toggle', function () { if (d.open && !results.firstChild) search(); });
      return d;
    }

    function editEl() {
      var title = h('input', { type: 'text', value: entry.title, maxlength: '120' });
      var type = selectOf(TYPES, entry.type);
      var bodyIn = h('textarea', { rows: '4', maxlength: '2000', value: entry.body });
      var link = h('input', { type: 'text', value: entry.external_url || '', maxlength: '500', placeholder: 'https://example.atlassian.net/browse/PROJ-123', autocomplete: 'off', spellcheck: 'false' });
      var linkErr = h('p', { class: 'field-error', role: 'alert' });
      var save = button('Save changes', function () {
        var changes = {};
        linkErr.textContent = '';
        var bad = urlProblem(link.value);
        if (bad) { linkErr.textContent = bad; say2('Edit failed: ' + bad, true); return; }
        if (link.value.trim() !== (entry.external_url || '')) changes.external_url = link.value.trim() === '' ? null : link.value.trim();
        if (title.value !== entry.title) changes.title = title.value;
        if (type.value !== entry.type) changes.type = type.value;
        if (bodyIn.value !== entry.body) changes.body = bodyIn.value;
        if (!Object.keys(changes).length) { say2('Nothing changed.', false); return; }
        update('Edit', changes, 'Saved.');
      }, 'primary');
      return h('details', { class: 'panel edit' },
        h('summary', { text: 'Edit title, type, details and linked issue' }),
        h('div', { class: 'panel-body' }, field('Title', title), field('Type', type), field('Details', bodyIn),
          field('Linked issue (Jira, GitHub, Linear; leave empty to clear)', link), linkErr, h('div', { class: 'row' }, save)));
    }

    function statusTagsEl() {
      var wrap = h('div', { class: 'panel-row' });
      if (entry.state === 'published' || entry.state === 'private') {
        var st = selectOf(STATUSES, entry.status);
        wrap.appendChild(h('div', { class: 'field inline' },
          h('label', { text: 'Status', for: 'status-' + entry.id }),
          (st.id = 'status-' + entry.id, st),
          button('Set status', function () {
            if (st.value === entry.status) { say2('Status is already ' + STATUSES[st.value] + '.', false); return; }
            update('Set status', { status: st.value }, 'Status is now ' + STATUSES[st.value] + '.');
          })));
      }
      var te = TagEditor(entry.tags, 'Add a tag to entry ' + entry.id);
      wrap.appendChild(h('div', { class: 'field' },
        h('span', { class: 'label', text: 'Tags' }), te.el,
        button('Save tags', function () {
          var tags = te.get();
          update('Tags', { tags: tags }, tags.length ? 'Tags saved.' : 'Tags cleared.').then(function () { rememberTags(tags); });
        })));
      return wrap;
    }

    function commentsEl() {
      var box = h('section', { class: 'comments', 'aria-label': 'Comments and notes' }, h('h2', { class: 'sub', text: 'Comments and notes' }));
      var list = h('ul', { class: 'comment-list' });
      var comments = entry.comments || [];
      if (!comments.length) list.appendChild(h('li', { class: 'muted', text: 'No comments yet.' }));
      comments.forEach(function (c) { list.appendChild(commentEl(c)); });
      box.appendChild(list);

      var text = h('textarea', { rows: '3', maxlength: '2000', 'aria-label': 'New comment or note', placeholder: 'Write a comment or a note' });
      var kind = h('select', { 'aria-label': 'Comment visibility' }, option('1', 'Public comment (visitors see it)'), option('0', 'Private note (only you)'));
      var send = button('Add', function () {
        if (!text.value.trim()) { say2('Write something first.', true); return; }
        run('Add comment', 'admin.comment', { id: entry.id, body: text.value, public: kind.value === '1' }, kind.value === '1' ? 'Public comment added.' : 'Private note added.');
      }, 'primary');
      if (!S.readOnly) box.appendChild(h('div', { class: 'comment-form' }, text, h('div', { class: 'row' }, kind, send)));
      return box;
    }
    function commentEl(c) {
      var isEditing = editingComment === c.id;
      var cls = 'comment ' + (c.public ? 'public' : 'private') + (c.hidden ? ' hidden-c' : '');
      var li = h('li', { class: cls, 'data-comment': c.id });
      var label = h('span', { class: 'chip ' + (c.public ? 'ok' : 'priv'), text: c.public ? 'Public comment' : 'Private note' });
      var meta = h('div', { class: 'comment-meta' }, label, c.hidden ? chip('Hidden', 'muted') : null, h('span', { class: 'when' }, time(c.created_at), c.updated_at !== c.created_at ? ' (edited)' : ''));
      li.appendChild(meta);
      function cu(label2, body, ok) {
        body.comment_id = c.id;
        return run(label2, 'admin.comment_update', body, ok);
      }
      if (isEditing) {
        var ta = h('textarea', { rows: '3', maxlength: '2000', value: c.body, 'aria-label': 'Edit comment' });
        li.appendChild(ta);
        li.appendChild(h('div', { class: 'row' },
          button('Save', function () { editingComment = null; cu('Edit comment', { body: ta.value }, 'Comment saved.'); }, 'primary small'),
          button('Cancel', function () { editingComment = null; draw(); }, 'small')));
      } else {
        li.appendChild(h('p', { class: 'pre', text: c.body }));
        if (!S.readOnly) li.appendChild(h('div', { class: 'row' },
          button('Edit', function () { editingComment = c.id; draw(); }, 'small'),
          button(c.hidden ? 'Unhide' : 'Hide', function () { cu(c.hidden ? 'Unhide' : 'Hide', { hidden: !c.hidden }, c.hidden ? 'Comment is visible again.' : 'Comment hidden.'); }, 'small'),
          button(c.public ? 'Make private' : 'Make public', function () { cu('Change visibility', { public: !c.public }, c.public ? 'Now a private note.' : 'Now a public comment.'); }, 'small ghost')));
      }
      return li;
    }

    function historyEl() {
      var d = h('details', { class: 'panel history' }, h('summary', { text: 'History' }));
      var holder = h('div', { class: 'panel-body' });
      d.appendChild(holder);
      function loadHistory() {
        fill(holder, h('p', { class: 'muted', text: 'Loading...' }));
        api('admin.entry', { query: { id: entry.id } }).then(function (r) {
          fill(holder, ActionList(r.actions, function () {
            // An undo changed the entry: reload it and redraw the card.
            api('admin.entry', { query: { id: entry.id } }).then(function (r2) { setEntry(r2.entry, 'Undone.'); });
          }, true));
        }, function (err) { fill(holder, h('p', { class: 'notice bad', text: errText(err) })); });
      }
      d.addEventListener('toggle', function () { if (d.open) loadHistory(); });
      return d;
    }

    draw();
    return article;
  }

  /* -------------------------------------------------------------- action list */

  /** A list of log actions with Undo buttons. onUndone() is called after a successful undo. */
  function ActionList(actions, onUndone, compact) {
    if (!actions.length) return h('p', { class: 'muted', text: 'Nothing logged yet.' });
    var ul = h('ul', { class: 'actions-list' });
    actions.forEach(function (a) {
      var msg = h('p', { class: 'notice', role: 'status' });
      var undo = null;
      if (a.undoable && !S.readOnly) {
        undo = button('Undo', function () {
          undo.disabled = true;
          api('admin.undo', { body: { action_id: a.id } }).then(function () {
            msg.textContent = '';
            say('Action ' + a.id + ' undone.');
            refreshStats();
            if (onUndone) onUndone();
          }, function (err) {
            undo.disabled = false;
            var reason = err.data && err.data.refused && err.data.refused[0] ? err.data.refused[0].reason : errText(err);
            msg.textContent = 'Not undone: ' + reason;
            msg.className = 'notice bad';
          });
        }, 'small', { 'aria-label': 'Undo action ' + a.id });
      }
      ul.appendChild(h('li', { class: 'action' + (a.undone_by ? ' undone' : ''), 'data-action': a.id },
        h('div', { class: 'action-main' },
          h('span', { class: 'chip kind', text: a.kind }),
          h('span', { class: 'action-summary', text: a.summary }),
          compact ? null : h('span', { class: 'action-entry' }, ' ', h('span', { class: 'entry-id', text: '#' + a.entry_id }), ' ', a.entry_title || ''),
          h('span', { class: 'when' }, a.actor + ' · ', time(a.at), a.run_id ? ' · run #' + a.run_id : '')),
        h('div', { class: 'action-side' },
          undo, a.undone_by ? chip('Undone', 'muted') : (!a.undoable && !S.readOnly ? h('span', { class: 'muted small', text: 'cannot be undone now' }) : null)),
        msg));
    });
    return ul;
  }

  /* -------------------------------------------------------------------- lists */

  var TAB_DEFS = {
    pending: { label: 'Pending', state: 'pending', empty: 'Nothing is waiting. The box is empty.', stat: 'pending' },
    flagged: { label: 'Needs you', state: 'flagged', empty: 'Nothing flagged. Nobody needs your opinion right now.', stat: 'flagged' },
    published: { label: 'Published', state: 'published', empty: 'No published entries match.', stat: 'published' },
    rejected: { label: 'Rejected', state: 'rejected', empty: 'No rejected entries.', stat: 'rejected' },
    merged: { label: 'Merged', state: 'merged', empty: 'No merged entries.', stat: 'merged' },
    tasks: { label: 'My tasks', source: 'owner', empty: 'No tasks yet. Add one above.', stat: 'private' }
  };

  function renderList(tab, container, token) {
    var def = TAB_DEFS[tab];
    var f = { q: '', type: '', tag: '', status: '', sort: 'newest', offset: 0 };
    var results = h('div', { class: 'results', 'aria-live': 'polite' });
    var pager = h('div', { class: 'pager' });
    var seq = 0;

    var q = h('input', { type: 'search', 'aria-label': 'Search', placeholder: 'Search title, details, comments' });
    var type = selectOf(TYPES, '', 'All types');
    type.setAttribute('aria-label', 'Filter by type');
    var tagSel = h('select', { 'aria-label': 'Filter by tag' }, option('', 'All tags'));
    S.tags.forEach(function (t) { tagSel.appendChild(option(t.tag, '#' + t.tag + ' (' + t.count + ')')); });
    var status = tab === 'published' ? selectOf(STATUSES, '', 'Any status') : null;
    if (status) status.setAttribute('aria-label', 'Filter by status');
    var sort = tab === 'published' ? selectOf({ newest: 'Newest first', votes: 'Most votes' }, 'newest') : null;
    if (sort) sort.setAttribute('aria-label', 'Sort');
    var bar = h('div', { class: 'toolbar', role: 'search' }, q, type, tagSel, status, sort);
    var parts = [];
    if (tab === 'tasks' && !S.readOnly) parts.push(newTaskForm(function (entry) { load(); refreshStats(); rememberTags(entry && entry.tags); }));
    parts.push(bar, results, pager);
    fill(container, parts);

    function query(offset, limit) {
      var o = { limit: limit, offset: offset, type: f.type, tag: f.tag, q: f.q.trim() };
      if (def.state) o.state = def.state;
      if (f.status) o.status = f.status;
      o.sort = tab === 'pending' ? 'oldest' : (f.sort || 'newest');
      if (def.source) o.source = def.source;
      return o;
    }
    function load() {
      var mine = ++seq;
      var p = api('admin.entries', { query: query(f.offset, PAGE) });
      p.then(function (r) {
        if (mine !== seq || token !== renderToken) return;
        fill(results, r.entries.length ? r.entries.map(function (e) {
          return EntryCard(e, { goLog: function (id) { showLog({ entry: id }); } });
        }) : h('p', { class: 'empty', text: (f.q || f.type || f.tag || f.status) ? 'Nothing matches these filters.' : def.empty }));
        drawPager(r.total, r.entries.length);
        say(plural(r.total, 'entry', 'entries') + ' shown.');
      }, function (err) {
        if (mine !== seq || token !== renderToken) return;
        fill(results, h('p', { class: 'notice bad', text: errText(err) }));
      });
    }
    function drawPager(total, shown) {
      if (total <= PAGE) { fill(pager, h('span', { class: 'muted small', text: plural(total, 'entry', 'entries') })); return; }
      var from = f.offset + 1;
      fill(pager,
        button('Previous', function () { f.offset = Math.max(0, f.offset - PAGE); load(); }, 'small', { disabled: f.offset === 0 }),
        h('span', { class: 'muted', text: from + '–' + (f.offset + shown) + ' of ' + total }),
        button('Next', function () { f.offset += PAGE; load(); }, 'small', { disabled: f.offset + PAGE >= total }));
    }
    function changed() { f.offset = 0; load(); }
    q.addEventListener('input', debounce(function () { f.q = q.value; changed(); }, 300));
    type.addEventListener('change', function () { f.type = type.value; changed(); });
    tagSel.addEventListener('change', function () { f.tag = tagSel.value; changed(); });
    if (status) status.addEventListener('change', function () { f.status = status.value; changed(); });
    if (sort) sort.addEventListener('change', function () { f.sort = sort.value; changed(); });
    load();
  }

  function newTaskForm(onCreated) {
    var type = selectOf(TYPES, 'idea');
    var title = h('input', { type: 'text', maxlength: '120', required: true });
    var body = h('textarea', { rows: '3', maxlength: '2000' });
    var status = selectOf(STATUSES, 'open');
    var pub = h('input', { type: 'checkbox', id: 'task-public' });
    var tags = TagEditor([], 'Add a tag to the new task');
    var msg = h('p', { class: 'notice', role: 'status' });
    var createBtn = h('button', { type: 'submit', class: 'btn primary', text: 'Create task' });
    var form = h('form', { class: 'panel-body task-form' },
      h('div', { class: 'grid2' }, field('Type', type), field('Status', status)),
      field('Title', title), field('Details', body),
      h('div', { class: 'field' }, h('span', { class: 'label', text: 'Tags' }), tags.el),
      h('div', { class: 'field check' }, pub, h('label', { for: 'task-public', text: 'Public (visitors see it in the widget as "From the team")' })),
      h('div', { class: 'row' }, createBtn), msg);
    var creating = false;
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (creating) return;
      creating = true;
      createBtn.disabled = true;
      msg.className = 'notice';
      msg.textContent = '';
      api('admin.create', { body: { type: type.value, title: title.value, body: body.value, status: status.value, tags: tags.get(), public: pub.checked } }).then(function (r) {
        msg.className = 'notice ok';
        msg.textContent = 'Created #' + r.entry.id + (pub.checked ? ' (public).' : ' (private).');
        title.value = '';
        body.value = '';
        tags.set([]);
        pub.checked = false;
        creating = false;
        createBtn.disabled = false;
        onCreated(r.entry);
      }, function (err) {
        creating = false;
        createBtn.disabled = false;
        msg.className = 'notice bad';
        msg.textContent = errText(err);
      });
    });
    return h('details', { class: 'panel new-task' }, h('summary', { text: 'New task' }), form);
  }

  /* ---------------------------------------------------------------- dashboard */

  function renderDashboard(container, token) {
    fill(container, h('p', { class: 'muted', text: 'Loading...' }));
    Promise.all([api('admin.stats'), api('admin.runs', { query: { limit: 1 } })]).then(function (res) {
      if (token !== renderToken) return;
      var st = res[0];
      S.stats = st;
      drawNav();
      var c = st.counts;
      var tiles = [
        ['pending', 'Pending', c.pending, 'pending'],
        ['flagged', 'Needs you', c.flagged, 'flagged'],
        ['published', 'Published', c.published, 'published'],
        ['rejected', 'Rejected', c.rejected, 'rejected'],
        ['merged', 'Merged', c.merged, 'merged'],
        ['tasks', 'Private tasks', c.private, 'tasks']
      ];
      var run = st.last_run;
      var hint = c.pending > 0
        ? h('div', { class: 'callout warn', role: 'note' },
          h('strong', { text: 'Pending: ' + c.pending + ' waiting for triage. ' }),
          'Ask Claude Code to “empty the ArghBox”, or ',
          h('button', { type: 'button', class: 'linklike', text: 'review them yourself', onclick: function () { showTab('pending'); } }), '.')
        : h('div', { class: 'callout ok', role: 'note', text: 'Nothing is waiting for triage.' });
      fill(container,
        hint,
        h('ul', { class: 'tiles' }, tiles.map(function (t) {
          return h('li', null, h('button', { type: 'button', class: 'tile tile-' + t[0], 'data-tile': t[0], onclick: function () { showTab(t[3]); } },
            h('span', { class: 'tile-n', text: String(t[2]) }), h('span', { class: 'tile-l', text: t[1] })));
        })),
        h('ul', { class: 'tiles small-tiles' },
          h('li', null, h('div', { class: 'tile static', 'data-tile': 'votes' }, h('span', { class: 'tile-n', text: String(st.votes) }), h('span', { class: 'tile-l', text: 'Votes in total' }))),
          h('li', null, h('div', { class: 'tile static', 'data-tile': 'week' }, h('span', { class: 'tile-n', text: String(st.entries_last_7_days) }), h('span', { class: 'tile-l', text: 'New entries, last 7 days' })))),
        h('section', { class: 'card last-run' },
          h('h2', { text: 'Last triage run' }),
          run ? [
            h('p', { class: 'muted' }, 'Run #' + run.id + ' by ' + run.reviewer + ', ', time(run.at)),
            countsEl(run.counts),
            run.digest ? h('p', { class: 'pre digest', text: run.digest }) : h('p', { class: 'muted', text: 'No digest.' }),
            h('p', null, button('Show its actions', function () { showLog({ run: run.id }); }, 'small'))
          ] : h('p', { class: 'muted', text: 'No triage run yet. Ask Claude Code to “empty the ArghBox”.' })),
        connectPanel());
    }, function (err) {
      if (token !== renderToken) return;
      fill(container, h('p', { class: 'notice bad', text: errText(err) }));
    });
  }
  function countsEl(counts) {
    var ul = h('ul', { class: 'run-counts' });
    Object.keys(counts || {}).forEach(function (k) {
      if (counts[k]) ul.appendChild(h('li', null, chip(k + ' ' + counts[k], k === 'skipped' ? 'muted' : '')));
    });
    return ul;
  }

  /** A text box with a Copy button. */
  function copyBox(label, text, id) {
    var status = h('span', { class: 'copy-status', role: 'status' });
    var code = h('code', { class: 'copy-text', id: id, text: text });
    var btn = button('Copy', function () {
      copyText(text).then(function (ok) { status.textContent = ok ? 'Copied.' : 'Copy failed. Select the text and copy it by hand.'; });
    }, 'small', { 'aria-label': 'Copy ' + label });
    return h('div', { class: 'copy-box' }, code, h('div', { class: 'row' }, btn, status));
  }

  function connectPanel() {
    var base = new URL('../', document.baseURI).href;
    var mcpCmd = 'claude mcp add --transport http arghbox ' + base + 'mcp.php --header "Authorization: Bearer <YOUR_TRIAGE_TOKEN>"';
    var feedUrl = new URL('../api.php?action=feed', document.baseURI).href;
    return h('details', { class: 'card connect' },
      h('summary', { text: 'Connect your AI' }),
      h('div', { class: 'connect-body' },
        h('section', null,
          h('h3', { text: 'Triage skill (Claude Code)' }),
          h('p', null, 'With the arghbox-triage skill installed in your site repository, just ask Claude Code to \u201cempty the ArghBox\u201d. Or run it yourself:'),
          h('p', null, h('code', { text: 'node .claude/skills/arghbox-triage/triage.mjs fetch' }))),
        h('section', null,
          h('h3', { text: 'MCP server' }),
          h('p', null, 'Let Claude Code, Cursor or any MCP client read and triage the box. Replace the placeholder with your triage token; this page never knows it.'),
          copyBox('the MCP command', mcpCmd, 'mcp-command'),
          h('p', { class: 'muted small' }, 'A read-only token (read_token_sha256 in config.php) gives a client the read tools only. Run ',
            h('code', { text: 'triage.mjs mcp-config' }), ' to print this command and a no-paste setup that reads the token from ', h('code', { text: '.arghbox/token' }), '.')),
        h('section', null,
          h('h3', { text: 'Atom feed' }),
          h('p', null, 'The published backlog as a feed, for a feed reader, Slack or Zapier.'),
          copyBox('the feed URL', feedUrl, 'feed-url'))));
  }

  /* -------------------------------------------------------------------- export */

  var EXPORT_STATES = { '': 'All except rejected', published: 'Published', pending: 'Pending', flagged: 'Needs you', rejected: 'Rejected', merged: 'Merged', private: 'My private tasks' };

  function exportMenu() {
    var state = selectOf(EXPORT_STATES, '');
    state.id = 'export-state';
    function href(format) {
      var qs = new URLSearchParams({ action: 'admin.export', format: format });
      if (state.value && format !== 'jira-csv') qs.set('state', state.value);
      return API_URL + '?' + qs.toString();
    }
    var links = [
      ['json', 'JSON (everything)', 'Entries, comments, tags and runs: all you need to move to another tool.'],
      ['csv', 'CSV (Excel)', 'One row per entry, UTF-8 with BOM so Excel opens it correctly.'],
      ['jira-csv', 'Jira CSV', 'Open, planned and in progress items with Jira\u2019s import columns.']
    ].map(function (x) {
      var a = h('a', { class: 'export-link', 'data-format': x[0], href: href(x[0]), download: '' },
        h('strong', { text: x[1] }), h('span', { class: 'muted small', text: x[2] }));
      return { a: a, format: x[0] };
    });
    state.addEventListener('change', function () { links.forEach(function (l) { l.a.setAttribute('href', href(l.format)); }); });
    var menu = h('details', { class: 'export-menu' },
      h('summary', { class: 'btn small ghost', text: 'Export' }),
      h('div', { class: 'export-pop' },
        h('div', { class: 'field inline' }, h('label', { for: 'export-state', text: 'Entries' }), state),
        h('div', { class: 'export-links' }, links.map(function (l) { return l.a; })),
        h('p', { class: 'muted small', text: 'Jira: Jira \u2192 System \u2192 External system import \u2192 CSV. (The Jira file ignores the entries filter.)' })));
    // The download starts from the link; close the menu behind it.
    links.forEach(function (l) { l.a.addEventListener('click', function () { setTimeout(function () { menu.open = false; }, 0); }); });
    return menu;
  }

  /* ---------------------------------------------------------------------- log */

  var logFilter = { view: 'actions', run: '', entry: '', offset: 0 };

  function showLog(filter) {
    logFilter = { view: filter && filter.view || 'actions', run: filter && filter.run || '', entry: filter && filter.entry || '', offset: 0 };
    showTab('log');
  }

  function renderLog(container, token) {
    var views = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Log view' },
      ['actions', 'runs'].map(function (v) {
        return h('button', { type: 'button', class: 'seg' + (logFilter.view === v ? ' on' : ''), 'aria-pressed': logFilter.view === v ? 'true' : 'false', 'data-view': v, text: v === 'actions' ? 'Actions' : 'Runs',
          onclick: function () { logFilter.view = v; renderLog(container, token); } });
      }));
    var body = h('div', { class: 'log-body' });
    fill(container, views, body);
    if (logFilter.view === 'runs') renderRuns(body, token);
    else renderActions(body, token, container);
  }

  function renderActions(body, token) {
    var runSel = h('select', { 'aria-label': 'Filter by run' }, option('', 'All runs and edits'));
    var holder = h('div', { class: 'results', 'aria-live': 'polite' });
    var pager = h('div', { class: 'pager' });
    var chipRow = h('div', { class: 'filter-chips' });
    fill(body, h('div', { class: 'toolbar' }, runSel, chipRow), holder, pager);
    function drawChips() {
      fill(chipRow, logFilter.entry ? h('span', { class: 'chip' }, 'Entry #' + logFilter.entry,
        h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Clear entry filter', onclick: function () { logFilter.entry = ''; logFilter.offset = 0; load(); drawChips(); } }, '×')) : null);
    }
    function load() {
      api('admin.log', { query: { run_id: logFilter.run, entry_id: logFilter.entry, limit: 50, offset: logFilter.offset } }).then(function (r) {
        if (token !== renderToken) return;
        fill(holder, ActionList(r.actions, load));
        var total = r.total;
        if (total > 50) {
          fill(pager,
            button('Newer', function () { logFilter.offset = Math.max(0, logFilter.offset - 50); load(); }, 'small', { disabled: logFilter.offset === 0 }),
            h('span', { class: 'muted', text: (logFilter.offset + 1) + '–' + (logFilter.offset + r.actions.length) + ' of ' + total }),
            button('Older', function () { logFilter.offset += 50; load(); }, 'small', { disabled: logFilter.offset + 50 >= total }));
        } else fill(pager);
      }, function (err) { fill(holder, h('p', { class: 'notice bad', text: errText(err) })); });
    }
    api('admin.runs', { query: { limit: 50 } }).then(function (r) {
      r.runs.forEach(function (run) { runSel.appendChild(option(String(run.id), 'Run #' + run.id + ' (' + fmt(run.at) + ', ' + run.reviewer + ')')); });
      runSel.value = logFilter.run ? String(logFilter.run) : '';
    });
    runSel.addEventListener('change', function () { logFilter.run = runSel.value; logFilter.offset = 0; load(); });
    drawChips();
    load();
  }

  function renderRuns(body, token) {
    fill(body, h('p', { class: 'muted', text: 'Loading...' }));
    api('admin.runs', { query: { limit: 30 } }).then(function (r) {
      if (token !== renderToken) return;
      if (!r.runs.length) { fill(body, h('p', { class: 'empty', text: 'No triage runs yet.' })); return; }
      fill(body, h('ul', { class: 'runs' }, r.runs.map(function (run) {
        var msg = h('div', { class: 'notice', role: 'status' });
        // In-page confirmation (no window.confirm): focus moves to Cancel, Esc cancels, focus returns to the button.
        var confirmBox = h('div', { class: 'confirm', role: 'alertdialog', 'aria-labelledby': 'confirm-q-' + run.id, hidden: true });
        var undo = button('Undo this run', function () { askConfirm(); }, 'danger small');
        var closeConfirm = function () { confirmBox.hidden = true; clear(confirmBox); undo.hidden = false; undo.focus(); };
        var askConfirm = function () {
          undo.hidden = true;
          confirmBox.hidden = false;
          var yes = button('Yes, undo run #' + run.id, function () { closeConfirm(); doUndo(); }, 'danger small');
          var no = button('Cancel', closeConfirm, 'small');
          fill(confirmBox,
            h('p', { id: 'confirm-q-' + run.id, text: 'Undo every action of run #' + run.id + '? Actions that were changed afterwards are skipped and listed.' }),
            h('div', { class: 'row' }, yes, no));
          confirmBox.onkeydown = function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); closeConfirm(); } };
          no.focus();
        };
        var doUndo = function () {
          api('admin.undo', { body: { run_id: run.id } }).then(function (res) {
            var text = 'Undone: ' + res.undone.length + (res.refused.length ? '. Refused: ' + res.refused.length : '.');
            fill(msg, text, res.refused.length ? h('ul', { class: 'refusals' }, res.refused.map(function (x) {
              return h('li', { text: 'Action ' + x.action_id + ': ' + x.reason });
            })) : null);
            msg.className = 'notice ' + (res.refused.length ? 'warn' : 'ok');
            refreshStats();
          }, function (err) { msg.className = 'notice bad'; msg.textContent = errText(err); });
        };
        return h('li', { class: 'card run', 'data-run': run.id },
          h('div', { class: 'run-head' }, h('strong', { text: 'Run #' + run.id }), ' ', h('span', { class: 'muted' }, run.reviewer + ' · ', time(run.at))),
          countsEl(run.counts),
          run.digest ? h('p', { class: 'pre digest', text: run.digest }) : null,
          h('div', { class: 'row' }, button('Show actions', function () { showLog({ run: run.id }); }, 'small'), S.readOnly ? null : undo),
          S.readOnly ? null : confirmBox,
          msg);
      })));
    }, function (err) { fill(body, h('p', { class: 'notice bad', text: errText(err) })); });
  }

  /* ----------------------------------------------------------- shell and nav */

  var TAB_ORDER = ['dashboard', 'pending', 'flagged', 'published', 'rejected', 'merged', 'tasks', 'log'];
  var TAB_LABELS = { dashboard: 'Dashboard', log: 'Log' };

  function tabLabel(t) { return TAB_LABELS[t] || TAB_DEFS[t].label; }

  function drawNav() {
    if (!navEl) return;
    fill(navEl, TAB_ORDER.map(function (t) {
      var count = null;
      if (S.stats && TAB_DEFS[t]) count = S.stats.counts[TAB_DEFS[t].stat];
      var cls = 'tab' + (S.tab === t ? ' on' : '') + (t === 'pending' && count > 0 ? ' urgent' : '');
      return h('button', { type: 'button', class: cls, role: 'tab', id: 'tab-' + t, 'data-tab': t, 'aria-selected': S.tab === t ? 'true' : 'false', 'aria-controls': 'main',
        onclick: function () { showTab(t); } },
        tabLabel(t), count !== null ? h('span', { class: 'badge', text: String(count), 'aria-label': count + ' entries' }) : null);
    }));
  }

  function showTab(tab) {
    S.tab = tab;
    if (tab !== 'log') logFilter = { view: 'actions', run: '', entry: '', offset: 0 };
    try { history.replaceState(null, '', '#' + tab); } catch (e) { /* ignore */ }
    drawNav();
    var token = ++renderToken;
    main.setAttribute('aria-labelledby', 'tab-' + tab);
    if (headingEl) headingEl.textContent = 'ArghBox admin: ' + tabLabel(tab);
    fill(main);
    if (tab === 'dashboard') renderDashboard(main, token);
    else if (tab === 'log') renderLog(main, token);
    else renderList(tab, main, token);
  }

  function showApp() {
    var siteNameEl = h('span', { class: 'site-name', text: S.site.name || '' });
    var header = h('header', { class: 'top' },
      h('a', { class: 'brand', href: './', 'aria-label': 'ArghBox admin' }, h('img', { src: 'logo.svg', alt: '', width: '32', height: '32' }), h('span', { class: 'brand-name', text: 'ArghBox' })),
      siteNameEl,
      h('span', { class: 'spacer' }),
      exportMenu(),
      button('Sign out', signOut, 'small ghost'));
    navEl = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections' });
    main = h('div', { id: 'main', class: 'main', role: 'tabpanel', tabindex: '-1' });
    headingEl = h('h1', { class: 'sr-only', text: 'ArghBox admin' });
    liveEl = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    var banner = h('div', { class: 'callout warn', role: 'alert', hidden: !S.vocabFailed });
    function drawBanner() {
      banner.hidden = !S.vocabFailed;
      fill(banner, S.vocabFailed ? [
        h('strong', { text: 'Could not load the site name and the tag list. ' }),
        button('Retry', function () {
          loadVocabulary().then(function () {
            S.vocabFailed = false;
            drawBanner();
            siteNameEl.textContent = S.site.name || '';
            document.title = (S.site.name ? S.site.name + ' – ' : '') + 'ArghBox admin';
            showTab(S.tab);
          }, function (err) { say('Retry failed: ' + errText(err)); });
        }, 'small')] : null);
    }
    drawBanner();
    fill(root, header, h('nav', { 'aria-label': 'Sections' }, navEl), h('main', null, banner, headingEl, main), liveEl);
    document.title = (S.site.name ? S.site.name + ' – ' : '') + 'ArghBox admin';
    var start = (location.hash || '').replace('#', '');
    showTab(TAB_ORDER.indexOf(start) !== -1 ? start : 'dashboard');
    refreshStats();
  }

  function signOut() {
    api('admin.logout', { body: {} }).then(done, done);
    function done() {
      csrf = '';
      S.stats = null;
      showLogin('You are signed out.', 'ok');
    }
  }

  /* ------------------------------------------------------------------ sign-in */

  function showLogin(message, kind, extra) {
    renderToken++;
    main = navEl = liveEl = headingEl = null;
    document.title = 'ArghBox admin';
    var token = h('input', { type: 'password', id: 'token', name: 'token', autocomplete: 'current-password', required: true, spellcheck: 'false', autocapitalize: 'off' });
    var msg = h('p', { class: 'notice' + (message ? ' ' + (kind || 'bad') : ''), id: 'login-msg', role: 'alert' }, message || '', extra || null);
    var submit = h('button', { type: 'submit', class: 'btn primary wide', text: 'Sign in' });
    var form = h('form', { class: 'login-card', novalidate: true },
      h('img', { src: 'logo.svg', alt: '', width: '64', height: '64', class: 'login-logo' }),
      h('h1', { text: 'ArghBox admin' }),
      h('p', { class: 'muted', text: 'Sign in with your owner token.' }),
      h('div', { class: 'field' }, h('label', { for: 'token', text: 'Owner token' }), token),
      submit, msg);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!token.value.trim()) { setMsg('Paste your owner token first.'); return; }
      submit.disabled = true;
      api('admin.login', { body: { token: token.value.trim() } }).then(function (r) {
        csrf = r.csrf;
        return boot(true);
      }, function (err) {
        submit.disabled = false;
        loginError(err);
      });
    });
    function setMsg(text, kind2, extra2) {
      fill(msg, text, extra2 || null);
      msg.className = 'notice ' + (kind2 || 'bad');
    }
    function loginError(err) {
      if (err.code === 'not_configured') setMsg(errText(err) + ' Open ', 'bad', [h('a', { href: API_URL + '?action=health', target: '_blank', rel: 'noopener', text: 'api.php?action=health' }), ' to see what is missing.']);
      else if (err.code === 'rate_limited') setMsg('Too many attempts. Try again later.');
      else if (err.status === 401) setMsg('That token is not right. Check it and try again.');
      else setMsg(errText(err));
    }
    fill(root, h('main', { class: 'login' }, form));
    token.focus();
  }

  /* --------------------------------------------------------------------- boot */

  function boot(afterLogin) {
    return api('admin.me').then(function (me) {
      if (me.csrf) csrf = me.csrf;
      S.readOnly = me.actor === 'read';
      // The site name and the tag vocabulary come from admin.queue, which can be big and slow on a large backlog.
      // Failing to load it must never throw a signed-in owner back to the sign-in form: show the app with a retry banner.
      S.vocabFailed = false;
      return loadVocabulary().then(null, function (err) {
        if (err && err.status === 401) throw err;
        S.vocabFailed = true;
      });
    }).then(showApp, function (err) {
      if (err.status === 401) { showLogin(afterLogin ? 'Signed in, but the session cookie was not accepted. Are cookies blocked?' : ''); return; }
      if (err.code === 'not_configured') {
        showLogin(errText(err) + ' Open ', 'bad', [h('a', { href: API_URL + '?action=health', target: '_blank', rel: 'noopener', text: 'api.php?action=health' }), ' to see what is missing.']);
        return;
      }
      showLogin(errText(err));
    });
  }

  onUnauthorized = function () {
    if (main) { csrf = ''; showLogin('Your session ended. Sign in again.', 'bad'); }
  };

  boot(false);
})();
