<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

// Reports, auto-hide and blocks (docs/SPEC.md section 6b).

// ---- Blocks ---------------------------------------------------------------

/** Active blocks (not lifted, not expired): [{id, author_hash, voter_hash}]. */
function ab_active_blocks(PDO $db): array
{
    return ab_all($db, 'SELECT id, author_hash, voter_hash FROM blocks WHERE lifted_at IS NULL AND expires_at > ? ORDER BY id', [ab_iso()]);
}

/** Does any block in $blocks match this author (hashes of an entry)? Empty hashes never match. */
function ab_blocks_match(array $blocks, string $authorHash, string $voterHash): array
{
    $ids = [];
    foreach ($blocks as $b) {
        if (($authorHash !== '' && $b['author_hash'] !== '' && hash_equals((string)$b['author_hash'], $authorHash))
            || ($voterHash !== '' && $b['voter_hash'] !== '' && hash_equals((string)$b['voter_hash'], $voterHash))) {
            $ids[] = (int)$b['id'];
        }
    }
    return $ids;
}

function ab_row_author_blocked(array $row, array $blocks): bool
{
    return $blocks !== [] && ab_blocks_match($blocks, (string)$row['author_hash'], (string)($row['author_voter'] ?? '')) !== [];
}

/** Is the requester (IP hash or voter hash) under an active block? */
function ab_caller_blocked(PDO $db, string $ipHash, string $voterHash): bool
{
    return ab_blocks_match(ab_active_blocks($db), $ipHash, $voterHash) !== [];
}

/** Insert a block row for an entry's author. Returns the new block id. */
function ab_insert_block(PDO $db, int $entryId, string $authorHash, string $voterHash, string $note, int $days, ?string $at = null): int
{
    $now = $at ?? ab_iso();
    $exp = ab_iso((int)strtotime($now) + max(1, $days) * 86400);
    $db->prepare('INSERT INTO blocks(entry_id, author_hash, voter_hash, note, created_at, expires_at, lifted_at) VALUES(?, ?, ?, ?, ?, ?, NULL)')
        ->execute([$entryId, $authorHash, $voterHash, $note, $now, $exp]);
    return (int)$db->lastInsertId();
}

/**
 * Block the author of a visitor entry and log it. Returns the new block id, or null when an active block
 * already covers both hashes (nothing is logged then).
 */
function ab_block_author(PDO $db, array $row, string $actor, ?int $runId, string $note = '', bool $strict = true): ?int
{
    if ($row['source'] !== 'visitor' || ((string)$row['author_hash'] === '' && (string)($row['author_voter'] ?? '') === '')) {
        if (!$strict) {
            return null;
        }
        throw new AbError(409, 'conflict', 'This entry has no visitor author to block.');
    }
    $ah = (string)$row['author_hash'];
    $vh = (string)($row['author_voter'] ?? '');
    foreach (ab_active_blocks($db) as $b) {
        if ($b['author_hash'] === $ah && $b['voter_hash'] === $vh) {
            return null;
        }
    }
    $days = (int)ab_config()['limits']['block_days'];
    $bid = ab_insert_block($db, (int)$row['id'], $ah, $vh, $note, $days);
    $snap = ab_snapshot($row);
    ab_log_action($db, $actor, $runId, 'block', (int)$row['id'], $snap, $snap + ['block_id' => $bid]);
    return $bid;
}

// ---- Reports --------------------------------------------------------------

function ab_open_report_ids(PDO $db, int $entryId): array
{
    return array_map('intval', array_column(ab_all($db, 'SELECT id FROM reports WHERE entry_id = ? AND cleared_at IS NULL ORDER BY id', [$entryId]), 'id'));
}

/** Insert a report unless the voter already reported the entry. Returns the new id or null. */
function ab_insert_report(PDO $db, int $entryId, string $reason, string $voterHash, string $ipHash, ?string $at = null): ?int
{
    $st = $db->prepare('INSERT OR IGNORE INTO reports(entry_id, reason, voter_hash, ip_hash, created_at) VALUES(?, ?, ?, ?, ?)');
    $st->execute([$entryId, $reason, $voterHash, $ipHash, $at ?? ab_iso()]);
    return $st->rowCount() > 0 ? (int)$db->lastInsertId() : null;
}

function ab_h_report(): void
{
    $cfg = ab_config();
    $in = ab_body();
    ab_check_pass($in['pass'] ?? null);
    $voter = ab_voter_from($in);
    $id = $in['id'] ?? null;
    if (!is_int($id) || $id < 1) {
        throw ab_invalid('id', 'The entry id is missing.');
    }
    $reason = $in['reason'] ?? null;
    if (!is_string($reason) || !in_array($reason, AB_REPORT_REASONS, true)) {
        throw ab_invalid('reason', 'The reason must be spam, abusive, off_topic or other.');
    }
    $voterHash = ab_hash('voter', $voter);
    $ipHash = ab_ip_hash();
    $hideAt = (int)$cfg['report_hide_at'];
    $max = (int)$cfg['limits']['reports_per_hour'];

    ab_tx(static function (PDO $db) use ($id, $reason, $voterHash, $ipHash, $hideAt, $max): void {
        $row = ab_entry_row($db, $id);
        if ($row === null || $row['state'] !== 'published' || $row['source'] !== 'visitor') {
            throw new AbError(404, 'not_found', 'That entry does not exist.');
        }
        if (ab_caller_blocked($db, $ipHash, $voterHash)) {
            return; // ignored silently
        }
        ab_rl_check($db, 'reports|' . $ipHash, $max);
        if (ab_insert_report($db, $id, $reason, $voterHash, $ipHash) === null) {
            return; // this voter already reported it
        }
        ab_rl_hit($db, 'reports|' . $ipHash);
        if ($hideAt > 0) {
            $n = (int)ab_scalar($db, 'SELECT COUNT(DISTINCT ip_hash) FROM reports WHERE entry_id = ? AND cleared_at IS NULL', [$id]);
            if ($n >= $hideAt) {
                ab_change($db, $row, ['state' => 'pending'], 'report_hide', 'system', null, ['reporters' => $n]);
            }
        }
    });
    ab_ok(['id' => $id]);
}

// ---- Admin services ---------------------------------------------------------

function ab_report_id_param(array $in): int
{
    $id = $in['id'] ?? null;
    if (!is_int($id) || $id < 1) {
        throw ab_invalid('id', 'The entry id is missing.');
    }
    return $id;
}

/** Clear the open reports of an entry and log dismiss_reports. Returns the number cleared. */
function ab_dismiss_reports(PDO $db, array $row, string $actor, ?int $runId, ?array $ai = null): int
{
    $ids = ab_open_report_ids($db, (int)$row['id']);
    if (!$ids) {
        return 0;
    }
    $snap = ab_snapshot($row);
    $aid = ab_log_action($db, $actor, $runId, 'dismiss_reports', (int)$row['id'], $snap, array_merge($snap, ['cleared_report_ids' => $ids], $ai !== null ? ['ai' => $ai] : []));
    ab_clear_reports($db, $ids, $aid);
    return count($ids);
}

function ab_clear_reports(PDO $db, array $ids, int $actionId): void
{
    $st = $db->prepare('UPDATE reports SET cleared_at = ?, cleared_by = ? WHERE id = ? AND cleared_at IS NULL');
    $now = ab_iso();
    foreach ($ids as $rid) {
        $st->execute([$now, $actionId, (int)$rid]);
    }
}

function ab_svc_dismiss_reports(array $in, string $actor): array
{
    ab_config();
    $id = ab_report_id_param($in);
    return ['entry' => ab_tx(static function (PDO $db) use ($id, $actor): array {
        $row = ab_entry_row($db, $id);
        if ($row === null) {
            throw new AbError(404, 'not_found', 'That entry does not exist.');
        }
        ab_dismiss_reports($db, $row, $actor, null);
        return ab_admin_entry_out($db, $id);
    })];
}

function ab_svc_block(array $in, string $actor): array
{
    ab_config();
    $id = ab_report_id_param($in);
    $note = '';
    if (array_key_exists('note', $in) && $in['note'] !== null) {
        if (!is_string($in['note'])) {
            throw ab_invalid('note', 'The note must be text.');
        }
        ab_require_utf8($in['note'], 'note');
        $note = ab_truncate(trim(ab_strip_invisible($in['note'], true)), 500);
    }
    return ['entry' => ab_tx(static function (PDO $db) use ($id, $actor, $note): array {
        $row = ab_entry_row($db, $id);
        if ($row === null) {
            throw new AbError(404, 'not_found', 'That entry does not exist.');
        }
        ab_block_author($db, $row, $actor, null, $note);
        return ab_admin_entry_out($db, $id);
    })];
}

function ab_svc_unblock(array $in, string $actor): array
{
    ab_config();
    $id = ab_report_id_param($in);
    return ['entry' => ab_tx(static function (PDO $db) use ($id, $actor): array {
        $row = ab_entry_row($db, $id);
        if ($row === null) {
            throw new AbError(404, 'not_found', 'That entry does not exist.');
        }
        $ids = ab_blocks_match(ab_active_blocks($db), (string)$row['author_hash'], (string)($row['author_voter'] ?? ''));
        if ($ids) {
            $now = ab_iso();
            $st = $db->prepare('UPDATE blocks SET lifted_at = ? WHERE id = ?');
            foreach ($ids as $bid) {
                $st->execute([$now, $bid]);
            }
            $snap = ab_snapshot($row);
            ab_log_action($db, $actor, null, 'unblock', $id, $snap, $snap + ['block_ids' => $ids], $now);
        }
        return ab_admin_entry_out($db, $id);
    })];
}

function ab_h_admin_dismiss_reports(array $auth): void
{
    ab_ok(ab_svc_dismiss_reports(ab_body(), $auth['actor']));
}

function ab_h_admin_block(array $auth): void
{
    ab_ok(ab_svc_block(ab_body(), $auth['actor']));
}

function ab_h_admin_unblock(array $auth): void
{
    ab_ok(ab_svc_unblock(ab_body(), $auth['actor']));
}
