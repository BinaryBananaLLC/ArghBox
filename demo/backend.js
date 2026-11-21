/*
 * ArghBox demo backend. A demo-only stand-in for arghbox/api.php: it answers the widget, the admin page and the
 * mobile app page in the browser and keeps a fake box (Contoso Tasks) in this browser's localStorage. It is never
 * used by a real install. Load it with a plain <script> before the ArghBox scripts.
 *
 * It ports the logic of arghbox/lib/*.php (same fields, status codes, error codes and messages). What a demo cannot
 * have is replaced: the visitor is always the same "network" (author hash 7c3e9a1f), there are no rate limits, any
 * Turnstile token (or {app: true}) gets a pass, and a fast form is not treated as a bot.
 */
(function () {
  'use strict';

  var VERSION = '0.1.2'; // rewritten by tools/set-version.mjs
  var PASSWORD = 'demo';
  var SCHEMA = 1;
  var STATE_KEY = 'arghbox-demo:v1';
  var ADMIN_KEY = 'arghbox-demo:admin';
  var API_SUFFIX = '/arghbox/api.php';
  var VISITOR_IP = '7c3e9a1f'; // the "IP hash" of the person using the demo
  var SITE_KEY = '1x00000000000000000000AA'; // Cloudflare's always-passes test key

  var TYPES = ['idea', 'bug', 'question'];
  var STATES = ['pending', 'published', 'rejected', 'merged', 'flagged', 'private'];
  var REJECT_REASONS = ['spam', 'abuse', 'off_topic', 'test', 'unclear', 'other'];
  var REPORT_REASONS = ['spam', 'abusive', 'off_topic', 'other'];
  var STATUSES = ['open', 'planned', 'in_progress', 'done', 'declined'];
  var MUTABLE = ['state', 'status', 'status_at', 'type', 'title', 'body', 'merged_into', 'reject_reason', 'tags', 'external_url', 'ai'];

  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  var memory = {};
  var broken = false;
  var clock = null; // set while seeding, so the seeded history is in the past

  // ---- Small helpers --------------------------------------------------------

  function AbError(status, code, message, field, retryAfter) {
    this.status = status;
    this.code = code;
    this.message = message;
    this.field = field === undefined ? null : field;
    this.retryAfter = retryAfter === undefined ? null : retryAfter;
  }
  function invalid(field, message) { return new AbError(400, 'invalid_input', message, field); }
  function notFound(what) { return new AbError(404, 'not_found', what || 'That entry does not exist.'); }

  function clone(x) { return x === undefined ? null : JSON.parse(JSON.stringify(x)); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isSet(v) { return v !== undefined && v !== null; }
  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function len(s) { return Array.from(s).length; }
  function truncate(s, max) { return len(s) <= max ? s : Array.from(s).slice(0, max).join(''); }
  function nowMs() { return clock === null ? Date.now() : clock; }
  function iso(ms) { return new Date(ms === undefined ? nowMs() : ms).toISOString().slice(0, 19) + 'Z'; }
  function rand(n) {
    var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_', s = '';
    for (var i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  }
  // A short fingerprint of a string (not a security hash: the demo has nothing to protect).
  function hash16(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return ('00000000' + (h2 >>> 0).toString(16)).slice(-8) + ('00000000' + (h1 >>> 0).toString(16)).slice(-8);
  }

  // ---- Storage (localStorage, with a memory fallback) -------------------------

  function read(key) {
    if (!broken) {
      try { return window.localStorage.getItem(key); } catch (e) { broken = true; }
    }
    return has(memory, key) ? memory[key] : null;
  }
  function write(key, value) {
    if (!broken) {
      try { window.localStorage.setItem(key, value); return; } catch (e) { broken = true; }
    }
    memory[key] = value;
  }
  function remove(key) {
    if (!broken) {
      try { window.localStorage.removeItem(key); } catch (e) { broken = true; }
    }
    delete memory[key];
  }

  function nextId(st, table) {
    var id = st.next[table];
    st.next[table] = id + 1;
    return id;
  }

  // ---- Validation and cleaning (security.php, entries.php) ----------------------

  var INVISIBLE = '\\p{Cc}\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF';
  var RE_INVISIBLE = new RegExp('[' + INVISIBLE + ']', 'gu');
  var RE_INVISIBLE_KEEP_NL = new RegExp('(?!\\n)[' + INVISIBLE + ']', 'gu');

  function cleanTitle(v) {
    if (typeof v !== 'string') throw invalid('title', 'Please give it a title.');
    var s = v.replace(/\p{Cc}+/gu, ' ').replace(RE_INVISIBLE, '').replace(/\s+/gu, ' ').trim();
    var n = len(s);
    if (n < 4) throw invalid('title', 'The title is too short (at least 4 characters).');
    if (!/[\p{L}\p{N}]/u.test(s)) throw invalid('title', 'The title needs at least one letter or digit.');
    if (n > 120) throw invalid('title', 'The title is too long (at most 120 characters).');
    return s;
  }
  function cleanBody(v) {
    if (!isSet(v)) return '';
    if (typeof v !== 'string') throw invalid('body', 'The details must be text.');
    var s = v.replace(/\r\n|\r/g, '\n').replace(/\t/g, ' ').replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
    s = s.replace(RE_INVISIBLE_KEEP_NL, '').trim();
    if (len(s) > 2000) throw invalid('body', 'The details are too long (at most 2000 characters).');
    return s;
  }
  function checkLinks(title, body, max) {
    var m = (title + '\n' + body).match(/https?:\/\/\S+|(?<![A-Za-z0-9.-])www\.\S+/gi);
    if ((m ? m.length : 0) > max) throw invalid('body', 'Too many links. At most ' + max + ' allowed.');
  }
  function cleanContext(ctx) {
    var out = {};
    if (!isObject(ctx)) return out;
    if (typeof ctx.page === 'string') {
      var p = ctx.page.split(/[?#]/)[0].replace(/[\x00-\x1F\x7F]/g, '');
      if (p !== '' && p.charAt(0) === '/') out.page = truncate(p, 200);
    }
    if (typeof ctx.lang === 'string' && /^[A-Za-z-]{1,12}$/.test(ctx.lang)) out.lang = ctx.lang;
    ['browser', 'os'].forEach(function (k) {
      if (typeof ctx[k] === 'string') {
        var s = ctx[k].replace(RE_INVISIBLE, '').trim();
        if (s !== '') out[k] = truncate(s, 40);
      }
    });
    if (['small', 'medium', 'large'].indexOf(ctx.screen) >= 0) out.screen = ctx.screen;
    if (isObject(ctx.app)) {
      var app = {};
      if (['ios', 'android', 'other'].indexOf(ctx.app.platform) >= 0) app.platform = ctx.app.platform;
      if (typeof ctx.app.version === 'string' && /^[0-9A-Za-z._+-]{1,20}$/.test(ctx.app.version)) app.version = ctx.app.version;
      if (Object.keys(app).length) out.app = app;
    }
    return out;
  }
  function cleanTags(v) {
    if (!isSet(v)) return [];
    if (!Array.isArray(v)) throw invalid('tags', 'Tags must be a list.');
    var seen = {}, out = [];
    v.forEach(function (t) {
      if (typeof t !== 'string') throw invalid('tags', 'Each tag must be text.');
      t = t.replace(RE_INVISIBLE, '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(t)) throw invalid('tags', 'A tag is 2 to 24 characters: a-z, 0-9 and hyphens.');
      if (!seen[t]) { seen[t] = true; out.push(t); }
    });
    if (out.length > 3) throw invalid('tags', 'At most 3 tags.');
    return out.sort();
  }
  function cleanUrl(v) {
    if (!isSet(v)) return null;
    if (typeof v !== 'string') throw invalid('external_url', 'The link must be text.');
    v = v.trim();
    if (v === '') return null;
    if (v.length > 500) throw invalid('external_url', 'The link is too long (at most 500 characters).');
    var u = null;
    try { u = new URL(v); } catch (e) { u = null; }
    // As strict as PHP's parse_url + FILTER_VALIDATE_URL: "scheme://", then a host of whole DNS labels or an IP.
    var host = /^https?:\/\/(?:[^@\/?#]*@)?(\[[0-9a-f:.]+\]|[^\/?#:]+)/i.exec(v);
    var label = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
    var okHost = !!host && (host[1].charAt(0) === '[' || host[1].split('.').every(function (l) { return label.test(l); }));
    if (/[\x00-\x20\x7F]/.test(v) || !u || !okHost || (u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || !u.hostname) {
      throw invalid('external_url', 'The link must be a valid http or https URL.');
    }
    return v;
  }
  function cleanReviewer(v) {
    var s = (typeof v === 'string' ? v : '').replace(/[^A-Za-z0-9 ._:+()\/-]/g, '').trim();
    return s === '' ? 'triage' : s.slice(0, 60);
  }
  function validVoter(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{22,64}$/.test(v); }
  function voterFrom(body) {
    if (!validVoter(body.voter)) throw invalid('voter', 'The voter key is missing or malformed.');
    return body.voter;
  }
  function checkPass(pass) {
    if (typeof pass !== 'string' || pass === '' || pass.length > 400) throw new AbError(401, 'pass_invalid', 'The pass is missing or invalid.');
  }
  function entryIdOf(body) {
    if (!isInt(body.id) || body.id < 1) throw invalid('id', 'The entry id is missing.');
    return body.id;
  }

  // ---- Rows and the shapes the API sends ----------------------------------------

  function entryRow(st, id) {
    for (var i = 0; i < st.entries.length; i++) if (st.entries[i].id === id) return st.entries[i];
    return null;
  }
  function commentRow(st, id) {
    for (var i = 0; i < st.comments.length; i++) if (st.comments[i].id === id) return st.comments[i];
    return null;
  }
  function actionRow(st, id) {
    for (var i = 0; i < st.actions.length; i++) if (st.actions[i].id === id) return st.actions[i];
    return null;
  }
  function openReportIds(st, entryId) {
    return st.reports.filter(function (r) { return r.entry_id === entryId && !r.cleared_at; }).map(function (r) { return r.id; });
  }
  function fingerprint(st, r) {
    var parts = [String(r.id), r.state, r.status, r.type, r.title, r.body, r.merged_into === null ? '' : String(r.merged_into)];
    var open = openReportIds(st, r.id);
    if (open.length) parts.push('r:' + open.join(','));
    return hash16(parts.join('|'));
  }
  function snapshot(r) {
    var s = {};
    MUTABLE.forEach(function (k) { s[k] = clone(isSet(r[k]) ? r[k] : null); });
    return s;
  }
  // Follow merged_into to the final (non-merged) target. null when the entry does not exist.
  function resolveTarget(st, id) {
    var cur = id;
    for (var i = 0; i < 50; i++) {
      var r = entryRow(st, cur);
      if (!r) return null;
      if (r.state !== 'merged' || r.merged_into === null) return r.id;
      cur = r.merged_into;
    }
    return null;
  }
  function recount(st, id) {
    var n = st.votes.filter(function (v) { return v.entry_id === id; }).length;
    entryRow(st, id).votes = n;
    return n;
  }
  function emptyReports() { return { open: 0, total: 0, reasons: { spam: 0, abusive: 0, off_topic: 0, other: 0 }, last_at: null }; }

  function activeBlocks(st) {
    var t = iso();
    return st.blocks.filter(function (b) { return !b.lifted_at && b.expires_at > t; });
  }
  function blocksMatch(blocks, authorHash, voterHash) {
    return blocks.filter(function (b) {
      return (authorHash !== '' && b.author_hash !== '' && b.author_hash === authorHash) ||
        (voterHash !== '' && b.voter_hash !== '' && b.voter_hash === voterHash);
    }).map(function (b) { return b.id; });
  }

  // Merged aliases, comments, reports and blocks, for rendering entries.
  function aliasInfo(st) {
    var ctx = { count: {}, titles: {}, pub: {}, all: {}, reports: {}, blocks: activeBlocks(st) };
    var merged = st.entries.filter(function (e) { return e.state === 'merged' && e.merged_into !== null; })
      .sort(function (a, b) { return b.id - a.id; });
    var map = {};
    merged.forEach(function (e) { map[e.id] = e.merged_into; });
    merged.forEach(function (e) {
      var t = e.merged_into;
      for (var i = 0; i < 50 && has(map, t); i++) t = map[t];
      ctx.count[t] = (ctx.count[t] || 0) + 1;
      if (!ctx.titles[t]) ctx.titles[t] = [];
      if (ctx.titles[t].length < 10) ctx.titles[t].push(e.title);
    });
    st.comments.slice().sort(function (a, b) { return a.id - b.id; }).forEach(function (c) {
      (ctx.all[c.entry_id] = ctx.all[c.entry_id] || []).push(commentOut(c));
      if (c.public && !c.hidden) {
        var pub = (ctx.pub[c.entry_id] = ctx.pub[c.entry_id] || []);
        if (pub.length < 20) pub.push({ body: c.body, at: c.created_at });
      }
    });
    st.reports.forEach(function (r) {
      var rep = (ctx.reports[r.entry_id] = ctx.reports[r.entry_id] || emptyReports());
      rep.total++;
      if (!r.cleared_at) {
        rep.open++;
        rep.reasons[r.reason]++;
        if (rep.last_at === null || r.created_at > rep.last_at) rep.last_at = r.created_at;
      }
    });
    return ctx;
  }
  function commentOut(c) {
    return { id: c.id, body: c.body, public: c.public, hidden: c.hidden, created_at: c.created_at, updated_at: c.updated_at };
  }
  function publicEntry(r, ctx) {
    return {
      id: r.id, type: r.type, title: r.title, body: r.body, votes: r.votes, status: r.status, status_at: r.status_at,
      tags: r.tags.slice(), comments: ctx.pub[r.id] || [], similar: ctx.count[r.id] || 0, aliases: ctx.titles[r.id] || [],
      source: r.source, created_at: r.created_at
    };
  }
  function adminEntry(st, r, ctx) {
    var e = publicEntry(r, ctx);
    e.comments = ctx.all[r.id] || [];
    e.state = r.state;
    e.merged_into = r.merged_into;
    e.reject_reason = r.reject_reason;
    e.external_url = r.external_url;
    e.title_original = r.title_original;
    e.body_original = r.body_original;
    e.context = clone(r.context);
    e.ai = clone(r.ai);
    e.author = r.author_hash.slice(0, 8);
    e.fingerprint = fingerprint(st, r);
    e.updated_at = r.updated_at;
    e.reports = ctx.reports[r.id] || emptyReports();
    e.author_blocked = ctx.blocks.length > 0 && blocksMatch(ctx.blocks, r.author_hash, r.author_voter).length > 0;
    return e;
  }
  function adminEntryOut(st, id) { return adminEntry(st, entryRow(st, id), aliasInfo(st)); }

  // ---- Creating and changing entries (entries.php, actions.php) -----------------

  function insertEntry(st, f) {
    var created = f.created_at || iso();
    var status = f.status || 'open';
    var row = {
      id: nextId(st, 'entry'), type: f.type, title: f.title, body: f.body, title_original: f.title, body_original: f.body,
      source: f.source || 'visitor', state: f.state, status: status,
      status_at: f.status_at || (status !== 'open' ? created : null), merged_into: f.merged_into || null,
      reject_reason: f.reject_reason || null, tags: f.tags || [], votes: 0, context: f.context || {}, ai: null,
      external_url: null, author_hash: f.author_hash || '', author_voter: f.author_voter || '', receipt: f.receipt || '',
      created_at: created, updated_at: created
    };
    st.entries.push(row);
    return row;
  }
  // Insert a vote unless the voter already has one on the entry. Returns the vote id or null.
  function insertVote(st, entryId, voter, ip, movedFrom, at) {
    var dup = st.votes.some(function (v) { return v.entry_id === entryId && v.voter === voter; });
    if (dup) return null;
    var id = nextId(st, 'vote');
    st.votes.push({ id: id, entry_id: entryId, voter: voter, ip: ip, moved_from: movedFrom || null, at: at || iso() });
    return id;
  }
  function insertComment(st, entryId, body, isPublic, at) {
    at = at || iso();
    var c = { id: nextId(st, 'comment'), entry_id: entryId, body: body, public: isPublic, hidden: false, created_at: at, updated_at: at };
    st.comments.push(c);
    return c;
  }
  function logAction(st, actor, runId, kind, entryId, before, after, at) {
    var a = {
      id: nextId(st, 'action'), at: at || iso(), actor: actor, run_id: runId, kind: kind, entry_id: entryId,
      before: before, after: after, undone_by: null
    };
    st.actions.push(a);
    return a.id;
  }
  function clearReports(st, ids, actionId) {
    var now = iso();
    st.reports.forEach(function (r) {
      if (ids.indexOf(r.id) >= 0 && !r.cleared_at) { r.cleared_at = now; r.cleared_by = actionId; }
    });
  }
  function reopenReports(st, ids, actionId) {
    st.reports.forEach(function (r) {
      if (ids.indexOf(r.id) >= 0 && r.cleared_by === actionId) { r.cleared_at = null; r.cleared_by = null; }
    });
  }

  // Change an entry and log one action row with before/after snapshots. Returns [row, action id].
  function change(st, row, changes, kind, actor, runId, afterExtra) {
    var before = snapshot(row);
    var now = iso();
    var extra = afterExtra || {};
    var clear = [];
    changes = Object.assign({}, changes);
    // Publishing an entry that was reviewed clears its open reports; undoing the action re-opens them.
    if (changes.state === 'published' && row.state !== 'published') {
      clear = openReportIds(st, row.id);
      if (clear.length) extra.cleared_report_ids = clear;
    }
    if (isSet(changes.status) && changes.status !== row.status && !has(changes, 'status_at')) changes.status_at = now;
    Object.keys(changes).forEach(function (k) { row[k] = changes[k]; });
    row.updated_at = now;
    var after = snapshot(row);
    Object.keys(extra).forEach(function (k) { after[k] = extra[k]; });
    var id = logAction(st, actor, runId, kind, row.id, before, after, now);
    if (clear.length) clearReports(st, clear, id);
    return [row, id];
  }

  // Validate a merge. Returns [final target id, null] or [null, reason].
  function mergeCheck(st, entryId, targetId) {
    if (!isInt(targetId) || targetId < 1) return [null, 'merge target is missing'];
    if (targetId === entryId) return [null, 'an entry cannot be merged into itself'];
    var final = resolveTarget(st, targetId);
    if (final === null) return [null, 'merge target does not exist'];
    if (final === entryId) return [null, 'this merge would create a cycle'];
    if (entryRow(st, final).state !== 'published') return [null, 'merge target is not published'];
    return [final, null];
  }
  // Merge entry A into the final target B (already validated); votes move by copy.
  function merge(st, row, target, actor, runId, extra) {
    var moved = [];
    st.votes.filter(function (v) { return v.entry_id === row.id; }).forEach(function (v) {
      var vid = insertVote(st, target, v.voter, v.ip, row.id);
      if (vid !== null) moved.push(vid);
    });
    recount(st, target);
    return change(st, row, Object.assign({ state: 'merged', merged_into: target, reject_reason: null }, extra), 'merge', actor, runId, { moved_vote_ids: moved });
  }

  // ---- Blocks and reports (reports.php) -----------------------------------------

  // Block the author of a visitor entry and log it. Returns the block id, or null when already blocked.
  function blockAuthor(st, row, actor, runId, note, strict) {
    if (row.source !== 'visitor' || (row.author_hash === '' && row.author_voter === '')) {
      if (!strict) return null;
      throw new AbError(409, 'conflict', 'This entry has no visitor author to block.');
    }
    var already = activeBlocks(st).some(function (b) { return b.author_hash === row.author_hash && b.voter_hash === row.author_voter; });
    if (already) return null;
    var now = iso();
    var b = {
      id: nextId(st, 'block'), entry_id: row.id, author_hash: row.author_hash, voter_hash: row.author_voter, note: note || '',
      created_at: now, expires_at: iso(nowMs() + Math.max(1, st.settings.block_days) * 86400000), lifted_at: null
    };
    st.blocks.push(b);
    var snap = snapshot(row);
    var after = clone(snap);
    after.block_id = b.id;
    logAction(st, actor, runId, 'block', row.id, snap, after);
    return b.id;
  }
  // Clear the open reports of an entry and log dismiss_reports. Returns how many were cleared.
  function dismissReports(st, row, actor, runId, ai) {
    var ids = openReportIds(st, row.id);
    if (!ids.length) return 0;
    var snap = snapshot(row);
    var after = clone(snap);
    after.cleared_report_ids = ids;
    if (ai) after.ai = ai;
    clearReports(st, ids, logAction(st, actor, runId, 'dismiss_reports', row.id, snap, after));
    return ids.length;
  }

  // ---- Undo (actions.php) ---------------------------------------------------------

  function isCommentKind(k) { return k === 'comment' || k === 'comment_edit'; }
  function isSideKind(k) { return k === 'dismiss_reports' || k === 'block' || k === 'unblock'; }

  // Is the action undoable right now? Returns null when yes, else the reason.
  function undoBlocker(st, a) {
    if (a.kind === 'undo') return 'An undo cannot be undone.';
    if (a.kind === 'create') return 'A created item cannot be undone. Make it private or reject it instead.';
    if (a.undone_by !== null) return 'Already undone.';
    var later = st.actions.filter(function (x) { return x.entry_id === a.entry_id && x.id > a.id && x.undone_by === null; });
    if (a.kind === 'block' || a.kind === 'unblock') {
      return later.some(function (x) { return x.kind === 'block' || x.kind === 'unblock'; })
        ? 'A later block or unblock of this author must be undone first.' : null;
    }
    if (isSideKind(a.kind)) return null;
    if (isCommentKind(a.kind)) {
      var cid = a.after.comment_id || 0;
      return later.some(function (x) { return isCommentKind(x.kind) && (x.after.comment_id || 0) === cid; })
        ? 'A later change to this comment must be undone first.' : null;
    }
    var skip = ['undo', 'comment', 'comment_edit', 'dismiss_reports', 'block', 'unblock'];
    if (later.some(function (x) { return skip.indexOf(x.kind) < 0; })) return 'A later action on this entry must be undone first.';
    if (a.kind === 'merge') {
      var target = a.after.merged_into ? entryRow(st, a.after.merged_into) : null;
      if (target && target.state === 'merged') {
        return 'The entry it was merged into has itself been merged into another entry since. Undo that merge first.';
      }
    }
    return null;
  }
  // Undo one action. Returns null on success, else the refusal reason.
  function undoAction(st, actionId, actor) {
    var a = actionRow(st, actionId);
    if (!a) return 'No such action.';
    var why = undoBlocker(st, a);
    if (why !== null) return why;
    var now = iso();

    if (isCommentKind(a.kind)) {
      var c = commentRow(st, a.after.comment_id || 0);
      if (!c) return 'The comment no longer exists.';
      var current = commentSnapshot(c);
      if (a.kind === 'comment') {
        c.hidden = true;
      } else {
        c.body = a.before.body;
        c.public = !!a.before.public;
        c.hidden = !!a.before.hidden;
      }
      c.updated_at = now;
      var after = commentSnapshot(c);
      after.undoes = a.id;
      a.undone_by = logAction(st, actor, null, 'undo', a.entry_id, current, after, now);
      return null;
    }

    var row = entryRow(st, a.entry_id);
    if (!row) return 'The entry no longer exists.';
    var cur = snapshot(row);
    var undoAfter;
    if (isSideKind(a.kind)) {
      if (a.kind === 'dismiss_reports') {
        reopenReports(st, a.after.cleared_report_ids || [], a.id);
      } else if (a.kind === 'block') {
        st.blocks.forEach(function (b) { if (b.id === a.after.block_id && !b.lifted_at) b.lifted_at = now; });
      } else {
        st.blocks.forEach(function (b) { if ((a.after.block_ids || []).indexOf(b.id) >= 0) b.lifted_at = null; });
      }
      undoAfter = clone(cur);
    } else {
      var moved = Array.isArray(a.after.moved_vote_ids) ? a.after.moved_vote_ids : [];
      var targetId = isSet(a.after.merged_into) ? a.after.merged_into : null;
      MUTABLE.forEach(function (k) { row[k] = clone(isSet(a.before[k]) ? a.before[k] : null); });
      row.updated_at = now;
      if (moved.length) {
        st.votes = st.votes.filter(function (v) { return moved.indexOf(v.id) < 0; });
        if (targetId !== null) recount(st, targetId);
      }
      recount(st, row.id);
      if (Array.isArray(a.after.cleared_report_ids) && a.after.cleared_report_ids.length) reopenReports(st, a.after.cleared_report_ids, a.id);
      undoAfter = snapshot(row);
    }
    undoAfter.undoes = a.id;
    a.undone_by = logAction(st, actor, null, 'undo', row.id, cur, undoAfter, now);
    return null;
  }
  function commentSnapshot(c) { return { comment_id: c.id, body: c.body, public: c.public, hidden: c.hidden }; }

  function actionSummary(a) {
    var before = a.before || {}, after = a.after || {}, id = a.entry_id, n, plural;
    plural = function (k, one, many) { return k + ' ' + (k === 1 ? one : many); };
    switch (a.kind) {
      case 'create': return 'Created owner item #' + id + '.';
      case 'publish':
        n = (after.cleared_report_ids || []).length;
        return 'Published #' + id + '.' + (n > 0 ? ' Cleared ' + plural(n, 'report', 'reports') + '.' : '');
      case 'report_hide':
        n = after.reporters || 0;
        return n > 0 ? 'Hidden after ' + plural(n, 'report', 'reports') + '.' : 'Hidden after reports.';
      case 'dismiss_reports':
        n = (after.cleared_report_ids || []).length;
        var why = isObject(after.ai) ? String(after.ai.reason || '').trim() : '';
        return 'Dismissed ' + plural(n, 'report', 'reports') + (why !== '' ? ': ' + why : '.');
      case 'block': return 'Blocked the author.';
      case 'unblock': return 'Unblocked the author.';
      case 'reject':
        var r = after.reject_reason || 'other';
        return 'Rejected #' + id + ' (' + r + ')' + (a.actor === 'system' && r === 'abuse' ? ': the author is blocked.' : '.');
      case 'flag': return 'Flagged #' + id + ' for the owner.';
      case 'pending': return 'Moved #' + id + ' back to pending.';
      case 'private': return 'Made #' + id + ' private.';
      case 'tag':
        return (after.tags || []).length ? 'Tagged #' + id + ': ' + after.tags.join(', ') + '.' : 'Removed all tags from #' + id + '.';
      case 'merge':
        n = (after.moved_vote_ids || []).length;
        return 'Merged #' + id + ' into #' + (isSet(after.merged_into) ? after.merged_into : '?') + ' (' + plural(n, 'vote', 'votes') + ' moved).';
      case 'set_status': return 'Set #' + id + ' status from ' + (before.status || '?') + ' to ' + (after.status || '?') + '.';
      case 'comment': return (after.public ? 'Commented publicly on' : 'Added a private note to') + ' #' + id + '.';
      case 'comment_edit': return 'Edited a comment on #' + id + '.';
      case 'edit':
        var what = ['type', 'title', 'body', 'external_url'].filter(function (k) { return before[k] !== after[k]; });
        return 'Edited the ' + (what.length ? what.join(' and ') : 'text') + ' of #' + id + '.';
      case 'undo': return 'Undid action #' + (isSet(after.undoes) ? after.undoes : '?') + ' on #' + id + '.';
    }
    return 'Changed #' + id + '.';
  }

  // ---- Public actions (public.php, votes.php, reports.php) ----------------------

  function hList(st, req) {
    var cfg = st.settings, ctx = aliasInfo(st);
    var rows = st.entries.filter(function (e) { return e.state === 'published'; }).sort(function (a, b) {
      return b.votes - a.votes || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0) || b.id - a.id;
    }).slice(0, 500);
    var ids = {}, counts = {};
    var entries = rows.map(function (r) {
      ids[r.id] = true;
      r.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
      return publicEntry(r, ctx);
    });
    var tagCounts = Object.keys(counts).map(function (t) { return { tag: t, count: counts[t] }; }).sort(function (a, b) {
      return b.count - a.count || (a.tag < b.tag ? -1 : 1);
    });
    var voter = req.headers['x-arghbox-voter'] || '', voted = [];
    if (validVoter(voter)) {
      st.votes.forEach(function (v) { if (v.voter === voter && ids[v.entry_id]) voted.push(v.entry_id); });
    }
    return {
      site: { name: cfg.site_name }, welcome: cfg.welcome, max_links: cfg.max_links, version: VERSION, turnstile_site_key: SITE_KEY,
      moderation: cfg.moderation, credit: cfg.credit, contact: cfg.contact, app_pass: true, entries: entries, tag_counts: tagCounts, voted: voted
    };
  }

  function hSession(st, req) {
    var body = req.body();
    var token = body.turnstile;
    var appOnly = body.app === true && (!isSet(token) || token === '');
    if (!appOnly && (typeof token !== 'string' || token === '')) throw new AbError(403, 'turnstile_failed', 'The human check is missing. Reload and try again.');
    return { pass: 'demo-' + rand(24), expires_at: iso(nowMs() + 1800000), expires_in: 1800 };
  }

  function fakeAdd(type, title, body) {
    return {
      entry: {
        id: 0, type: type, title: title, body: body, votes: 1, status: 'open', status_at: null, tags: [], comments: [], similar: 0,
        aliases: [], source: 'visitor', created_at: iso(), state: 'pending'
      },
      receipt: rand(24)
    };
  }

  function hAdd(st, req) {
    var cfg = st.settings, body = req.body();
    checkPass(body.pass);
    var voter = voterFrom(body);
    var type = body.type;
    if (typeof type !== 'string' || TYPES.indexOf(type) < 0) throw invalid('type', 'The type must be idea, bug or question.');
    var title = cleanTitle(body.title);
    var text = cleanBody(body.body);
    checkLinks(title, text, cfg.max_links);
    // The honeypot still gets the bots' fake success; a fast form does not (the demo user must see their entry).
    if (isSet(body.hp) && body.hp !== '' && body.hp !== false) return fakeAdd(type, title, text);
    var context = cleanContext(body.context);
    var receipt = rand(24);
    var state = cfg.moderation === 'publish' ? 'published' : 'pending';
    var blocked = blocksMatch(activeBlocks(st), VISITOR_IP, voter).length > 0;
    // A blocked author's entry is kept, as rejected (abuse), and the answer looks exactly like a normal add.
    var row = insertEntry(st, {
      type: type, title: title, body: text, state: blocked ? 'pending' : state, context: context,
      author_hash: VISITOR_IP, author_voter: voter, receipt: receipt
    });
    insertVote(st, row.id, voter, VISITOR_IP);
    recount(st, row.id);
    if (blocked) change(st, row, { state: 'rejected', reject_reason: 'abuse' }, 'reject', 'system', null);
    var out = publicEntry(row, { pub: {}, count: {}, titles: {} });
    out.state = state;
    return { entry: out, receipt: receipt };
  }

  function hVote(st, req) {
    var body = req.body();
    checkPass(body.pass);
    var voter = voterFrom(body);
    var id = entryIdOf(body);
    var on = isSet(body.on) ? body.on : true; // PHP: $in['on'] ?? true
    if (typeof on !== 'boolean') throw invalid('on', '"on" must be true or false.');
    var target = resolveTarget(st, id);
    var row = target === null ? null : entryRow(st, target);
    if (!row || row.state !== 'published') throw notFound();
    var existing = st.votes.filter(function (v) { return v.entry_id === row.id && v.voter === voter; })[0] || null;
    if (on) {
      if (!existing) insertVote(st, row.id, voter, VISITOR_IP);
    } else if (existing && existing.moved_from === null) {
      st.votes = st.votes.filter(function (v) { return v.id !== existing.id; });
    }
    var n = recount(st, row.id);
    var voted = st.votes.some(function (v) { return v.entry_id === row.id && v.voter === voter; });
    return { id: row.id, votes: n, voted: voted };
  }

  function hReport(st, req) {
    var body = req.body();
    checkPass(body.pass);
    var voter = voterFrom(body);
    var id = entryIdOf(body);
    var reason = body.reason;
    if (typeof reason !== 'string' || REPORT_REASONS.indexOf(reason) < 0) throw invalid('reason', 'The reason must be spam, abusive, off_topic or other.');
    var row = entryRow(st, id);
    if (!row || row.state !== 'published' || row.source !== 'visitor') throw notFound();
    if (blocksMatch(activeBlocks(st), VISITOR_IP, voter).length) return { id: id }; // ignored silently
    var dup = st.reports.some(function (r) { return r.entry_id === id && r.voter === voter; });
    if (dup) return { id: id };
    st.reports.push({ id: nextId(st, 'report'), entry_id: id, reason: reason, voter: voter, ip: VISITOR_IP, created_at: iso(), cleared_at: null, cleared_by: null });
    var hideAt = st.settings.report_hide_at;
    if (hideAt > 0) {
      var ips = {};
      st.reports.forEach(function (r) { if (r.entry_id === id && !r.cleared_at) ips[r.ip] = true; });
      var n = Object.keys(ips).length;
      if (n >= hideAt) change(st, row, { state: 'pending' }, 'report_hide', 'system', null, { reporters: n });
    }
    return { id: id };
  }

  function hMine(st, req) {
    var body = req.body();
    if (!Array.isArray(body.receipts) || body.receipts.length > 50) throw invalid('receipts', 'Send at most 50 receipts.');
    var ctx = aliasInfo(st), out = [];
    body.receipts.forEach(function (rc) {
      if (typeof rc !== 'string' || rc === '' || rc.length > 100) return;
      var r = st.entries.filter(function (e) { return e.receipt === rc; })[0];
      if (!r) return;
      var mergedInto = null, mergedTitle = null;
      if (r.state === 'merged' && r.merged_into !== null) {
        var final = resolveTarget(st, r.merged_into);
        var t = final === null ? null : entryRow(st, final);
        if (t) { mergedInto = t.id; mergedTitle = t.title; }
      }
      out.push({
        receipt: rc, id: r.id, type: r.type, title: r.title, state: r.state === 'flagged' ? 'pending' : r.state, status: r.status,
        tags: r.tags.slice(), comments: ctx.pub[r.id] || [], merged_into: mergedInto, merged_into_title: mergedTitle,
        reject_reason: r.state === 'rejected' ? r.reject_reason : null
      });
    });
    return { entries: out };
  }

  function hHealth(st, req) {
    var out = {
      ok: true, version: VERSION, php: '8.2', sqlite: '3.45.1', config: 'found', data_dir: 'outside_webroot', turnstile: true,
      ip_header: 'configured', moderation: st.settings.moderation, admin: true, config_valid: true, app_pass: true
    };
    var auth = null;
    try { auth = authenticate(req, false); } catch (e) { auth = null; }
    if (auth) {
      out.php = '8.2.0';
      out.config_location = 'local';
      out.warnings = ['Turnstile is using Cloudflare test keys: every visitor passes. Use your real keys in production.'];
      out.turnstile_test_keys = true;
      out.data_dir_warning = null;
    }
    return out;
  }

  // ---- Admin authentication (security.php, admin.php) ---------------------------

  function session() {
    var s = null;
    try { s = JSON.parse(read(ADMIN_KEY) || 'null'); } catch (e) { s = null; }
    if (s && typeof s.csrf === 'string' && s.expires > Date.now()) return s;
    if (s) remove(ADMIN_KEY);
    return null;
  }
  function authenticate(req, isPost) {
    var auth = req.headers.authorization || '';
    if (auth !== '') {
      var m = /^Bearer\s+(.*)$/i.exec(auth);
      if (m && m[1].trim() === PASSWORD) return { actor: 'owner', via: 'owner', csrf: null };
      throw new AbError(401, 'unauthorized', 'Sign in with a valid token.');
    }
    var s = session();
    if (s) {
      if (isPost && (req.headers['x-arghbox-csrf'] || '') !== s.csrf) throw new AbError(401, 'unauthorized', 'The CSRF token is missing or wrong.');
      return { actor: 'owner', via: 'cookie', csrf: s.csrf };
    }
    throw new AbError(401, 'unauthorized', 'Sign in with a valid token.');
  }

  function hLogin(st, req) {
    var token = req.body().token;
    if (typeof token !== 'string' || token === '' || token !== PASSWORD) throw new AbError(401, 'unauthorized', 'That token is not right.');
    var s = { csrf: rand(40), expires: Date.now() + 12 * 3600 * 1000 };
    write(ADMIN_KEY, JSON.stringify(s));
    return { csrf: s.csrf };
  }
  function hLogout() {
    remove(ADMIN_KEY);
    return {};
  }
  function hMe(st, req, auth) {
    var out = { actor: auth.actor };
    if (auth.csrf !== null) out.csrf = auth.csrf;
    return out;
  }

  // ---- Admin reading (admin.php) -------------------------------------------------

  function tagVocabulary(st) {
    var counts = {};
    st.entries.forEach(function (e) {
      if (['published', 'private', 'flagged', 'pending'].indexOf(e.state) >= 0) e.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    st.settings.tags.forEach(function (p) { if (!has(counts, p)) counts[p] = 0; });
    return Object.keys(counts).map(function (t) { return { tag: t, count: counts[t] }; }).sort(function (a, b) {
      return b.count - a.count || (a.tag < b.tag ? -1 : 1);
    });
  }
  function byCreated(a, b) { return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id; }
  // "Reported": an open report and a live (published, pending, flagged) state.
  function isReported(st, e) {
    return ['published', 'pending', 'flagged'].indexOf(e.state) >= 0 && openReportIds(st, e.id).length > 0;
  }

  function hQueue(st) {
    var cfg = st.settings, ctx = aliasInfo(st);
    var inState = function (s) { return st.entries.filter(function (e) { return e.state === s; }); };
    var firstOpen = function (e) {
      return Math.min.apply(null, st.reports.filter(function (r) { return r.entry_id === e.id && !r.cleared_at; }).map(function (r) { return Date.parse(r.created_at); }));
    };
    return {
      site: { name: cfg.site_name, url: cfg.site_url, about: cfg.about },
      moderation: cfg.moderation,
      auto_apply_min_confidence: cfg.auto_apply_min_confidence,
      tags: tagVocabulary(st),
      pending: inState('pending').sort(byCreated).map(function (e) { return adminEntry(st, e, ctx); }),
      flagged: inState('flagged').sort(byCreated).map(function (e) { return adminEntry(st, e, ctx); }),
      published: inState('published').sort(function (a, b) { return b.votes - a.votes || b.id - a.id; }).map(function (e) {
        return {
          id: e.id, type: e.type, title: e.title, body: truncate(e.body, 300), votes: e.votes, status: e.status, tags: e.tags.slice(),
          aliases: ctx.titles[e.id] || [], fingerprint: fingerprint(st, e)
        };
      }),
      private: inState('private').sort(function (a, b) { return b.id - a.id; }).map(function (e) {
        return { id: e.id, type: e.type, title: e.title, status: e.status, tags: e.tags.slice() };
      }),
      reported: inState('published').filter(function (e) { return e.source === 'visitor' && openReportIds(st, e.id).length > 0; })
        .sort(function (a, b) { return firstOpen(a) - firstOpen(b) || a.id - b.id; }).map(function (e) { return adminEntry(st, e, ctx); })
    };
  }

  function qstr(q, name) { return q.get(name) || ''; }
  function qint(q, name, def, min, max) {
    var v = q.get(name);
    if (v === null || !/^-?\d+$/.test(v)) return def;
    return Math.max(min, Math.min(max, parseInt(v, 10)));
  }

  function hEntries(st, req) {
    var q = req.query, rows = st.entries.slice();
    var state = qstr(q, 'state');
    if (state !== '') {
      if (STATES.indexOf(state) < 0) throw invalid('state', 'Unknown state.');
      rows = rows.filter(function (e) { return e.state === state; });
    }
    var status = qstr(q, 'status');
    if (status !== '') {
      if (STATUSES.indexOf(status) < 0) throw invalid('status', 'Unknown status.');
      rows = rows.filter(function (e) { return e.status === status; });
    }
    var type = qstr(q, 'type');
    if (type !== '') {
      if (TYPES.indexOf(type) < 0) throw invalid('type', 'Unknown type.');
      rows = rows.filter(function (e) { return e.type === type; });
    }
    var source = qstr(q, 'source');
    if (source !== '') {
      if (source !== 'visitor' && source !== 'owner') throw invalid('source', 'Unknown source.');
      rows = rows.filter(function (e) { return e.source === source; });
    }
    var tag = qstr(q, 'tag');
    if (tag !== '') {
      if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(tag)) throw invalid('tag', 'Unknown tag format.');
      rows = rows.filter(function (e) { return e.tags.indexOf(tag) >= 0; });
    }
    if (qstr(q, 'reported') === '1' || qstr(q, 'reported') === 'true') rows = rows.filter(function (e) { return isReported(st, e); });
    if (qstr(q, 'blocked') === '1' || qstr(q, 'blocked') === 'true') {
      var blocks = activeBlocks(st);
      rows = rows.filter(function (e) { return e.source === 'visitor' && blocksMatch(blocks, e.author_hash, e.author_voter).length > 0; });
    }
    var text = qstr(q, 'q').trim().toLowerCase();
    if (text !== '') {
      rows = rows.filter(function (e) {
        return e.title.toLowerCase().indexOf(text) >= 0 || e.body.toLowerCase().indexOf(text) >= 0 ||
          st.comments.some(function (c) { return c.entry_id === e.id && c.body.toLowerCase().indexOf(text) >= 0; });
      });
    }
    var sort = qstr(q, 'sort');
    var newest = function (a, b) { return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id; };
    var orders = {
      '': newest, newest: newest, oldest: byCreated,
      votes: function (a, b) { return b.votes - a.votes || newest(a, b); }
    };
    if (!has(orders, sort)) throw invalid('sort', 'sort must be newest, oldest or votes.');
    rows.sort(orders[sort]);
    var limit = qint(q, 'limit', 50, 1, 200), offset = qint(q, 'offset', 0, 0, 1000000), ctx = aliasInfo(st);
    return {
      total: rows.length,
      entries: rows.slice(offset, offset + limit).map(function (e) { return adminEntry(st, e, ctx); })
    };
  }

  function logRows(st, filter, limit, offset) {
    return st.actions.filter(filter).sort(function (a, b) { return b.id - a.id; }).slice(offset, offset + limit).map(function (a) {
      var e = entryRow(st, a.entry_id);
      return {
        id: a.id, at: a.at, actor: a.actor, run_id: a.run_id, kind: a.kind, entry_id: a.entry_id, entry_title: e ? e.title : null,
        summary: actionSummary(a), undone_by: a.undone_by, undoable: undoBlocker(st, a) === null
      };
    });
  }
  function hEntry(st, req) {
    var id = qint(req.query, 'id', 0, 0, Number.MAX_SAFE_INTEGER);
    var row = id > 0 ? entryRow(st, id) : null;
    if (!row) throw notFound();
    return {
      entry: adminEntry(st, row, aliasInfo(st)),
      actions: logRows(st, function (a) { return a.entry_id === id; }, 20, 0)
    };
  }
  function hLog(st, req) {
    var q = req.query, want = {};
    ['run_id', 'entry_id'].forEach(function (k) { if (/^\d+$/.test(q.get(k) || '')) want[k] = parseInt(q.get(k), 10); });
    var filter = function (a) { return Object.keys(want).every(function (k) { return a[k] === want[k]; }); };
    return {
      total: st.actions.filter(filter).length,
      actions: logRows(st, filter, qint(q, 'limit', 100, 1, 500), qint(q, 'offset', 0, 0, 1000000))
    };
  }
  function runOut(r) { return { id: r.id, at: r.at, reviewer: r.reviewer, counts: clone(r.counts), digest: r.digest }; }
  function hRuns(st, req) {
    var limit = qint(req.query, 'limit', 20, 1, 200);
    return { runs: st.runs.slice().sort(function (a, b) { return b.id - a.id; }).slice(0, limit).map(runOut) };
  }
  function hStats(st) {
    var counts = {};
    STATES.forEach(function (s) { counts[s] = 0; });
    st.entries.forEach(function (e) { counts[e.state]++; });
    counts.reported = st.entries.filter(function (e) { return isReported(st, e); }).length;
    var last = st.runs.length ? st.runs[st.runs.length - 1] : null;
    var since = iso(nowMs() - 7 * 86400000);
    return {
      counts: counts, votes: st.votes.length, blocks: activeBlocks(st).length,
      entries_last_7_days: st.entries.filter(function (e) { return e.source === 'visitor' && e.created_at >= since; }).length,
      last_run: last ? runOut(last) : null
    };
  }

  // ---- Admin changes (admin.php, reports.php) -------------------------------------

  var STATE_KIND = { published: 'publish', rejected: 'reject', flagged: 'flag', pending: 'pending', private: 'private' };

  function hCreate(st, req, auth) {
    var body = req.body();
    var type = body.type;
    if (typeof type !== 'string' || TYPES.indexOf(type) < 0) throw invalid('type', 'The type must be idea, bug or question.');
    var title = cleanTitle(body.title);
    var text = cleanBody(body.body);
    var status = isSet(body.status) ? body.status : 'open';
    if (typeof status !== 'string' || STATUSES.indexOf(status) < 0) throw invalid('status', 'Unknown status.');
    var tags = cleanTags(body.tags);
    var isPublic = isSet(body.public) ? body.public : false;
    if (typeof isPublic !== 'boolean') throw invalid('public', '"public" must be true or false.');
    var url = has(body, 'external_url') ? cleanUrl(body.external_url) : null;
    var row = insertEntry(st, { type: type, title: title, body: text, source: 'owner', state: isPublic ? 'published' : 'private', status: status, tags: tags });
    row.external_url = url;
    logAction(st, auth.actor, null, 'create', row.id, {}, snapshot(row));
    return { entry: adminEntryOut(st, row.id) };
  }

  function hUpdate(st, req, auth) {
    var body = req.body();
    var id = entryIdOf(body);
    var edit = {};
    if (has(body, 'type')) {
      if (typeof body.type !== 'string' || TYPES.indexOf(body.type) < 0) throw invalid('type', 'The type must be idea, bug or question.');
      edit.type = body.type;
    }
    if (has(body, 'title')) edit.title = cleanTitle(body.title);
    if (has(body, 'body')) edit.body = cleanBody(body.body);
    if (has(body, 'external_url')) edit.external_url = cleanUrl(body.external_url);
    var tags = has(body, 'tags') ? cleanTags(body.tags) : null;
    var status = null;
    if (has(body, 'status')) {
      if (typeof body.status !== 'string' || STATUSES.indexOf(body.status) < 0) throw invalid('status', 'Unknown status.');
      status = body.status;
    }
    var state = null;
    if (has(body, 'state')) {
      if (['published', 'rejected', 'flagged', 'pending', 'private'].indexOf(body.state) < 0) throw invalid('state', 'Unknown state.');
      state = body.state;
    }
    var reason = null;
    if (has(body, 'reject_reason')) {
      if (REJECT_REASONS.indexOf(body.reject_reason) < 0) throw invalid('reject_reason', 'Unknown rejection reason.');
      reason = body.reject_reason;
    }
    var mergeInto = has(body, 'merge_into') ? body.merge_into : null;
    if (isSet(mergeInto) && state !== null) throw invalid('merge_into', 'Send either state or merge_into, not both.');

    var row = entryRow(st, id);
    if (!row) throw notFound();
    var actor = auth.actor;
    // 1. edit
    var changes = {};
    Object.keys(edit).forEach(function (k) { if (row[k] !== edit[k]) changes[k] = edit[k]; });
    if (Object.keys(changes).length) change(st, row, changes, 'edit', actor, null);
    // 2. tags
    if (tags !== null && JSON.stringify(tags) !== JSON.stringify(row.tags)) change(st, row, { tags: tags }, 'tag', actor, null);
    // 3. status
    if (status !== null && status !== row.status) change(st, row, { status: status }, 'set_status', actor, null);
    // 4. state (or only the rejection reason)
    if (state !== null || (reason !== null && row.state === 'rejected')) {
      var newState = state || 'rejected';
      if (row.state === 'merged') throw new AbError(409, 'conflict', 'This entry was merged. Undo the merge first.');
      if (newState === 'private' && row.source !== 'owner') throw invalid('state', 'Only the owner\'s own items can be private.');
      if (newState === 'pending' && row.source === 'owner') throw invalid('state', 'Owner items cannot go to the triage queue.');
      var newReason = newState === 'rejected' ? (reason || (row.state === 'rejected' && row.reject_reason ? row.reject_reason : 'other')) : null;
      if (newState !== row.state || newReason !== row.reject_reason) {
        change(st, row, { state: newState, reject_reason: newReason }, STATE_KIND[newState], actor, null);
      }
    }
    // 5. merge
    if (isSet(mergeInto)) {
      if (row.state === 'merged') throw new AbError(409, 'conflict', 'This entry is already merged. Undo the merge first.');
      if (row.state === 'private') throw invalid('merge_into', 'Private items cannot be merged.');
      var chk = mergeCheck(st, id, mergeInto);
      if (chk[0] === null) throw invalid('merge_into', 'Cannot merge: ' + chk[1] + '.');
      merge(st, row, chk[0], actor, null);
    }
    return { entry: adminEntryOut(st, id) };
  }

  function hComment(st, req, auth) {
    var body = req.body();
    var id = entryIdOf(body);
    var text = cleanBody(body.body);
    if (text === '') throw invalid('body', 'The comment is empty.');
    var isPublic = isSet(body.public) ? body.public : true;
    if (typeof isPublic !== 'boolean') throw invalid('public', '"public" must be true or false.');
    if (!entryRow(st, id)) throw notFound();
    var c = insertComment(st, id, text, isPublic);
    logAction(st, auth.actor, null, 'comment', id, { comment_id: c.id, body: '', public: isPublic, hidden: true }, commentSnapshot(c));
    return { comment: commentOut(c), entry: adminEntryOut(st, id) };
  }

  function hCommentUpdate(st, req, auth) {
    var body = req.body();
    if (!isInt(body.comment_id) || body.comment_id < 1) throw invalid('comment_id', 'The comment id is missing.');
    var text = null;
    if (has(body, 'body')) {
      text = cleanBody(body.body);
      if (text === '') throw invalid('body', 'The comment is empty. Hide it instead.');
    }
    ['public', 'hidden'].forEach(function (k) {
      if (has(body, k) && typeof body[k] !== 'boolean') throw invalid(k, '"' + k + '" must be true or false.');
    });
    var c = commentRow(st, body.comment_id);
    if (!c) throw notFound('That comment does not exist.');
    var next = {
      body: text === null ? c.body : text,
      public: isSet(body.public) ? body.public : c.public,
      hidden: isSet(body.hidden) ? body.hidden : c.hidden
    };
    if (next.body !== c.body || next.public !== c.public || next.hidden !== c.hidden) {
      var before = commentSnapshot(c);
      Object.assign(c, next);
      c.updated_at = iso();
      logAction(st, auth.actor, null, 'comment_edit', c.entry_id, before, commentSnapshot(c), c.updated_at);
    }
    return { comment: commentOut(c), entry: adminEntryOut(st, c.entry_id) };
  }

  function hUndo(st, req, auth) {
    var body = req.body();
    if (isSet(body.action_id)) {
      if (!isInt(body.action_id) || body.action_id < 1) throw invalid('action_id', 'The action id must be a number.');
      var why = undoAction(st, body.action_id, auth.actor);
      if (why === null) return { undone: [body.action_id], refused: [] };
      var refused = [{ action_id: body.action_id, reason: why }];
      return { status: 409, ok: false, error: 'conflict', message: why, undone: [], refused: refused };
    }
    if (isSet(body.run_id)) {
      if (!isInt(body.run_id) || body.run_id < 1) throw invalid('run_id', 'The run id must be a number.');
      if (!st.runs.some(function (r) { return r.id === body.run_id; })) throw notFound('That run does not exist.');
      var undone = [], refusedAll = [];
      st.actions.filter(function (a) { return a.run_id === body.run_id; }).sort(function (a, b) { return b.id - a.id; }).forEach(function (a) {
        var w = undoAction(st, a.id, auth.actor);
        if (w === null) undone.push(a.id); else refusedAll.push({ action_id: a.id, reason: w });
      });
      return { undone: undone, refused: refusedAll };
    }
    throw invalid('action_id', 'Send action_id or run_id.');
  }

  function entryOrNotFound(st, body) {
    var row = entryRow(st, entryIdOf(body));
    if (!row) throw notFound();
    return row;
  }
  function hDismissReports(st, req, auth) {
    var row = entryOrNotFound(st, req.body());
    dismissReports(st, row, auth.actor, null, null);
    return { entry: adminEntryOut(st, row.id) };
  }
  function hBlock(st, req, auth) {
    var body = req.body();
    var id = entryIdOf(body);
    var note = '';
    if (has(body, 'note') && body.note !== null) {
      if (typeof body.note !== 'string') throw invalid('note', 'The note must be text.');
      note = truncate(body.note.replace(RE_INVISIBLE_KEEP_NL, '').trim(), 500);
    }
    var row = entryRow(st, id);
    if (!row) throw notFound();
    blockAuthor(st, row, auth.actor, null, note, true);
    return { entry: adminEntryOut(st, id) };
  }
  function hUnblock(st, req, auth) {
    var row = entryOrNotFound(st, req.body());
    var ids = blocksMatch(activeBlocks(st), row.author_hash, row.author_voter);
    if (ids.length) {
      var now = iso();
      st.blocks.forEach(function (b) { if (ids.indexOf(b.id) >= 0) b.lifted_at = now; });
      var snap = snapshot(row);
      var after = clone(snap);
      after.block_ids = ids;
      logAction(st, auth.actor, null, 'unblock', row.id, snap, after, now);
    }
    return { entry: adminEntryOut(st, row.id) };
  }

  // ---- admin.apply: triage decisions in one go (admin.php) ------------------------

  function hApply(st, req) {
    var body = req.body();
    var run = isObject(body.run) ? body.run : {};
    return applyDecisions(st, body, 'owner', cleanReviewer(run.reviewer));
  }

  function applyDecisions(st, input, actor, reviewer) {
    var cfg = st.settings;
    var run = isObject(input.run) ? input.run : {};
    var decisions = input.decisions;
    if (!Array.isArray(decisions) || decisions.length > 1000) throw invalid('decisions', 'decisions must be a list of at most 1000 items.');
    var digest = typeof run.digest === 'string' ? truncate(run.digest, 2000) : '';
    var minConf = cfg.auto_apply_min_confidence;
    var now = iso();
    var runRow = { id: nextId(st, 'run'), at: now, reviewer: reviewer, counts: {}, digest: digest };
    st.runs.push(runRow);
    var runId = runRow.id;
    var counts = { publish: 0, reject: 0, merge: 0, flag: 0, tag: 0, keep: 0, block: 0, skipped: 0 };
    var applied = [], skipped = [];
    var skip = function (id, reason) { skipped.push({ id: isInt(id) ? id : null, reason: reason }); counts.skipped++; };

    var first = decisions.filter(function (d) { return !(isObject(d) && d.action === 'merge'); });
    var merges = decisions.filter(function (d) { return isObject(d) && d.action === 'merge'; });
    first.concat(merges).forEach(function (d) {
      if (!isObject(d) || !isInt(d.id)) return skip(null, 'invalid_input');
      var id = d.id, action = d.action;
      if (['publish', 'reject', 'merge', 'flag', 'tag', 'keep'].indexOf(action) < 0) return skip(id, 'invalid_input');
      var conf = d.confidence;
      if (!isInt(conf) || conf < 0 || conf > 100 || typeof d.fingerprint !== 'string') return skip(id, 'invalid_input');
      var row = entryRow(st, id);
      if (!row) return skip(id, 'not_found');
      var state = row.state;
      var reported = state === 'published' && row.source === 'visitor' && openReportIds(st, id).length > 0;
      var okState = (state === 'pending' && action !== 'tag' && action !== 'keep') ||
        (state === 'published' && (action === 'merge' || action === 'tag' || ((action === 'keep' || action === 'reject') && reported)));
      if (!okState) return skip(id, 'invalid_state');
      if (fingerprint(st, row) !== d.fingerprint) return skip(id, 'changed');

      var title = null, type = null, tags = null;
      try {
        // New wording and a corrected type only ever apply to pending entries being published or flagged.
        var wording = state === 'pending' && (action === 'publish' || action === 'flag');
        if (wording && isSet(d.title) && d.title !== '') {
          title = cleanTitle(d.title);
          checkLinks(title, '', cfg.max_links);
        }
        if (wording && isSet(d.type)) {
          if (TYPES.indexOf(d.type) < 0) throw invalid('type', 'bad type');
          type = d.type;
        }
        if (has(d, 'tags') && (action === 'publish' || action === 'flag' || action === 'tag')) tags = cleanTags(d.tags);
        else if (action === 'tag') throw invalid('tags', 'tags required');
      } catch (e) {
        if (e instanceof AbError) return skip(id, 'invalid_input');
        throw e;
      }
      var rejectReason = null;
      if (action === 'reject') {
        rejectReason = d.reject_reason;
        if (REJECT_REASONS.indexOf(rejectReason) < 0) return skip(id, 'invalid_input');
      }
      var blockIt = has(d, 'block_author') ? d.block_author : false;
      if (typeof blockIt !== 'boolean' || (blockIt && !(action === 'reject' && (rejectReason === 'spam' || rejectReason === 'abuse')))) return skip(id, 'invalid_input');
      var reason = typeof d.reason === 'string' ? truncate(d.reason, 500) : '';
      var titleEn = typeof d.title_en === 'string' ? truncate(d.title_en, 200) : null;

      var eff = action, flaggedInstead = false;
      if (action !== 'flag' && action !== 'tag' && conf < minConf) {
        if (state === 'published') return skip(id, 'low_confidence');
        eff = 'flag';
        flaggedInstead = true;
      }
      var mergeTarget = null;
      if (eff === 'merge') {
        mergeTarget = mergeCheck(st, id, d.merge_into)[0];
        if (mergeTarget === null) return skip(id, 'merge_target_invalid');
      }
      var ai = { action: action, confidence: conf, reason: reason, title_en: titleEn, reviewer: reviewer, run_id: runId, at: now, applied: !flaggedInstead };
      if (action === 'merge') ai.merge_into = mergeTarget !== null ? mergeTarget : (isSet(d.merge_into) ? d.merge_into : null);
      if (action === 'reject') ai.reject_reason = rejectReason;
      var changes = { ai: ai };
      var blocked = false;
      if (eff === 'keep') {
        dismissReports(st, row, actor, runId, ai);
      } else if (eff === 'merge') {
        merge(st, row, mergeTarget, actor, runId, changes);
      } else {
        if (!flaggedInstead && state === 'pending') {
          if (title !== null) changes.title = title;
          if (type !== null) changes.type = type;
        }
        if (tags !== null) changes.tags = tags;
        if (eff === 'publish') {
          changes.state = 'published';
        } else if (eff === 'reject') {
          changes.state = 'rejected';
          changes.reject_reason = rejectReason;
        } else if (eff === 'flag') {
          changes.state = 'flagged';
        }
        row = change(st, row, changes, eff, actor, runId)[0];
        if (eff === 'reject' && blockIt && blockAuthor(st, row, actor, runId, '', false) !== null) {
          counts.block++;
          blocked = true;
        }
      }
      counts[eff]++;
      var out = { id: id, action: eff, flagged_instead: flaggedInstead };
      if (blockIt) out.blocked = blocked;
      applied.push(out);
    });
    runRow.counts = counts;
    return { run_id: runId, applied: applied, skipped: skipped };
  }

  // ---- Export (export.php) ---------------------------------------------------------

  function csvField(v, text) {
    var s = v === null || v === undefined ? '' : String(v);
    if (text && s !== '' && '=+-@\t\r'.indexOf(s.charAt(0)) >= 0) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvRow(fields) { return fields.join(',') + '\r\n'; }
  function exportSlug(name) {
    var s = name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase().slice(0, 40).replace(/^-+|-+$/g, '');
    return s === '' ? 'site' : s;
  }
  // Returns {type, file, body}.
  function exportFile(st, format, state) {
    var cfg = st.settings;
    if (['json', 'csv', 'jira-csv'].indexOf(format) < 0) throw invalid('format', 'format must be json, csv or jira-csv.');
    if (state !== '' && STATES.indexOf(state) < 0) throw invalid('state', 'Unknown state.');
    var ctx = aliasInfo(st);
    var base = 'arghbox-' + exportSlug(cfg.site_name) + '-' + iso().slice(0, 10).replace(/-/g, '');
    var byId = function (a, b) { return a.id - b.id; };
    var out;

    if (format === 'jira-csv') {
      var map = { bug: 'Bug', idea: 'Story', question: 'Task' };
      out = '﻿' + csvRow(['Summary', 'Description', 'Issue Type', 'Labels']);
      st.entries.filter(function (e) { return e.state === 'published' && ['open', 'planned', 'in_progress'].indexOf(e.status) >= 0; }).sort(byId).forEach(function (r) {
        var desc = r.body.trim();
        desc += (desc !== '' ? '\n\n' : '') + 'From ArghBox #' + r.id + ', ' + r.votes + (r.votes === 1 ? ' vote' : ' votes');
        out += csvRow([csvField(r.title, true), csvField(desc, true), csvField(map[r.type] || 'Task'), csvField(r.tags.join(' '))]);
      });
      return { type: 'text/csv; charset=utf-8', file: base + '-jira.csv', body: out };
    }

    var rows = st.entries.filter(function (e) { return state !== '' ? e.state === state : e.state !== 'rejected'; }).sort(byId);
    if (format === 'json') {
      var doc = {
        exported_at: iso(), version: VERSION, site: { name: cfg.site_name, url: cfg.site_url }, tags: tagVocabulary(st),
        entries: rows.map(function (r) { return adminEntry(st, r, ctx); }),
        runs: st.runs.slice().sort(byId).map(runOut)
      };
      return { type: 'application/json; charset=utf-8', file: base + '.json', body: JSON.stringify(doc, null, 4) + '\n' };
    }
    out = '﻿' + csvRow(['id', 'type', 'state', 'status', 'title', 'body', 'votes', 'tags', 'created_at', 'updated_at',
      'merged_into', 'reject_reason', 'external_url', 'source', 'comments'].map(function (f) { return csvField(f); }));
    rows.forEach(function (r) {
      var comments = (ctx.pub[r.id] || []).map(function (c) { return c.body; });
      out += csvRow([
        String(r.id), csvField(r.type), csvField(r.state), csvField(r.status), csvField(r.title, true), csvField(r.body, true), String(r.votes),
        csvField(r.tags.join(';')), csvField(r.created_at), csvField(r.updated_at), r.merged_into === null ? '' : String(r.merged_into),
        csvField(r.reject_reason), csvField(r.external_url), csvField(r.source), csvField(comments.join('\n\n'), true)
      ]);
    });
    return { type: 'text/csv; charset=utf-8', file: base + '.csv', body: out };
  }
  function hExport(st, req) {
    return { raw: exportFile(st, qstr(req.query, 'format') || 'json', qstr(req.query, 'state')) };
  }

  // ---- Routing (router.php) -----------------------------------------------------------

  var PUBLIC_ROUTES = { list: ['GET', hList], session: ['POST', hSession], add: ['POST', hAdd], vote: ['POST', hVote], report: ['POST', hReport], mine: ['POST', hMine] };
  var ADMIN_ROUTES = {
    'admin.me': ['GET', hMe], 'admin.logout': ['POST', hLogout], 'admin.queue': ['GET', hQueue], 'admin.apply': ['POST', hApply],
    'admin.create': ['POST', hCreate], 'admin.update': ['POST', hUpdate], 'admin.comment': ['POST', hComment],
    'admin.comment_update': ['POST', hCommentUpdate], 'admin.undo': ['POST', hUndo], 'admin.entry': ['GET', hEntry],
    'admin.export': ['GET', hExport], 'admin.entries': ['GET', hEntries], 'admin.log': ['GET', hLog], 'admin.runs': ['GET', hRuns],
    'admin.stats': ['GET', hStats], 'admin.dismiss_reports': ['POST', hDismissReports], 'admin.block': ['POST', hBlock],
    'admin.unblock': ['POST', hUnblock]
  };

  // Answer one request against fresh state. Returns {status, body} or {status, raw}; saves the state when it changed.
  function respond(method, action, query, headers, rawBody) {
    var st = load(), before = JSON.stringify(st), parsed = null;
    var req = {
      method: method, query: query, headers: headers,
      body: function () {
        if (parsed) return parsed;
        var text = rawBody || '';
        if (text.length > (action.indexOf('admin.') === 0 ? 262144 : 16384)) throw new AbError(413, 'bad_request', 'The request body is too large.');
        if (text.trim() === '') return (parsed = {});
        if ((headers['content-type'] || '').toLowerCase().indexOf('application/json') < 0) throw new AbError(415, 'bad_request', 'Send the request body as application/json.');
        var data;
        try { data = JSON.parse(text); } catch (e) { throw new AbError(400, 'bad_request', 'The request body is not valid JSON.'); }
        if (!isObject(data)) throw new AbError(400, 'bad_request', 'The request body must be a JSON object.');
        return (parsed = data);
      }
    };
    var result;
    try {
      var out;
      if (action === 'health') {
        if (method !== 'GET') throw new AbError(405, 'method_not_allowed', 'Use GET.');
        out = hHealth(st, req);
      } else if (action === 'admin.login') {
        if (method !== 'POST') throw new AbError(405, 'method_not_allowed', 'Use POST.');
        out = hLogin(st, req);
      } else {
        var isAdmin = action.indexOf('admin.') === 0;
        var routes = isAdmin ? ADMIN_ROUTES : PUBLIC_ROUTES;
        var route = has(routes, action) ? routes[action] : null;
        if (!route) throw new AbError(404, 'not_found', 'Unknown action.');
        if (method !== route[0]) throw new AbError(405, 'method_not_allowed', 'Use ' + route[0] + ' for this action.');
        out = route[1](st, req, isAdmin ? authenticate(req, method === 'POST') : null);
      }
      var status = out.status || 200;
      delete out.status;
      result = out.raw ? { status: status, raw: out.raw } : { status: status, body: has(out, 'ok') ? out : Object.assign({ ok: true }, out) };
    } catch (e) {
      if (!(e instanceof AbError)) throw e;
      var body = { ok: false, error: e.code, message: e.message };
      if (e.field !== null) body.field = e.field;
      if (e.retryAfter !== null) body.retry_after = e.retryAfter;
      return { status: e.status, body: body, retryAfter: e.retryAfter };
    }
    var after = JSON.stringify(st);
    if (after !== before) {
      write(STATE_KEY, after);
      changed();
    }
    return result;
  }

  function changed() {
    try { window.dispatchEvent(new window.CustomEvent('arghbox-demo:change')); } catch (e) { /* no events here */ }
  }

  // ---- The fetch override ----------------------------------------------------------------

  function normalizeHeaders(h, into) {
    if (!h) return;
    if (Array.isArray(h)) h.forEach(function (p) { into[String(p[0]).toLowerCase()] = String(p[1]).trim(); });
    else if (typeof h.forEach === 'function') h.forEach(function (v, k) { into[String(k).toLowerCase()] = String(v).trim(); });
    else Object.keys(h).forEach(function (k) { into[k.toLowerCase()] = String(h[k]).trim(); });
  }
  function abortError() {
    if (typeof DOMException === 'function') return new DOMException('The operation was aborted.', 'AbortError');
    var e = new Error('The operation was aborted.');
    e.name = 'AbortError';
    return e;
  }
  function delay(signal) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        if (signal && signal.removeEventListener) signal.removeEventListener('abort', onAbort);
        resolve();
      }, 120 + Math.random() * 130);
      function onAbort() { clearTimeout(timer); reject(abortError()); }
      if (signal && signal.addEventListener) signal.addEventListener('abort', onAbort);
    });
  }
  function toResponse(res) {
    var headers = { 'Cache-Control': 'no-store' };
    if (res.raw) {
      headers['Content-Type'] = res.raw.type;
      headers['Content-Disposition'] = 'attachment; filename="' + res.raw.file + '"';
      return new Response(res.raw.body, { status: res.status, headers: headers });
    }
    headers['Content-Type'] = 'application/json; charset=utf-8';
    if (res.retryAfter !== undefined && res.retryAfter !== null) headers['Retry-After'] = String(res.retryAfter);
    return new Response(JSON.stringify(res.body), { status: res.status, headers: headers });
  }
  function apiUrl(input) {
    try {
      var raw = typeof input === 'string' ? input : (input && input.url) || String(input);
      var u = new URL(raw, document.baseURI);
      return u.pathname.slice(-API_SUFFIX.length) === API_SUFFIX ? u : null;
    } catch (e) {
      return null;
    }
  }

  function demoFetch(input, init) {
    var url = apiUrl(input);
    if (!url) return origFetch.apply(window, arguments);
    init = init || {};
    var isRequest = input && typeof input === 'object' && typeof input.clone === 'function';
    var method = String(init.method || (isRequest && input.method) || 'GET').toUpperCase();
    var headers = {};
    if (isRequest) normalizeHeaders(input.headers, headers);
    normalizeHeaders(init.headers, headers);
    var signal = init.signal || (isRequest && input.signal) || null;
    if (signal && signal.aborted) return Promise.reject(abortError());
    var bodyP = typeof init.body === 'string' ? Promise.resolve(init.body)
      : isSet(init.body) ? Promise.resolve(String(init.body))
      : isRequest && method !== 'GET' ? input.clone().text() : Promise.resolve('');
    return bodyP.then(function (text) {
      var res = respond(method, url.searchParams.get('action') || '', url.searchParams, headers, text);
      return delay(signal).then(function () { return toResponse(res); });
    });
  }

  // A link to an export is a navigation, which fetch cannot answer: build the file here and save it.
  function onClick(ev) {
    var a = ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('a[href]') : null;
    if (!a) return;
    var url = apiUrl(a.href);
    if (!url || url.searchParams.get('action') !== 'admin.export' || !session()) return;
    var file;
    try { file = exportFile(load(), url.searchParams.get('format') || 'json', url.searchParams.get('state') || ''); } catch (e) { return; }
    ev.preventDefault();
    var blob = new Blob([file.body], { type: file.type });
    var href = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = href;
    link.download = file.file;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
  }

  // ---- A Turnstile stand-in: the widget never loads anything from Cloudflare ---------------

  function installTurnstile() {
    if (window.turnstile) return;
    var widgets = {}, n = 0;
    var run = function (id) {
      var w = widgets[id];
      if (!w) return;
      w.token = 'demo-token-' + (++n);
      setTimeout(function () { if (widgets[id] && widgets[id].opts.callback) widgets[id].opts.callback(w.token); }, 5);
    };
    window.turnstile = {
      render: function (el, opts) {
        var id = 'demo-ts-' + (Object.keys(widgets).length + 1);
        widgets[id] = { opts: opts || {}, token: null };
        if ((opts || {}).execution !== 'execute') run(id);
        return id;
      },
      execute: run,
      reset: function (id) { if (widgets[id]) widgets[id].token = null; },
      remove: function (id) { delete widgets[id]; },
      getResponse: function (id) { return widgets[id] ? widgets[id].token : undefined; }
    };
  }

  // ---- The seed: Contoso Tasks ----------------------------------------------------------

  function load() {
    var st = null;
    try { st = JSON.parse(read(STATE_KEY) || 'null'); } catch (e) { st = null; }
    if (whole(st)) return st;
    // Missing, from another schema version, or damaged: start over with the seed. Bump SCHEMA when the shape changes.
    st = seed();
    write(STATE_KEY, JSON.stringify(st));
    return st;
  }

  function whole(st) {
    if (!isObject(st) || st.v !== SCHEMA || !isObject(st.settings) || !isObject(st.next)) return false;
    return ['entries', 'votes', 'comments', 'reports', 'blocks', 'actions', 'runs'].every(function (k) { return Array.isArray(st[k]); }) &&
      ['entry', 'vote', 'comment', 'report', 'block', 'action', 'run'].every(function (k) { return isInt(st.next[k]); });
  }

  function seed() {
    var st = {
      v: SCHEMA,
      settings: {
        site_name: 'Contoso Tasks', site_url: '', about: 'A to-do app for the web, iPhone and Android.', moderation: 'pending',
        welcome: 'This is a demo: what you add waits for review. Publish it yourself on the admin page (password: demo).', credit: true, contact: '', max_links: 2, report_hide_at: 3, block_days: 90, auto_apply_min_confidence: 80,
        tags: ['tasks', 'design', 'mobile', 'sharing', 'dates', 'export']
      },
      next: { entry: 1, vote: 1, comment: 1, report: 1, block: 1, action: 1, run: 1 },
      entries: [], votes: [], comments: [], reports: [], blocks: [], actions: [], runs: []
    };
    var t0 = Date.now();
    var ago = function (minutes) { return iso(t0 - minutes * 60000); };
    var days = function (d) { return d * 1440; };
    var web = { page: '/', lang: 'en', browser: 'Chrome', os: 'Windows', screen: 'large' };
    var ios = { page: '/', lang: 'en', browser: 'Safari', os: 'iOS', screen: 'small', app: { platform: 'ios', version: '5.12.1' } };
    var android = { page: '/', lang: 'en', browser: 'Chrome', os: 'Android', screen: 'small', app: { platform: 'android', version: '5.12.1' } };
    var authors = 0;
    var authorHashes = ['4f9a1c07', '9b21e5d3', 'c7d08a64', '1e5b93f2', 'a3c6d712', '7d4e0b98', 'e92f6a15', '58b1c4de', '3a7f9e20', 'b6d25c81',
      '0c8e7a43', 'f14d3b69', '62a9e0c5', 'd05b8f17', '8e3c61a9', '29f7d4b0', '45a0e8c3', 'ba1d6f72', '71c3a5e8'];

    // A visitor entry (or an owner item when f.source is 'owner') with n votes and optional public comments.
    function add(f, n, comments) {
      var visitor = f.source !== 'owner';
      var author = visitor ? authorHashes[authors++] : '';
      var row = insertEntry(st, Object.assign({ author_hash: author, author_voter: visitor ? 'v' + author + 'seedvoter' : '' }, f));
      for (var i = 0; i < n; i++) {
        insertVote(st, row.id, i === 0 && visitor ? row.author_voter : 'seed-' + row.id + '-' + i, 'seed' + (i % 7), null, row.created_at);
      }
      recount(st, row.id);
      (comments || []).forEach(function (c) { insertComment(st, row.id, c[0], true, c[1]); });
      return row;
    }

    // The published board (ids 1 to 12).
    var recurring = add({ type: 'idea', title: 'Recurring tasks', body: 'Let me repeat a task every Monday, or on the first day of each month.', state: 'published', status: 'planned', status_at: ago(days(5)), tags: ['tasks'], created_at: ago(days(40)), context: web },
      29, [['Planned for the next release. Weekly and monthly first, custom rules after that.', ago(days(5))]]);
    add({ type: 'idea', title: 'Dark mode', body: 'The app is very bright at night. Please follow the phone\'s dark setting.', state: 'published', status: 'in_progress', status_at: ago(days(3)), tags: ['design', 'mobile'], created_at: ago(days(30)), context: ios },
      27, [['Started. The web app gets it first, the phone apps right after.', ago(days(3))]]);
    add({ type: 'idea', title: 'Share a list with my family', body: 'One shopping list that my partner and I can both tick off.', state: 'published', tags: ['sharing'], created_at: ago(days(26)), context: android }, 21);
    add({ type: 'idea', title: 'Calendar view', body: 'See the week\'s tasks laid out by day.', state: 'published', tags: ['dates'], created_at: ago(days(22)), context: web }, 17);
    add({ type: 'idea', source: 'owner', title: 'Home screen widgets for iPhone and Android', body: 'Show today\'s tasks on the home screen, without opening the app.', state: 'published', status: 'planned', status_at: ago(days(9)), tags: ['mobile'], created_at: ago(days(20)) }, 15);
    add({ type: 'bug', title: 'Due dates move by one day after I travel', body: 'I set a task for Friday in Lisbon, and in New York it says Thursday.', state: 'published', status: 'in_progress', status_at: ago(days(2)), tags: ['dates'], created_at: ago(days(18)), context: Object.assign({}, ios, { page: '/tasks' }) }, 12);
    add({ type: 'idea', title: 'Keyboard shortcuts', body: 'N for a new task, J and K to move, X to tick it off.', state: 'published', tags: ['design'], created_at: ago(days(15)), context: web }, 11);
    add({ type: 'bug', title: 'The checkbox is hard to tap on small phones', body: 'The tick box is tiny. I miss it half of the time on my small phone.', state: 'published', status: 'done', status_at: ago(days(6)), tags: ['mobile', 'design'], created_at: ago(days(12)), context: android }, 9,
      [['Fixed in version 5.12. The tap area is twice as big now.', ago(days(6))]]);
    add({ type: 'idea', title: 'A desktop app', body: 'A real desktop app with notifications would be nice.', state: 'published', status: 'declined', status_at: ago(days(20)), created_at: ago(days(45)), context: web }, 8,
      [['We keep Contoso Tasks in the browser and on phones, so it works everywhere without another install.', ago(days(20))]]);
    add({ type: 'question', title: 'Can I import my tasks from a spreadsheet?', body: 'I have my tasks in a spreadsheet. Is there a way to bring them in?', state: 'published', status: 'done', status_at: ago(days(25)), created_at: ago(days(28)), context: web }, 6,
      [['Yes: Settings, then Import, then CSV. Columns: title, due date, list.', ago(days(25))]]);
    var worst = add({ type: 'bug', title: 'Worst app ever, total waste of time', body: 'Nothing works. Do not download.', state: 'published', created_at: ago(days(2)), context: web }, 1);
    add({ type: 'bug', source: 'owner', title: 'Write the help page for shared lists', body: '', state: 'private', status: 'in_progress', created_at: ago(days(3)) }, 0);

    // Two people reported the worst app already: one more report hides it (report_hide_at is 3).
    [['abusive', 'rep-a-seedvoter', 'a1b2c3d4', ago(days(1))], ['other', 'rep-b-seedvoter', 'e5f6a7b8', ago(1200)]].forEach(function (r) {
      st.reports.push({ id: nextId(st, 'report'), entry_id: worst.id, reason: r[0], voter: r[1], ip: r[2], created_at: r[3], cleared_at: null, cleared_by: null });
    });

    // An older duplicate, merged before the triage run: its vote moved to Recurring tasks.
    var french = add({ type: 'idea', title: 'Tâches récurrentes', body: 'Je voudrais répéter une tâche chaque semaine.', state: 'published', created_at: ago(days(20)), context: Object.assign({}, web, { lang: 'fr' }) }, 1);
    insertVote(st, recurring.id, french.author_voter, 'seed0', french.id, french.created_at);
    recount(st, recurring.id);
    french.state = 'merged';
    french.merged_into = recurring.id;
    french.updated_at = ago(days(19));

    // Two new entries wait for the owner.
    add({ type: 'idea', title: 'Sync with my Outlook calendar', body: 'Show tasks with a due date in my Outlook calendar.', state: 'pending', created_at: ago(25), context: Object.assign({}, android, { page: '/settings' }) }, 1);
    add({ type: 'bug', title: 'Reminders arrive twice', body: 'Every reminder buzzes two times, a minute apart.', state: 'pending', created_at: ago(70), context: Object.assign({}, ios, { page: '/reminders' }) }, 1);

    // One AI triage run, two hours ago, applied through the real admin.apply logic.
    var triage = [
      { type: 'idea', title: 'Repeat a task every week', body: 'I want a task to come back every week without typing it again.', created_at: ago(350), context: web },
      { type: 'idea', title: 'Best crypto signals, join now www.example.net', body: 'Free signals every day: www.example.net/join', created_at: ago(300), context: web },
      { type: 'bug', title: 'Export to PDF cuts off long lists', body: 'When a list has more than 40 tasks, the PDF stops after the first page.', created_at: ago(270), context: web },
      { type: 'question', title: 'Is my data private?', body: 'Who can see my tasks? Are they stored in the EU?', created_at: ago(240), context: web },
      { type: 'idea', title: 'test', body: '', created_at: ago(210), context: web },
      { type: 'idea', title: 'make it better', body: '', created_at: ago(180), context: android }
    ].map(function (f) { return add(Object.assign({ state: 'pending' }, f), 1); });
    var verdict = [
      { action: 'merge', merge_into: recurring.id, confidence: 95, reason: 'Same request as #' + recurring.id + ' Recurring tasks.' },
      { action: 'reject', reject_reason: 'spam', block_author: true, confidence: 99, reason: 'Advertising link, nothing about the app.' },
      { action: 'publish', tags: ['export'], confidence: 90, reason: 'Clear, reproducible bug.' },
      { action: 'publish', confidence: 88, reason: 'A normal question about the product.' },
      { action: 'reject', reject_reason: 'test', confidence: 97, reason: 'A test entry with no content.' },
      { action: 'publish', confidence: 55, reason: 'Too vague to act on. Ask what should be better, or reject as unclear.' }
    ];
    var decisions = triage.map(function (row, i) {
      return Object.assign({ id: row.id, fingerprint: fingerprint(st, row) }, verdict[i]);
    });
    var digest = '- 6 new entries: 1 spam (author blocked), 1 test, 1 duplicate of #' + recurring.id + ' Recurring tasks (now 31 votes).\n' +
      '- Published: bug #' + triage[2].id + ' (PDF export) and question #' + triage[3].id + ' (is my data private?).\n' +
      '- #' + triage[5].id + ' flagged: too vague to act on. Ask what should be better, or reject it as unclear.';
    clock = t0 - 120 * 60000;
    try {
      applyDecisions(st, { run: { digest: digest }, decisions: decisions }, 'owner', 'claude');
    } finally {
      clock = null;
    }
    return st;
  }

  // ---- The public face -------------------------------------------------------------------------

  function reset() {
    var keys = [STATE_KEY, ADMIN_KEY];
    if (!broken) {
      try {
        for (var i = 0; i < window.localStorage.length; i++) {
          var k = window.localStorage.key(i);
          if (k && k.indexOf('arghbox:') === 0) keys.push(k);
        }
      } catch (e) { broken = true; }
    }
    Object.keys(memory).forEach(function (k) { if (k.indexOf('arghbox:') === 0) keys.push(k); });
    keys.forEach(remove);
    changed();
  }

  window.ArghBoxDemo = { password: PASSWORD, reset: reset, state: function () { return clone(load()); } };
  if (origFetch) window.fetch = demoFetch;
  installTurnstile();
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', onClick, true);
  // "Reset the demo" in another tab or frame: this page still shows the old box, so it starts over too.
  if (window.addEventListener) {
    window.addEventListener('storage', function (e) {
      if (e.key === null || (e.key === STATE_KEY && e.newValue === null)) window.location.reload();
    });
  }
})();
