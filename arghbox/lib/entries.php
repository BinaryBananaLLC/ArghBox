<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

const AB_TYPES = ['idea', 'bug', 'question'];
const AB_STATES = ['pending', 'published', 'rejected', 'merged', 'flagged', 'private'];
const AB_REJECT_REASONS = ['spam', 'abuse', 'off_topic', 'test', 'unclear', 'other'];
const AB_REPORT_REASONS = ['spam', 'abusive', 'off_topic', 'other'];
const AB_STATUSES = ['open', 'planned', 'in_progress', 'done', 'declined'];
const AB_MUTABLE = ['state', 'status', 'status_at', 'type', 'title', 'body', 'merged_into', 'reject_reason', 'tags', 'external_url', 'ai'];

// ---- Text cleaning ------------------------------------------------------

function ab_strlen(string $s): int
{
    if (function_exists('mb_strlen')) {
        return mb_strlen($s, 'UTF-8');
    }
    return (int)preg_match_all('/./su', $s);
}

function ab_truncate(string $s, int $max): string
{
    if (ab_strlen($s) <= $max) {
        return $s;
    }
    if (function_exists('mb_substr')) {
        return mb_substr($s, 0, $max, 'UTF-8');
    }
    return preg_match('/^.{0,' . $max . '}/su', $s, $m) ? $m[0] : '';
}

function ab_require_utf8(string $s, string $field): void
{
    if (preg_match('//u', $s) !== 1) {
        throw ab_invalid($field, 'The text is not valid UTF-8.');
    }
}

/**
 * Remove invisible and direction-changing characters: control characters (keeping "\n" when asked),
 * zero-width characters U+200B-U+200F, bidi controls U+202A-U+202E and U+2066-U+2069, U+2060-U+2064 and U+FEFF.
 */
function ab_strip_invisible(string $s, bool $keepNewline = false): string
{
    $re = $keepNewline
        ? '/(?!\n)[\p{Cc}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2069}\x{FEFF}]/u'
        : '/[\p{Cc}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2069}\x{FEFF}]/u';
    return preg_replace($re, '', $s) ?? '';
}

function ab_clean_title($v): string
{
    if (!is_string($v)) {
        throw ab_invalid('title', 'Please give it a title.');
    }
    ab_require_utf8($v, 'title');
    $s = preg_replace('/\p{Cc}+/u', ' ', $v) ?? '';
    $s = ab_strip_invisible($s);
    $s = trim(preg_replace('/\s+/u', ' ', $s) ?? '');
    $n = ab_strlen($s);
    if ($n < 4) {
        throw ab_invalid('title', 'The title is too short (at least 4 characters).');
    }
    if (preg_match('/[\p{L}\p{N}]/u', $s) !== 1) {
        throw ab_invalid('title', 'The title needs at least one letter or digit.');
    }
    if ($n > 120) {
        throw ab_invalid('title', 'The title is too long (at most 120 characters).');
    }
    return $s;
}

function ab_clean_body($v): string
{
    if ($v === null) {
        return '';
    }
    if (!is_string($v)) {
        throw ab_invalid('body', 'The details must be text.');
    }
    ab_require_utf8($v, 'body');
    $s = str_replace(["\r\n", "\r"], "\n", $v);
    $s = str_replace("\t", ' ', $s);
    $s = preg_replace('/[\x00-\x09\x0B-\x1F\x7F]/', '', $s) ?? '';
    $s = trim(ab_strip_invisible($s, true));
    if (ab_strlen($s) > 2000) {
        throw ab_invalid('body', 'The details are too long (at most 2000 characters).');
    }
    return $s;
}

function ab_check_links(string $title, string $body, int $max): void
{
    // One link per URL: http(s)://anything, or a bare www.anything that is not already part of a URL.
    $n = (int)preg_match_all('~https?://\S+|(?<![A-Za-z0-9.-])www\.\S+~i', $title . "\n" . $body);
    if ($n > $max) {
        throw ab_invalid('body', 'Too many links. At most ' . $max . ' allowed.');
    }
}

function ab_clean_context($ctx): array
{
    $out = [];
    if (!is_array($ctx)) {
        return $out;
    }
    if (isset($ctx['page']) && is_string($ctx['page'])) {
        $p = $ctx['page'];
        $cut = strcspn($p, '?#');
        $p = substr($p, 0, $cut);
        $p = preg_replace('/[\x00-\x1F\x7F]/', '', $p) ?? '';
        if ($p !== '' && $p[0] === '/' && preg_match('//u', $p) === 1) {
            $out['page'] = ab_truncate($p, 200);
        }
    }
    if (isset($ctx['lang']) && is_string($ctx['lang']) && preg_match('/^[A-Za-z-]{1,12}$/', $ctx['lang'])) {
        $out['lang'] = $ctx['lang'];
    }
    foreach (['browser', 'os'] as $k) {
        if (isset($ctx[$k]) && is_string($ctx[$k]) && preg_match('//u', $ctx[$k]) === 1) {
            $s = trim(ab_strip_invisible($ctx[$k]));
            if ($s !== '') {
                $out[$k] = ab_truncate($s, 40);
            }
        }
    }
    if (isset($ctx['screen']) && in_array($ctx['screen'], ['small', 'medium', 'large'], true)) {
        $out['screen'] = $ctx['screen'];
    }
    // The mobile app page sends {platform, version}; invalid members are dropped, never an error.
    if (isset($ctx['app']) && is_array($ctx['app'])) {
        $app = [];
        if (isset($ctx['app']['platform']) && is_string($ctx['app']['platform']) && in_array($ctx['app']['platform'], ['ios', 'android', 'other'], true)) {
            $app['platform'] = $ctx['app']['platform'];
        }
        if (isset($ctx['app']['version']) && is_string($ctx['app']['version']) && preg_match('/^[0-9A-Za-z._+-]{1,20}$/D', $ctx['app']['version'])) {
            $app['version'] = $ctx['app']['version'];
        }
        if ($app) {
            $out['app'] = $app;
        }
    }
    return $out;
}

// ---- Tags ---------------------------------------------------------------

/** Validate a tags array; returns sorted unique list. Throws invalid_input (field tags). */
function ab_clean_tags($v): array
{
    if ($v === null) {
        return [];
    }
    if (!is_array($v) || (count($v) > 0 && array_keys($v) !== range(0, count($v) - 1))) {
        throw ab_invalid('tags', 'Tags must be a list.');
    }
    $out = [];
    foreach ($v as $t) {
        if (!is_string($t)) {
            throw ab_invalid('tags', 'Each tag must be text.');
        }
        $t = strtolower(trim(ab_strip_invisible($t)));
        if (!preg_match('/^[a-z0-9][a-z0-9-]{1,23}$/', $t)) {
            throw ab_invalid('tags', 'A tag is 2 to 24 characters: a-z, 0-9 and hyphens.');
        }
        $out[$t] = true;
    }
    $out = array_keys($out);
    if (count($out) > 3) {
        throw ab_invalid('tags', 'At most 3 tags.');
    }
    sort($out, SORT_STRING);
    return $out;
}

function ab_tags_json(array $tags): string
{
    return json_encode(array_values($tags), JSON_UNESCAPED_UNICODE);
}

function ab_tags_of($raw): array
{
    $d = is_string($raw) ? json_decode($raw, true) : null;
    return is_array($d) ? array_values($d) : [];
}

/** Validate an external link; '' or null clears it. Returns the URL or null. */
function ab_clean_url($v): ?string
{
    if ($v === null) {
        return null;
    }
    if (!is_string($v)) {
        throw ab_invalid('external_url', 'The link must be text.');
    }
    $v = trim($v);
    if ($v === '') {
        return null;
    }
    if (strlen($v) > 500) {
        throw ab_invalid('external_url', 'The link is too long (at most 500 characters).');
    }
    $p = parse_url($v);
    if (preg_match('/[\x00-\x20\x7F]/', $v) || !is_array($p) || !in_array(strtolower((string)($p['scheme'] ?? '')), ['http', 'https'], true) || isset($p['user']) || isset($p['pass'])
        || empty($p['host']) || filter_var($v, FILTER_VALIDATE_URL) === false) {
        throw ab_invalid('external_url', 'The link must be a valid http or https URL.');
    }
    return $v;
}

// ---- Rows, snapshots, fingerprints --------------------------------------

function ab_entry_row(PDO $db, int $id): ?array
{
    return ab_one($db, 'SELECT * FROM entries WHERE id = ?', [$id]);
}

function ab_fingerprint(array $r): string
{
    $parts = [
        (string)$r['id'], $r['state'], $r['status'], $r['type'], $r['title'], $r['body'],
        $r['merged_into'] === null ? '' : (string)$r['merged_into'],
    ];
    // Open reports are part of the fingerprint (SPEC 5): a new report makes a stale decision `changed`.
    $open = ab_open_report_ids(ab_db(), (int)$r['id']);
    if ($open) {
        $parts[] = 'r:' . implode(',', $open);
    }
    $s = implode('|', $parts);
    return substr(hash('sha256', $s), 0, 16);
}

function ab_snapshot(array $r): array
{
    $s = [];
    foreach (AB_MUTABLE as $k) {
        $s[$k] = $r[$k] ?? null;
    }
    if ($s['merged_into'] !== null) {
        $s['merged_into'] = (int)$s['merged_into'];
    }
    return $s;
}

/** Follow merged_into to the final (non-merged) target. Returns null when the entry does not exist. */
function ab_resolve_target(PDO $db, int $id): ?int
{
    $cur = $id;
    for ($i = 0; $i < 50; $i++) {
        $r = ab_one($db, 'SELECT id, state, merged_into FROM entries WHERE id = ?', [$cur]);
        if ($r === null) {
            return null;
        }
        if ($r['state'] !== 'merged' || $r['merged_into'] === null) {
            return (int)$r['id'];
        }
        $cur = (int)$r['merged_into'];
    }
    return null;
}

function ab_recount(PDO $db, int $id): int
{
    $n = (int)ab_scalar($db, 'SELECT COUNT(*) FROM votes WHERE entry_id = ?', [$id]);
    $db->prepare('UPDATE entries SET votes = ? WHERE id = ?')->execute([$n, $id]);
    return $n;
}

function ab_comment_row_out(array $c): array
{
    return [
        'id' => (int)$c['id'], 'body' => $c['body'], 'public' => (int)$c['public'] === 1,
        'hidden' => (int)$c['hidden'] === 1, 'created_at' => $c['created_at'], 'updated_at' => $c['updated_at'],
    ];
}

/**
 * Context for rendering entries: merged aliases and comments.
 * @return array{count: array<int,int>, titles: array<int,array<int,string>>, pub: array<int,array>, all: array<int,array>}
 */
function ab_alias_info(PDO $db): array
{
    $rows = ab_all($db, "SELECT id, title, merged_into FROM entries WHERE state = 'merged' AND merged_into IS NOT NULL ORDER BY id DESC");
    $map = [];
    foreach ($rows as $r) {
        $map[(int)$r['id']] = (int)$r['merged_into'];
    }
    $count = [];
    $titles = [];
    foreach ($rows as $r) {
        $t = (int)$r['merged_into'];
        for ($i = 0; $i < 50 && isset($map[$t]); $i++) {
            $t = $map[$t];
        }
        $count[$t] = ($count[$t] ?? 0) + 1;
        if (!isset($titles[$t]) || count($titles[$t]) < 10) {
            $titles[$t][] = (string)$r['title'];
        }
    }
    $pub = [];
    $all = [];
    foreach (ab_all($db, 'SELECT * FROM comments ORDER BY id') as $c) {
        $eid = (int)$c['entry_id'];
        $all[$eid][] = ab_comment_row_out($c);
        if ((int)$c['public'] === 1 && (int)$c['hidden'] === 0 && count($pub[$eid] ?? []) < 20) {
            $pub[$eid][] = ['body' => $c['body'], 'at' => $c['created_at']];
        }
    }
    $reports = [];
    foreach (ab_all($db, 'SELECT entry_id, reason, created_at FROM reports WHERE cleared_at IS NULL ORDER BY id') as $r) {
        $eid = (int)$r['entry_id'];
        $reports[$eid] = $reports[$eid] ?? ab_empty_reports();
        $reports[$eid]['open']++;
        $reports[$eid]['reasons'][$r['reason']] = ($reports[$eid]['reasons'][$r['reason']] ?? 0) + 1;
        if ($reports[$eid]['last_at'] === null || $r['created_at'] > $reports[$eid]['last_at']) {
            $reports[$eid]['last_at'] = $r['created_at'];
        }
    }
    foreach (ab_all($db, 'SELECT entry_id, COUNT(*) AS n FROM reports GROUP BY entry_id') as $r) {
        $eid = (int)$r['entry_id'];
        $reports[$eid] = $reports[$eid] ?? ab_empty_reports();
        $reports[$eid]['total'] = (int)$r['n'];
    }
    return ['count' => $count, 'titles' => $titles, 'pub' => $pub, 'all' => $all, 'reports' => $reports, 'blocks' => ab_active_blocks($db)];
}

function ab_empty_reports(): array
{
    return ['open' => 0, 'total' => 0, 'reasons' => array_fill_keys(AB_REPORT_REASONS, 0), 'last_at' => null];
}

function ab_empty_ctx(): array
{
    return ['count' => [], 'titles' => [], 'pub' => [], 'all' => [], 'reports' => [], 'blocks' => []];
}

function ab_public_entry(array $r, array $ctx): array
{
    $id = (int)$r['id'];
    return [
        'id' => $id,
        'type' => $r['type'],
        'title' => $r['title'],
        'body' => $r['body'],
        'votes' => (int)$r['votes'],
        'status' => $r['status'],
        'status_at' => $r['status_at'],
        'tags' => ab_tags_of($r['tags']),
        'comments' => $ctx['pub'][$id] ?? [],
        'similar' => $ctx['count'][$id] ?? 0,
        'aliases' => $ctx['titles'][$id] ?? [],
        'source' => $r['source'],
        'created_at' => $r['created_at'],
    ];
}

function ab_json_field($raw)
{
    if (!is_string($raw) || $raw === '') {
        return null;
    }
    $d = json_decode($raw, true);
    return is_array($d) ? ab_obj($d) : null;
}

function ab_admin_entry(array $r, array $ctx): array
{
    $id = (int)$r['id'];
    return array_merge(ab_public_entry($r, $ctx), [
        'comments' => $ctx['all'][$id] ?? [],
        'state' => $r['state'],
        'merged_into' => $r['merged_into'] === null ? null : (int)$r['merged_into'],
        'reject_reason' => $r['reject_reason'],
        'external_url' => $r['external_url'] ?? null,
        'title_original' => $r['title_original'],
        'body_original' => $r['body_original'],
        'context' => ab_json_field($r['context']) ?? new stdClass(),
        'ai' => ab_json_field($r['ai']),
        'author' => substr((string)$r['author_hash'], 0, 8),
        'fingerprint' => ab_fingerprint($r),
        'updated_at' => $r['updated_at'],
        'reports' => $ctx['reports'][$id] ?? ab_empty_reports(),
        'author_blocked' => ab_row_author_blocked($r, $ctx['blocks'] ?? []),
    ]);
}

// ---- Creation -----------------------------------------------------------

/** Insert an entry row (no votes yet). Returns the new id. */
function ab_insert_entry(PDO $db, array $f): int
{
    $now = ab_iso();
    $created = $f['created_at'] ?? $now;
    $status = $f['status'] ?? 'open';
    $statusAt = $f['status_at'] ?? ($status !== 'open' ? $created : null);
    $st = $db->prepare('INSERT INTO entries(type, title, body, title_original, body_original, source, state, status, status_at,
        merged_into, reject_reason, tags, votes, context, ai, author_hash, author_voter, receipt_hash, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?, ?, ?)');
    $st->execute([
        $f['type'], $f['title'], $f['body'], $f['title'], $f['body'], $f['source'] ?? 'visitor', $f['state'], $status,
        $statusAt, $f['merged_into'] ?? null, $f['reject_reason'] ?? null, ab_tags_json($f['tags'] ?? []),
        json_encode($f['context'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        $f['author_hash'] ?? '', $f['author_voter'] ?? '', $f['receipt_hash'] ?? '', $created, $created,
    ]);
    return (int)$db->lastInsertId();
}

/** Insert a vote unless the voter already has one on the entry. Returns the new vote id or null. */
function ab_insert_vote(PDO $db, int $entryId, string $voterHash, string $ipHash, ?int $movedFrom = null, ?string $at = null): ?int
{
    $st = $db->prepare('INSERT OR IGNORE INTO votes(entry_id, voter_hash, ip_hash, moved_from, created_at) VALUES(?, ?, ?, ?, ?)');
    $st->execute([$entryId, $voterHash, $ipHash, $movedFrom, $at ?? ab_iso()]);
    return $st->rowCount() > 0 ? (int)$db->lastInsertId() : null;
}

function ab_insert_comment(PDO $db, int $entryId, string $body, bool $public, ?string $at = null): int
{
    $at = $at ?? ab_iso();
    $db->prepare('INSERT INTO comments(entry_id, body, public, hidden, created_at, updated_at) VALUES(?, ?, ?, 0, ?, ?)')
        ->execute([$entryId, $body, $public ? 1 : 0, $at, $at]);
    return (int)$db->lastInsertId();
}
