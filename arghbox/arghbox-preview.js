/*! ArghBox 0.1.0 | local preview | MIT | arghbox.com */
// The local preview (SPEC section 8): the dialog loads this file only on a local dev host (localhost, 127.0.0.1,
// [::1], *.localhost) when no ArghBox answered its first request (no server, no PHP, no config.php). It answers the
// widget's API calls in memory with sample entries, so a site can try its integration (where the tab sits, colours,
// #arghbox links, ArghBox.open()) before a real box exists. Nothing is saved: a reload starts over.
// window.ArghBoxConfig = {localPreview: false} turns it off. Production sites never load it.
(function (window) {
  'use strict';

  var DOCS = 'https://github.com/BinaryBananaLLC/ArghBox/blob/main/docs/install.md#test-on-your-computer';

  // Returns the widget's call(action, body) for the preview. api: the URL that did not answer; code: how it failed.
  window.__arghboxPreview = function (api, code) {
    api = String(api).replace(/^https?:\/\//, ''); // shown as text: the dialog links only the docs
    var why = code === 'not_configured' ? 'the ArghBox at ' + api + ' has no config.php yet'
      : code === 'network' ? 'no ArghBox server answered at ' + api
      : 'the answer from ' + api + ' was not ArghBox (is PHP running there?)';
    var note = 'Local preview: ' + why + '. These are sample entries and nothing is saved. To test with a real box: ' + DOCS;
    try { window.console.info('[ArghBox] ' + note); } catch (e) { }

    var now = Date.now();
    function ago(days) { return new Date(now - days * 864e5).toISOString().slice(0, 19) + 'Z'; }
    // Ids far above a real box's, so ids this browser remembers (votes, reports) never touch a real entry later.
    var next = 900101;
    function entry(type, title, body, votes, tags, extra) {
      var e = {
        id: next++, type: type, title: title, body: body, status: 'open', status_at: null, votes: votes, similar: 0,
        aliases: [], tags: tags, comments: [], source: 'visitor', created_at: ago(40 - next % 40)
      };
      for (var k in extra) e[k] = extra[k];
      return e;
    }
    var entries = [
      entry('idea', 'Dark mode', 'The site is very bright at night. A dark theme that follows the system setting would be great.', 24, ['design'], {
        status: 'planned', status_at: ago(6), similar: 2, aliases: ['Night theme', 'Darker colours'],
        comments: [{ at: ago(6), body: 'Planned for the next release. Thanks for all the votes!' }]
      }),
      entry('idea', 'Export my results as CSV', 'So I can open them in a spreadsheet.', 17, ['export'], {}),
      entry('bug', 'Search ignores accents', 'Searching for "cafe" does not find "Café".', 9, ['search'], { status: 'in_progress', status_at: ago(2) }),
      entry('idea', 'Share a link to a single result', 'One link that opens exactly what I am looking at.', 6, ['sharing'], { source: 'owner', status: 'planned', status_at: ago(9) }),
      entry('question', 'Is there a mobile app?', '', 5, [], { comments: [{ at: ago(12), body: 'Not yet. The site works in the browser on phones.' }] }),
      entry('idea', 'Keyboard shortcuts', 'Arrow keys to move between results, Enter to open one.', 4, ['design'], {}),
      entry('bug', 'Menu covers the page on small phones', 'On a 360 px wide screen the menu does not close after a tap.', 3, ['mobile'], {
        status: 'done', status_at: ago(3), comments: [{ at: ago(3), body: 'Fixed. Thanks for the report!' }]
      }),
      entry('idea', 'A desktop app', '', 2, [], {
        status: 'declined', status_at: ago(20), comments: [{ at: ago(20), body: 'We keep it in the browser, so it works everywhere without installing anything.' }]
      })
    ];
    var voted = {};

    function byId(id) { return entries.filter(function (e) { return e.id === id; })[0]; }
    function copy(x) { return JSON.parse(JSON.stringify(x)); }
    function tagCounts() {
      var n = {};
      entries.forEach(function (e) { e.tags.forEach(function (g) { n[g] = (n[g] || 0) + 1; }); });
      return Object.keys(n).sort(function (a, b) { return n[b] - n[a] || (a < b ? -1 : 1); }).map(function (g) { return { tag: g, count: n[g] }; });
    }
    function answer(action, body) {
      if (action === 'list') {
        return {
          ok: true, site: {}, welcome: note, max_links: 2, version: '0.1.0', turnstile_site_key: '', moderation: 'publish',
          credit: true, contact: '', app_pass: true, entries: copy(entries), tag_counts: tagCounts(),
          voted: Object.keys(voted).filter(function (id) { return voted[id]; }).map(Number)
        };
      }
      if (action === 'session') return { ok: true, pass: 'preview', expires_in: 1800 };
      if (action === 'vote') {
        var e = byId(body.id);
        if (!e) throw { code: 'not_found' };
        if (!!voted[e.id] !== !!body.on) { voted[e.id] = body.on ? 1 : 0; e.votes += body.on ? 1 : -1; }
        return { ok: true, id: e.id, votes: e.votes, voted: !!voted[e.id] };
      }
      if (action === 'add') {
        var title = String(body.title || '').replace(/\s+/g, ' ').trim();
        if (title.length < 4 || title.length > 120) throw { code: 'invalid_input', field: 'title' };
        if (String(body.body || '').length > 2000) throw { code: 'invalid_input', field: 'body' };
        var added = entry(body.type, title, String(body.body || ''), 1, [], { created_at: new Date().toISOString().slice(0, 19) + 'Z' });
        entries.push(added);
        voted[added.id] = 1;
        added = copy(added);
        added.state = 'published';
        return { ok: true, entry: added };
      }
      if (action === 'mine') return { ok: true, entries: [] };
      if (action === 'report') return { ok: true };
      throw { code: 'not_found' };
    }

    return function (action, body) {
      return new Promise(function (resolve, reject) {
        // a short pause, so busy states and the spinner show as they would with a server
        setTimeout(function () {
          try { resolve(answer(action, body)); } catch (e) { reject(e); }
        }, 120);
      });
    };
  };
})(window);
