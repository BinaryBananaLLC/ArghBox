<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

const AB_ADMIN_BODY_MAX = 262144;

function ab_int_param(string $name, int $default, int $min, int $max): int
{
    $v = $_GET[$name] ?? null;
    if (!is_string($v) || !preg_match('/^-?\d+$/', $v)) {
        return $default;
    }
    return max($min, min($max, (int)$v));
}

/** Triage (AI) actors may not put new text on the public board unless triage_public_writes is on. */
function ab_triage_public_denied(string $actor): bool
{
    return ab_actor_is_triage($actor) && !ab_config()['triage_public_writes'];
}

function ab_require_public_allowed(string $actor, string $what): void
{
    if (ab_triage_public_denied($actor)) {
        throw new AbError(403, 'forbidden', 'The triage token cannot ' . $what . '. Do it yourself on the admin page, or set triage_public_writes in config.php if you really want an AI to publish text.');
    }
}

function ab_h_admin_login(): void
{
    $cfg = ab_config();
    ab_require_https();
    $in = ab_body();
    $token = $in['token'] ?? null;
    $ok = is_string($token) && $token !== '' && $cfg['owner_token_sha256'] !== ''
        && hash_equals($cfg['owner_token_sha256'], hash('sha256', $token));
    if (!$ok) {
        // Wrong tokens are throttled; a correct one is always accepted.
        ab_auth_failure();
        throw new AbError(401, 'unauthorized', 'That token is not right.');
    }
    $cookie = ab_admin_cookie_make();
    ab_set_admin_cookie($cookie, ab_now() + 43200);
    ab_ok(['csrf' => ab_csrf_for($cookie)]);
}

function ab_h_admin_logout(array $auth): void
{
    ab_admin_epoch_bump(); // every cookie issued so far stops working
    ab_set_admin_cookie('', ab_now() - 86400);
    ab_ok();
}

function ab_h_admin_me(array $auth): void
{
    $out = ['actor' => $auth['actor']];
    if ($auth['csrf'] !== null) {
        $out['csrf'] = $auth['csrf'];
    }
    ab_ok($out);
}

function ab_tag_vocabulary(PDO $db, array $cfg): array
{
    $counts = [];
    foreach (ab_all($db, "SELECT tags FROM entries WHERE state IN ('published', 'private', 'flagged', 'pending')") as $r) {
        foreach (ab_tags_of($r['tags']) as $t) {
            $counts[$t] = ($counts[$t] ?? 0) + 1;
        }
    }
    $presets = $cfg['tags'] ?? [];
    foreach (is_array($presets) ? $presets : [] as $p) {
        if (is_string($p) && preg_match('/^[a-z0-9][a-z0-9-]{1,23}$/', $p) && !isset($counts[$p])) {
            $counts[$p] = 0;
        }
    }
    $out = [];
    foreach ($counts as $t => $n) {
        $out[] = ['tag' => (string)$t, 'count' => $n];
    }
    usort($out, static fn($a, $b) => [$b['count'], $a['tag']] <=> [$a['count'], $b['tag']]);
    return $out;
}

/** SQL condition: SPEC 6b "reported" = an open report and a live (published, pending, flagged) state. */
const AB_SQL_REPORTED = "state IN ('published', 'pending', 'flagged') AND EXISTS (SELECT 1 FROM reports rp WHERE rp.entry_id = entries.id AND rp.cleared_at IS NULL)";

function ab_svc_queue(): array
{
    $cfg = ab_config();
    $db = ab_db();
    $ctx = ab_alias_info($db);
    $pending = [];
    foreach (ab_all($db, "SELECT * FROM entries WHERE state = 'pending' ORDER BY created_at ASC, id ASC") as $r) {
        $pending[] = ab_admin_entry($r, $ctx);
    }
    $flagged = [];
    foreach (ab_all($db, "SELECT * FROM entries WHERE state = 'flagged' ORDER BY created_at ASC, id ASC") as $r) {
        $flagged[] = ab_admin_entry($r, $ctx);
    }
    $published = [];
    foreach (ab_all($db, "SELECT * FROM entries WHERE state = 'published' ORDER BY votes DESC, id DESC") as $r) {
        $id = (int)$r['id'];
        $published[] = [
            'id' => $id, 'type' => $r['type'], 'title' => $r['title'], 'body' => ab_truncate((string)$r['body'], 300),
            'votes' => (int)$r['votes'], 'status' => $r['status'], 'tags' => ab_tags_of($r['tags']),
            'aliases' => $ctx['titles'][$id] ?? [], 'fingerprint' => ab_fingerprint($r),
        ];
    }
    $private = [];
    foreach (ab_all($db, "SELECT * FROM entries WHERE state = 'private' ORDER BY id DESC") as $r) {
        $private[] = ['id' => (int)$r['id'], 'type' => $r['type'], 'title' => $r['title'], 'status' => $r['status'], 'tags' => ab_tags_of($r['tags'])];
    }
    $reported = [];
    foreach (ab_all($db, "SELECT e.* FROM entries e JOIN (SELECT entry_id, MIN(created_at) AS m FROM reports WHERE cleared_at IS NULL GROUP BY entry_id) r ON r.entry_id = e.id
        WHERE e.state = 'published' AND e.source = 'visitor' ORDER BY r.m ASC, e.id ASC") as $r) {
        $reported[] = ab_admin_entry($r, $ctx);
    }
    return [
        'site' => ['name' => $cfg['site_name'], 'url' => $cfg['site_url'], 'about' => $cfg['about']],
        'moderation' => $cfg['moderation'],
        'auto_apply_min_confidence' => $cfg['auto_apply_min_confidence'],
        'tags' => ab_tag_vocabulary($db, $cfg),
        'pending' => $pending,
        'flagged' => $flagged,
        'published' => $published,
        'private' => $private,
        'reported' => $reported,
    ];
}

function ab_h_admin_queue(array $auth): void
{
    ab_ok(ab_svc_queue());
}

// ---- admin.apply --------------------------------------------------------

function ab_h_admin_apply(array $auth): void
{
    $in = ab_body(AB_ADMIN_BODY_MAX);
    $run = $in['run'] ?? [];
    $run = is_array($run) ? $run : [];
    $reviewer = ab_clean_reviewer($run['reviewer'] ?? null);
    $actor = $auth['via'] === 'triage' ? $auth['actor'] : 'owner';
    ab_ok(ab_svc_apply($in, $actor, $reviewer));
}

/** Apply a batch of triage decisions in one transaction. $in = {run:{digest}, decisions:[...]}. */
function ab_svc_apply(array $in, string $actor, string $reviewer): array
{
    $cfg = ab_config();
    $run = $in['run'] ?? [];
    $run = is_array($run) ? $run : [];
    $decisions = $in['decisions'] ?? null;
    if (!is_array($decisions) || count($decisions) > 1000) {
        throw ab_invalid('decisions', 'decisions must be a list of at most 1000 items.');
    }
    $digest = is_string($run['digest'] ?? null) ? ab_truncate($run['digest'], 2000) : '';
    $minConf = (int)$cfg['auto_apply_min_confidence'];
    $maxLinks = (int)$cfg['limits']['max_links'];

    return ab_tx(static function (PDO $db) use ($decisions, $reviewer, $digest, $actor, $minConf, $maxLinks): array {
        $now = ab_iso();
        $db->prepare('INSERT INTO runs(at, reviewer, counts, digest) VALUES(?, ?, ?, ?)')->execute([$now, $reviewer, '{}', $digest]);
        $runId = (int)$db->lastInsertId();
        $counts = ['publish' => 0, 'reject' => 0, 'merge' => 0, 'flag' => 0, 'tag' => 0, 'keep' => 0, 'block' => 0, 'skipped' => 0];
        $applied = [];
        $skipped = [];
        $skip = static function ($id, string $reason) use (&$skipped, &$counts): void {
            $skipped[] = ['id' => is_int($id) ? $id : null, 'reason' => $reason];
            $counts['skipped']++;
        };

        $first = [];
        $merges = [];
        foreach ($decisions as $d) {
            if (is_array($d) && ($d['action'] ?? null) === 'merge') {
                $merges[] = $d;
            } else {
                $first[] = $d;
            }
        }
        foreach (array_merge($first, $merges) as $d) {
            if (!is_array($d) || !isset($d['id']) || !is_int($d['id'])) {
                $skip(null, 'invalid_input');
                continue;
            }
            $id = $d['id'];
            $action = $d['action'] ?? null;
            if (!is_string($action) || !in_array($action, ['publish', 'reject', 'merge', 'flag', 'tag', 'keep'], true)) {
                $skip($id, 'invalid_input');
                continue;
            }
            $conf = $d['confidence'] ?? null;
            if (!is_int($conf) || $conf < 0 || $conf > 100 || !is_string($d['fingerprint'] ?? null)) {
                $skip($id, 'invalid_input');
                continue;
            }
            $row = ab_entry_row($db, $id);
            if ($row === null) {
                $skip($id, 'not_found');
                continue;
            }
            $state = $row['state'];
            $reported = $state === 'published' && $row['source'] === 'visitor' && ab_open_report_ids($db, $id) !== [];
            $okState = ($state === 'pending' && $action !== 'tag' && $action !== 'keep')
                || ($state === 'published' && ($action === 'merge' || $action === 'tag' || (($action === 'keep' || $action === 'reject') && $reported)));
            if (!$okState) {
                $skip($id, 'invalid_state');
                continue;
            }
            if (!hash_equals(ab_fingerprint($row), $d['fingerprint'])) {
                $skip($id, 'changed');
                continue;
            }
            // Optional wording, type, tags, reason fields.
            try {
                // New wording and a corrected type only ever apply to pending entries being published or flagged.
                $wording = $state === 'pending' && ($action === 'publish' || $action === 'flag');
                $title = null;
                if ($wording && isset($d['title']) && $d['title'] !== '') {
                    $title = ab_clean_title($d['title']);
                    ab_check_links($title, '', $maxLinks);
                }
                $type = null;
                if ($wording && isset($d['type'])) {
                    if (!is_string($d['type']) || !in_array($d['type'], AB_TYPES, true)) {
                        throw ab_invalid('type', 'bad type');
                    }
                    $type = $d['type'];
                }
                $tags = null;
                if (array_key_exists('tags', $d) && ($action === 'publish' || $action === 'flag' || $action === 'tag')) {
                    $tags = ab_clean_tags($d['tags']);
                } elseif ($action === 'tag') {
                    throw ab_invalid('tags', 'tags required');
                }
            } catch (AbError $e) {
                $skip($id, 'invalid_input');
                continue;
            }
            $rejectReason = null;
            if ($action === 'reject') {
                $rejectReason = $d['reject_reason'] ?? null;
                if (!is_string($rejectReason) || !in_array($rejectReason, AB_REJECT_REASONS, true)) {
                    $skip($id, 'invalid_input');
                    continue;
                }
            }
            $blockAuthor = $d['block_author'] ?? false;
            if (!is_bool($blockAuthor) || ($blockAuthor && !($action === 'reject' && in_array($rejectReason, ['spam', 'abuse'], true)))) {
                $skip($id, 'invalid_input');
                continue;
            }
            $reason = is_string($d['reason'] ?? null) ? ab_truncate($d['reason'], 500) : '';
            $titleEn = is_string($d['title_en'] ?? null) ? ab_truncate($d['title_en'], 200) : null;

            $eff = $action;
            $flaggedInstead = false;
            if ($action !== 'flag' && $action !== 'tag' && $conf < $minConf) {
                if ($state === 'published') {
                    $skip($id, 'low_confidence');
                    continue;
                }
                $eff = 'flag';
                $flaggedInstead = true;
            }
            $mergeTarget = null;
            if ($eff === 'merge') {
                [$mergeTarget, $why] = ab_merge_check($db, $id, $d['merge_into'] ?? null);
                if ($mergeTarget === null) {
                    $skip($id, 'merge_target_invalid');
                    continue;
                }
            }
            $ai = [
                'action' => $action, 'confidence' => $conf, 'reason' => $reason, 'title_en' => $titleEn,
                'reviewer' => $reviewer, 'run_id' => $runId, 'at' => $now, 'applied' => !$flaggedInstead,
            ];
            if ($action === 'merge') {
                $ai['merge_into'] = $mergeTarget ?? ($d['merge_into'] ?? null);
            }
            if ($action === 'reject') {
                $ai['reject_reason'] = $rejectReason;
            }
            $changes = ['ai' => ab_jenc($ai)];
            $blocked = false;
            if ($eff === 'keep') {
                ab_dismiss_reports($db, $row, $actor, $runId, $ai);
            } elseif ($eff === 'merge') {
                ab_merge($db, $row, $mergeTarget, $actor, $runId, $changes);
            } else {
                if (!$flaggedInstead && $state === 'pending') {
                    if ($title !== null) {
                        $changes['title'] = $title;
                    }
                    if ($type !== null) {
                        $changes['type'] = $type;
                    }
                }
                if ($tags !== null) {
                    $changes['tags'] = ab_tags_json($tags);
                }
                if ($eff === 'publish') {
                    $changes['state'] = 'published';
                } elseif ($eff === 'reject') {
                    $changes['state'] = 'rejected';
                    $changes['reject_reason'] = $rejectReason;
                } elseif ($eff === 'flag') {
                    $changes['state'] = 'flagged';
                }
                [$row] = ab_change($db, $row, $changes, $eff, $actor, $runId);
                if ($eff === 'reject' && $blockAuthor && ab_block_author($db, $row, $actor, $runId, '', false) !== null) {
                    $counts['block']++;
                    $blocked = true;
                }
            }
            $counts[$eff]++;
            $out = ['id' => $id, 'action' => $eff, 'flagged_instead' => $flaggedInstead];
            if ($blockAuthor) {
                $out['blocked'] = $blocked;
            }
            $applied[] = $out;
        }
        $db->prepare('UPDATE runs SET counts = ? WHERE id = ?')->execute([ab_jenc($counts), $runId]);
        return ['run_id' => $runId, 'applied' => $applied, 'skipped' => $skipped];
    });
}

// ---- admin.create / update / comments ------------------------------------

function ab_admin_entry_out(PDO $db, int $id): array
{
    return ab_admin_entry(ab_entry_row($db, $id), ab_alias_info($db));
}

function ab_h_admin_create(array $auth): void
{
    ab_ok(ab_svc_create(ab_body(AB_ADMIN_BODY_MAX), $auth['actor']));
}

function ab_svc_create(array $in, string $actor): array
{
    ab_config();
    $type = $in['type'] ?? null;
    if (!is_string($type) || !in_array($type, AB_TYPES, true)) {
        throw ab_invalid('type', 'The type must be idea, bug or question.');
    }
    $title = ab_clean_title($in['title'] ?? null);
    $body = ab_clean_body($in['body'] ?? null);
    $status = $in['status'] ?? 'open';
    if (!is_string($status) || !in_array($status, AB_STATUSES, true)) {
        throw ab_invalid('status', 'Unknown status.');
    }
    $tags = ab_clean_tags($in['tags'] ?? null);
    $public = $in['public'] ?? false;
    if (!is_bool($public)) {
        throw ab_invalid('public', '"public" must be true or false.');
    }
    if ($public) {
        ab_require_public_allowed($actor, 'create public items');
    }
    $url = array_key_exists('external_url', $in) ? ab_clean_url($in['external_url']) : null;
    $out = ab_tx(static function (PDO $db) use ($type, $title, $body, $status, $tags, $public, $actor, $url): array {
        $id = ab_insert_entry($db, [
            'type' => $type, 'title' => $title, 'body' => $body, 'source' => 'owner',
            'state' => $public ? 'published' : 'private', 'status' => $status, 'tags' => $tags,
            'author_hash' => '', 'receipt_hash' => '',
        ]);
        if ($url !== null) {
            $db->prepare('UPDATE entries SET external_url = ? WHERE id = ?')->execute([$url, $id]);
        }
        $row = ab_entry_row($db, $id);
        ab_log_action($db, $actor, null, 'create', $id, new stdClass(), ab_snapshot($row));
        return ab_admin_entry_out($db, $id);
    });
    return ['entry' => $out];
}

function ab_h_admin_update(array $auth): void
{
    ab_ok(ab_svc_update(ab_body(AB_ADMIN_BODY_MAX), $auth['actor']));
}

function ab_svc_update(array $in, string $actor): array
{
    ab_config();
    $id = $in['id'] ?? null;
    if (!is_int($id) || $id < 1) {
        throw ab_invalid('id', 'The entry id is missing.');
    }

    // Validate every field before changing anything.
    $edit = [];
    if (array_key_exists('type', $in)) {
        if (!is_string($in['type']) || !in_array($in['type'], AB_TYPES, true)) {
            throw ab_invalid('type', 'The type must be idea, bug or question.');
        }
        $edit['type'] = $in['type'];
    }
    if (array_key_exists('title', $in)) {
        $edit['title'] = ab_clean_title($in['title']);
    }
    if (array_key_exists('body', $in)) {
        $edit['body'] = ab_clean_body($in['body']);
    }
    if (array_key_exists('external_url', $in)) {
        $edit['external_url'] = ab_clean_url($in['external_url']);
    }
    $tags = array_key_exists('tags', $in) ? ab_clean_tags($in['tags']) : null;
    $status = null;
    if (array_key_exists('status', $in)) {
        if (!is_string($in['status']) || !in_array($in['status'], AB_STATUSES, true)) {
            throw ab_invalid('status', 'Unknown status.');
        }
        $status = $in['status'];
    }
    $state = null;
    if (array_key_exists('state', $in)) {
        if (!is_string($in['state']) || !in_array($in['state'], ['published', 'rejected', 'flagged', 'pending', 'private'], true)) {
            throw ab_invalid('state', 'Unknown state.');
        }
        $state = $in['state'];
    }
    $reason = null;
    if (array_key_exists('reject_reason', $in)) {
        if (!is_string($in['reject_reason']) || !in_array($in['reject_reason'], AB_REJECT_REASONS, true)) {
            throw ab_invalid('reject_reason', 'Unknown rejection reason.');
        }
        $reason = $in['reject_reason'];
    }
    $mergeInto = array_key_exists('merge_into', $in) ? $in['merge_into'] : null;
    if ($mergeInto !== null && $state !== null) {
        throw ab_invalid('merge_into', 'Send either state or merge_into, not both.');
    }
    if ($state === 'published') {
        ab_require_public_allowed($actor, 'publish entries (only triage decisions on pending entries can)');
    }
    $gateText = ab_triage_public_denied($actor);

    $out = ab_tx(static function (PDO $db) use ($id, $actor, $edit, $tags, $status, $state, $reason, $mergeInto, $gateText): array {
        $row = ab_entry_row($db, $id);
        if ($row === null) {
            throw new AbError(404, 'not_found', 'That entry does not exist.');
        }
        if ($gateText && $row['state'] === 'published' && ((isset($edit['title']) && $edit['title'] !== $row['title']) || (isset($edit['body']) && $edit['body'] !== $row['body']))) {
            throw new AbError(403, 'forbidden', 'The triage token cannot change the title or text of a published entry. Do it yourself on the admin page, or set triage_public_writes in config.php.');
        }
        // 1. edit
        $changes = [];
        foreach ($edit as $k => $v) {
            if ($row[$k] !== $v) {
                $changes[$k] = $v;
            }
        }
        if ($changes) {
            [$row] = ab_change($db, $row, $changes, 'edit', $actor, null);
        }
        // 2. tags
        if ($tags !== null && ab_tags_json($tags) !== $row['tags']) {
            [$row] = ab_change($db, $row, ['tags' => ab_tags_json($tags)], 'tag', $actor, null);
        }
        // 3. status
        if ($status !== null && $status !== $row['status']) {
            [$row] = ab_change($db, $row, ['status' => $status], 'set_status', $actor, null);
        }
        // 4. state (or only the rejection reason)
        if ($state !== null || ($reason !== null && $row['state'] === 'rejected')) {
            $newState = $state ?? 'rejected';
            if ($row['state'] === 'merged') {
                throw new AbError(409, 'conflict', 'This entry was merged. Undo the merge first.');
            }
            if ($newState === 'private' && $row['source'] !== 'owner') {
                throw ab_invalid('state', 'Only the owner\'s own items can be private.');
            }
            if ($newState === 'pending' && $row['source'] === 'owner') {
                throw ab_invalid('state', 'Owner items cannot go to the triage queue.');
            }
            $newReason = $newState === 'rejected' ? ($reason ?? ($row['state'] === 'rejected' && $row['reject_reason'] ? $row['reject_reason'] : 'other')) : null;
            if ($newState !== $row['state'] || $newReason !== $row['reject_reason']) {
                $kind = ['published' => 'publish', 'rejected' => 'reject', 'flagged' => 'flag', 'pending' => 'pending', 'private' => 'private'][$newState];
                [$row] = ab_change($db, $row, ['state' => $newState, 'reject_reason' => $newReason], $kind, $actor, null);
            }
        }
        // 5. merge
        if ($mergeInto !== null) {
            if ($row['state'] === 'merged') {
                throw new AbError(409, 'conflict', 'This entry is already merged. Undo the merge first.');
            }
            if ($row['state'] === 'private') {
                throw ab_invalid('merge_into', 'Private items cannot be merged.');
            }
            [$final, $why] = ab_merge_check($db, $id, $mergeInto);
            if ($final === null) {
                throw ab_invalid('merge_into', 'Cannot merge: ' . $why . '.');
            }
            [$row] = ab_merge($db, $row, $final, $actor, null);
        }
        return ab_admin_entry_out($db, $id);
    });
    return ['entry' => $out];
}

function ab_h_admin_comment(array $auth): void
{
    ab_ok(ab_svc_comment(ab_body(), $auth['actor']));
}

function ab_svc_comment(array $in, string $actor): array
{
    ab_config();
    $id = $in['id'] ?? null;
    if (!is_int($id) || $id < 1) {
        throw ab_invalid('id', 'The entry id is missing.');
    }
    $body = ab_clean_body($in['body'] ?? null);
    if ($body === '') {
        throw ab_invalid('body', 'The comment is empty.');
    }
    $public = $in['public'] ?? !ab_triage_public_denied($actor);
    if (!is_bool($public)) {
        throw ab_invalid('public', '"public" must be true or false.');
    }
    if ($public) {
        ab_require_public_allowed($actor, 'post public comments (private notes are fine)');
    }
    return ab_tx(static function (PDO $db) use ($id, $body, $public, $actor): array {
        if (ab_entry_row($db, $id) === null) {
            throw new AbError(404, 'not_found', 'That entry does not exist.');
        }
        $cid = ab_insert_comment($db, $id, $body, $public);
        $c = ab_one($db, 'SELECT * FROM comments WHERE id = ?', [$cid]);
        $before = ['comment_id' => $cid, 'body' => '', 'public' => (int)$public, 'hidden' => 1];
        ab_log_action($db, $actor, null, 'comment', $id, $before, ab_comment_snapshot($c));
        return ['comment' => ab_comment_row_out($c), 'entry' => ab_admin_entry_out($db, $id)];
    });
}

function ab_h_admin_comment_update(array $auth): void
{
    ab_ok(ab_svc_comment_update(ab_body(), $auth['actor']));
}

function ab_svc_comment_update(array $in, string $actor): array
{
    ab_config();
    $cid = $in['comment_id'] ?? null;
    if (!is_int($cid) || $cid < 1) {
        throw ab_invalid('comment_id', 'The comment id is missing.');
    }
    $body = null;
    if (array_key_exists('body', $in)) {
        $body = ab_clean_body($in['body']);
        if ($body === '') {
            throw ab_invalid('body', 'The comment is empty. Hide it instead.');
        }
    }
    $flags = [];
    foreach (['public', 'hidden'] as $k) {
        if (array_key_exists($k, $in)) {
            if (!is_bool($in[$k])) {
                throw ab_invalid($k, '"' . $k . '" must be true or false.');
            }
            $flags[$k] = $in[$k] ? 1 : 0;
        }
    }
    $gate = ab_triage_public_denied($actor);
    return ab_tx(static function (PDO $db) use ($cid, $body, $flags, $actor, $gate): array {
        $c = ab_one($db, 'SELECT * FROM comments WHERE id = ?', [$cid]);
        if ($c === null) {
            throw new AbError(404, 'not_found', 'That comment does not exist.');
        }
        if ($gate) {
            $newPublic = $flags['public'] ?? (int)$c['public'];
            $bodyChanges = $body !== null && $body !== $c['body'];
            $unhides = isset($flags['hidden']) && $flags['hidden'] === 0 && (int)$c['hidden'] === 1;
            if ((isset($flags['public']) && $flags['public'] === 1 && (int)$c['public'] === 0) || ($newPublic === 1 && ($bodyChanges || $unhides))) {
                throw new AbError(403, 'forbidden', 'The triage token cannot publish or edit public comments. Do it yourself on the admin page, or set triage_public_writes in config.php.');
            }
        }
        $new = ['body' => $body ?? $c['body'], 'public' => $flags['public'] ?? (int)$c['public'], 'hidden' => $flags['hidden'] ?? (int)$c['hidden']];
        if ($new['body'] !== $c['body'] || $new['public'] !== (int)$c['public'] || $new['hidden'] !== (int)$c['hidden']) {
            $now = ab_iso();
            $db->prepare('UPDATE comments SET body = ?, public = ?, hidden = ?, updated_at = ? WHERE id = ?')
                ->execute([$new['body'], $new['public'], $new['hidden'], $now, $cid]);
            $after = ab_one($db, 'SELECT * FROM comments WHERE id = ?', [$cid]);
            ab_log_action($db, $actor, null, 'comment_edit', (int)$c['entry_id'], ab_comment_snapshot($c), ab_comment_snapshot($after), $now);
            $c = $after;
        }
        return ['comment' => ab_comment_row_out($c), 'entry' => ab_admin_entry_out($db, (int)$c['entry_id'])];
    });
}

// ---- admin.undo ----------------------------------------------------------

function ab_h_admin_undo(array $auth): void
{
    $in = ab_body();
    $res = ab_svc_undo($in, $auth['actor']);
    if (isset($in['action_id']) && $res['refused']) {
        $why = (string)$res['refused'][0]['reason'];
        ab_send(409, ['ok' => false, 'error' => 'conflict', 'message' => $why, 'undone' => [], 'refused' => $res['refused']]);
    }
    ab_ok($res);
}

/** @return array{undone: int[], refused: array} */
function ab_svc_undo(array $in, string $actor): array
{
    ab_config();
    if (isset($in['action_id'])) {
        $aid = $in['action_id'];
        if (!is_int($aid) || $aid < 1) {
            throw ab_invalid('action_id', 'The action id must be a number.');
        }
        $res = ab_tx(static function (PDO $db) use ($aid, $actor): ?string {
            return ab_undo_action($db, $aid, $actor);
        });
        if ($res !== null) {
            return ['undone' => [], 'refused' => [['action_id' => $aid, 'reason' => $res]]];
        }
        return ['undone' => [$aid], 'refused' => []];
    }
    if (isset($in['run_id'])) {
        $rid = $in['run_id'];
        if (!is_int($rid) || $rid < 1) {
            throw ab_invalid('run_id', 'The run id must be a number.');
        }
        return ab_tx(static function (PDO $db) use ($rid, $actor): array {
            if (ab_one($db, 'SELECT id FROM runs WHERE id = ?', [$rid]) === null) {
                throw new AbError(404, 'not_found', 'That run does not exist.');
            }
            $undone = [];
            $refused = [];
            if (ab_actor_is_triage($actor) && (int)ab_scalar($db, "SELECT COUNT(*) FROM actions WHERE run_id = ? AND actor = 'owner'", [$rid]) > 0) {
                foreach (ab_all($db, 'SELECT id FROM actions WHERE run_id = ? ORDER BY id DESC', [$rid]) as $a) {
                    $refused[] = ['action_id' => (int)$a['id'], 'reason' => "This run contains the owner's actions; only the owner can undo it."];
                }
                return ['undone' => [], 'refused' => $refused];
            }
            foreach (ab_all($db, 'SELECT id FROM actions WHERE run_id = ? ORDER BY id DESC', [$rid]) as $a) {
                $aid = (int)$a['id'];
                $why = ab_undo_action($db, $aid, $actor);
                if ($why === null) {
                    $undone[] = $aid;
                } else {
                    $refused[] = ['action_id' => $aid, 'reason' => $why];
                }
            }
            return ['undone' => $undone, 'refused' => $refused];
        });
    }
    throw ab_invalid('action_id', 'Send action_id or run_id.');
}

// ---- Listings ------------------------------------------------------------

function ab_like(string $q): string
{
    return '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
}

/** Read an int from a query-like array with bounds. */
function ab_qint(array $q, string $name, int $default, int $min, int $max): int
{
    $v = $q[$name] ?? null;
    if (is_int($v)) {
        return max($min, min($max, $v));
    }
    if (!is_string($v) || !preg_match('/^-?\d+$/', $v)) {
        return $default;
    }
    return max($min, min($max, (int)$v));
}

function ab_qstr(array $q, string $name): string
{
    $v = $q[$name] ?? '';
    return is_string($v) ? $v : '';
}

function ab_h_admin_entries(array $auth): void
{
    ab_ok(ab_svc_entries($_GET));
}

/** Filtered entries list. $q uses the same keys as the query string. */
function ab_svc_entries(array $q): array
{
    ab_config();
    $db = ab_db();
    $where = [];
    $params = [];
    $state = ab_qstr($q, 'state');
    if ($state !== '') {
        if (!in_array($state, AB_STATES, true)) {
            throw ab_invalid('state', 'Unknown state.');
        }
        $where[] = 'state = ?';
        $params[] = $state;
    }
    $status = ab_qstr($q, 'status');
    if ($status !== '') {
        if (!in_array($status, AB_STATUSES, true)) {
            throw ab_invalid('status', 'Unknown status.');
        }
        $where[] = 'status = ?';
        $params[] = $status;
    }
    $type = ab_qstr($q, 'type');
    if ($type !== '') {
        if (!in_array($type, AB_TYPES, true)) {
            throw ab_invalid('type', 'Unknown type.');
        }
        $where[] = 'type = ?';
        $params[] = $type;
    }
    $source = ab_qstr($q, 'source');
    if ($source !== '') {
        if ($source !== 'visitor' && $source !== 'owner') {
            throw ab_invalid('source', 'Unknown source.');
        }
        $where[] = 'source = ?';
        $params[] = $source;
    }
    $tag = ab_qstr($q, 'tag');
    if ($tag !== '') {
        if (!preg_match('/^[a-z0-9][a-z0-9-]{1,23}$/', $tag)) {
            throw ab_invalid('tag', 'Unknown tag format.');
        }
        $where[] = 'tags LIKE ?';
        $params[] = '%"' . $tag . '"%';
    }
    $rep = ab_qstr($q, 'reported');
    if ($rep === '1' || $rep === 'true') {
        $where[] = AB_SQL_REPORTED;
    }
    $blk = ab_qstr($q, 'blocked');
    if ($blk === '1' || $blk === 'true') {
        $where[] = "source = 'visitor' AND EXISTS (SELECT 1 FROM blocks b WHERE b.lifted_at IS NULL AND b.expires_at > ? AND ((b.author_hash <> '' AND b.author_hash = entries.author_hash) OR (b.voter_hash <> '' AND b.voter_hash = entries.author_voter)))";
        $params[] = ab_iso();
    }
    $text = trim(ab_qstr($q, 'q'));
    if ($text !== '') {
        $like = ab_like($text);
        $where[] = "(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM comments c WHERE c.entry_id = entries.id AND c.body LIKE ? ESCAPE '\\'))";
        array_push($params, $like, $like, $like);
    }
    $sort = ab_qstr($q, 'sort');
    $orders = [
        '' => 'created_at DESC, id DESC', 'newest' => 'created_at DESC, id DESC', 'oldest' => 'created_at ASC, id ASC',
        'votes' => 'votes DESC, created_at DESC, id DESC',
    ];
    if (!isset($orders[$sort])) {
        throw ab_invalid('sort', 'sort must be newest, oldest or votes.');
    }
    $w = $where ? ' WHERE ' . implode(' AND ', $where) : '';
    $total = (int)ab_scalar($db, 'SELECT COUNT(*) FROM entries' . $w, $params);
    $limit = ab_qint($q, 'limit', 50, 1, 200);
    $offset = ab_qint($q, 'offset', 0, 0, 1000000);
    $rows = ab_all($db, 'SELECT * FROM entries' . $w . ' ORDER BY ' . $orders[$sort] . ' LIMIT ' . $limit . ' OFFSET ' . $offset, $params);
    $ctx = ab_alias_info($db);
    $out = [];
    foreach ($rows as $r) {
        $out[] = ab_admin_entry($r, $ctx);
    }
    return ['total' => $total, 'entries' => $out];
}

function ab_h_admin_entry(array $auth): void
{
    ab_ok(ab_svc_entry(ab_qint($_GET, 'id', 0, 0, PHP_INT_MAX), 20));
}

/** One entry plus its most recent log rows. */
function ab_svc_entry(int $id, int $nActions): array
{
    ab_config();
    $db = ab_db();
    $row = $id > 0 ? ab_entry_row($db, $id) : null;
    if ($row === null) {
        throw new AbError(404, 'not_found', 'That entry does not exist.');
    }
    return [
        'entry' => ab_admin_entry($row, ab_alias_info($db)),
        'actions' => ab_log_rows($db, ' WHERE a.entry_id = ?', [$id], $nActions, 0),
    ];
}

function ab_log_rows(PDO $db, string $w, array $params, int $limit, int $offset): array
{
    $rows = ab_all($db, 'SELECT a.*, e.title AS entry_title FROM actions a LEFT JOIN entries e ON e.id = a.entry_id' . $w
        . ' ORDER BY a.id DESC LIMIT ' . $limit . ' OFFSET ' . $offset, $params);
    $out = [];
    foreach ($rows as $a) {
        $out[] = [
            'id' => (int)$a['id'], 'at' => $a['at'], 'actor' => $a['actor'],
            'run_id' => $a['run_id'] === null ? null : (int)$a['run_id'],
            'kind' => $a['kind'], 'entry_id' => (int)$a['entry_id'], 'entry_title' => $a['entry_title'],
            'summary' => ab_action_summary($a),
            'undone_by' => $a['undone_by'] === null ? null : (int)$a['undone_by'],
            'undoable' => ab_undo_blocker($db, $a) === null,
        ];
    }
    return $out;
}

function ab_h_admin_log(array $auth): void
{
    ab_ok(ab_svc_log($_GET));
}

function ab_svc_log(array $q): array
{
    ab_config();
    $db = ab_db();
    $where = [];
    $params = [];
    foreach (['run_id', 'entry_id'] as $k) {
        $v = $q[$k] ?? '';
        if ((is_string($v) && preg_match('/^\d+$/', $v)) || is_int($v)) {
            $where[] = 'a.' . $k . ' = ?';
            $params[] = (int)$v;
        }
    }
    $w = $where ? ' WHERE ' . implode(' AND ', $where) : '';
    $total = (int)ab_scalar($db, 'SELECT COUNT(*) FROM actions a' . $w, $params);
    $limit = ab_qint($q, 'limit', 100, 1, 500);
    $offset = ab_qint($q, 'offset', 0, 0, 1000000);
    return ['total' => $total, 'actions' => ab_log_rows($db, $w, $params, $limit, $offset)];
}

function ab_run_out(array $r): array
{
    return [
        'id' => (int)$r['id'], 'at' => $r['at'], 'reviewer' => $r['reviewer'],
        'counts' => ab_json_field($r['counts']) ?? new stdClass(), 'digest' => $r['digest'],
    ];
}

function ab_h_admin_runs(array $auth): void
{
    ab_ok(ab_svc_runs(ab_qint($_GET, 'limit', 20, 1, 200)));
}

function ab_svc_runs(int $limit): array
{
    ab_config();
    $db = ab_db();
    $out = [];
    foreach (ab_all($db, 'SELECT * FROM runs ORDER BY id DESC LIMIT ' . $limit) as $r) {
        $out[] = ab_run_out($r);
    }
    return ['runs' => $out];
}

function ab_h_admin_stats(array $auth): void
{
    ab_ok(ab_svc_stats());
}

function ab_svc_stats(): array
{
    ab_config();
    $db = ab_db();
    $counts = array_fill_keys(AB_STATES, 0);
    foreach (ab_all($db, 'SELECT state, COUNT(*) AS n FROM entries GROUP BY state') as $r) {
        $counts[$r['state']] = (int)$r['n'];
    }
    $counts['reported'] = (int)ab_scalar($db, 'SELECT COUNT(*) FROM entries WHERE ' . AB_SQL_REPORTED);
    $last = ab_one($db, 'SELECT * FROM runs ORDER BY id DESC LIMIT 1');
    return [
        'counts' => $counts,
        'votes' => (int)ab_scalar($db, 'SELECT COUNT(*) FROM votes'),
        'blocks' => count(ab_active_blocks($db)),
        'entries_last_7_days' => (int)ab_scalar($db, 'SELECT COUNT(*) FROM entries WHERE source = ? AND created_at >= ?', ['visitor', ab_iso(ab_now() - 7 * 86400)]),
        'last_run' => $last === null ? null : ab_run_out($last),
    ];
}
