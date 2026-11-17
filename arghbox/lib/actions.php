<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

function ab_jenc($v): string
{
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function ab_log_action(PDO $db, string $actor, ?int $runId, string $kind, int $entryId, $before, $after, ?string $at = null): int
{
    $db->prepare('INSERT INTO actions(at, actor, run_id, kind, entry_id, before, after) VALUES(?, ?, ?, ?, ?, ?, ?)')
        ->execute([$at ?? ab_iso(), $actor, $runId, $kind, $entryId, ab_jenc($before), ab_jenc($after)]);
    return (int)$db->lastInsertId();
}

/**
 * Change an entry and log one action row with before/after snapshots.
 * `status_at` is set automatically when the status changes. Returns [new row, action id].
 */
function ab_change(PDO $db, array $row, array $changes, string $kind, string $actor, ?int $runId, array $afterExtra = []): array
{
    $before = ab_snapshot($row);
    $now = ab_iso();
    // Publishing an entry that was reviewed clears its open reports (SPEC 6b); undoing the action re-opens them.
    $clear = [];
    if (($changes['state'] ?? null) === 'published' && $row['state'] !== 'published') {
        $clear = ab_open_report_ids($db, (int)$row['id']);
        if ($clear) {
            $afterExtra['cleared_report_ids'] = $clear;
        }
    }
    if (isset($changes['status']) && $changes['status'] !== $row['status'] && !array_key_exists('status_at', $changes)) {
        $changes['status_at'] = $now;
    }
    $sets = [];
    $params = [];
    foreach ($changes as $k => $v) {
        if (!in_array($k, AB_MUTABLE, true)) {
            throw new LogicException('not a mutable field');
        }
        $sets[] = $k . ' = ?';
        $params[] = $v;
    }
    $sets[] = 'updated_at = ?';
    $params[] = $now;
    $params[] = (int)$row['id'];
    $db->prepare('UPDATE entries SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
    $new = ab_entry_row($db, (int)$row['id']);
    $id = ab_log_action($db, $actor, $runId, $kind, (int)$row['id'], $before, ab_snapshot($new) + $afterExtra, $now);
    if ($clear) {
        ab_clear_reports($db, $clear, $id);
    }
    return [$new, $id];
}

/** Validate a merge. Returns [final target id, null] or [null, reason]. */
function ab_merge_check(PDO $db, int $entryId, $targetId): array
{
    if (!is_int($targetId) || $targetId < 1) {
        return [null, 'merge target is missing'];
    }
    if ($targetId === $entryId) {
        return [null, 'an entry cannot be merged into itself'];
    }
    $final = ab_resolve_target($db, $targetId);
    if ($final === null) {
        return [null, 'merge target does not exist'];
    }
    if ($final === $entryId) {
        return [null, 'this merge would create a cycle'];
    }
    $t = ab_entry_row($db, $final);
    if ($t === null || $t['state'] !== 'published') {
        return [null, 'merge target is not published'];
    }
    return [$final, null];
}

/** Merge entry A into final target B (already validated). Returns [new row, action id]. */
function ab_merge(PDO $db, array $row, int $target, string $actor, ?int $runId, array $extra = []): array
{
    $entryId = (int)$row['id'];
    $moved = [];
    foreach (ab_all($db, 'SELECT voter_hash, ip_hash FROM votes WHERE entry_id = ? ORDER BY id', [$entryId]) as $v) {
        $vid = ab_insert_vote($db, $target, (string)$v['voter_hash'], (string)$v['ip_hash'], $entryId);
        if ($vid !== null) {
            $moved[] = $vid;
        }
    }
    ab_recount($db, $target);
    return ab_change($db, $row, ['state' => 'merged', 'merged_into' => $target, 'reject_reason' => null] + $extra, 'merge', $actor, $runId, ['moved_vote_ids' => $moved]);
}

// ---- Comments -----------------------------------------------------------

function ab_comment_snapshot(array $c): array
{
    return ['comment_id' => (int)$c['id'], 'body' => $c['body'], 'public' => (int)$c['public'], 'hidden' => (int)$c['hidden']];
}

function ab_is_comment_kind(string $kind): bool
{
    return $kind === 'comment' || $kind === 'comment_edit';
}

/** Actions on reports and blocks: they neither block nor are blocked by entry-field undo. */
function ab_is_side_kind(string $kind): bool
{
    return $kind === 'dismiss_reports' || $kind === 'block' || $kind === 'unblock';
}

// ---- Undo ---------------------------------------------------------------

/** Is the action undoable right now? Returns null when yes, else the reason. */
function ab_undo_blocker(PDO $db, array $a): ?string
{
    if ($a['kind'] === 'undo') {
        return 'An undo cannot be undone.';
    }
    if ($a['kind'] === 'create') {
        return 'A created item cannot be undone. Make it private or reject it instead.';
    }
    if ($a['undone_by'] !== null) {
        return 'Already undone.';
    }
    if ($a['kind'] === 'block' || $a['kind'] === 'unblock') {
        // Among block and unblock actions of one entry, undo in reverse order (SPEC 6b).
        $later = ab_scalar($db, "SELECT COUNT(*) FROM actions WHERE entry_id = ? AND id > ? AND undone_by IS NULL AND kind IN ('block', 'unblock')",
            [(int)$a['entry_id'], (int)$a['id']]);
        return (int)$later > 0 ? 'A later block or unblock of this author must be undone first.' : null;
    }
    if (ab_is_side_kind((string)$a['kind'])) {
        return null; // reports do not take part in entry-field undo ordering
    }
    if (ab_is_comment_kind((string)$a['kind'])) {
        $after = json_decode((string)$a['after'], true);
        $cid = is_array($after) ? (int)($after['comment_id'] ?? 0) : 0;
        $later = ab_all($db, "SELECT after FROM actions WHERE entry_id = ? AND id > ? AND undone_by IS NULL AND kind IN ('comment', 'comment_edit')",
            [(int)$a['entry_id'], (int)$a['id']]);
        foreach ($later as $l) {
            $la = json_decode((string)$l['after'], true);
            if (is_array($la) && (int)($la['comment_id'] ?? 0) === $cid) {
                return 'A later change to this comment must be undone first.';
            }
        }
        return null;
    }
    $later = ab_scalar($db, "SELECT COUNT(*) FROM actions WHERE entry_id = ? AND id > ? AND undone_by IS NULL
        AND kind NOT IN ('undo', 'comment', 'comment_edit', 'dismiss_reports', 'block', 'unblock')", [(int)$a['entry_id'], (int)$a['id']]);
    if ((int)$later > 0) {
        return 'A later action on this entry must be undone first.';
    }
    if ($a['kind'] === 'merge') {
        // Undoing A->B deletes the votes it copied into B. If B was merged into C since, those votes were
        // copied on again, so undoing now would leave them counted twice.
        $after = json_decode((string)$a['after'], true);
        $target = is_array($after) && isset($after['merged_into']) ? (int)$after['merged_into'] : 0;
        if ($target > 0 && ab_scalar($db, "SELECT state FROM entries WHERE id = ?", [$target]) === 'merged') {
            return 'The entry it was merged into has itself been merged into another entry since. Undo that merge first.';
        }
    }
    return null;
}

/** Re-open reports that action $actionId cleared. */
function ab_reopen_reports(PDO $db, $ids, int $actionId): void
{
    $st = $db->prepare('UPDATE reports SET cleared_at = NULL, cleared_by = NULL WHERE id = ? AND cleared_by = ?');
    foreach (is_array($ids) ? $ids : [] as $rid) {
        $st->execute([(int)$rid, $actionId]);
    }
}

/** Undo one action. Returns null on success, else the refusal reason. */
function ab_undo_action(PDO $db, int $actionId, string $actor): ?string
{
    $a = ab_one($db, 'SELECT * FROM actions WHERE id = ?', [$actionId]);
    if ($a === null) {
        return 'No such action.';
    }
    $why = ab_undo_blocker($db, $a);
    if ($why !== null) {
        return $why;
    }
    if (ab_actor_is_triage($actor) && $a['actor'] === 'owner') {
        return "Only the owner can undo the owner's actions.";
    }
    $before = json_decode((string)$a['before'], true);
    $after = json_decode((string)$a['after'], true);
    if (!is_array($before) || !is_array($after)) {
        return 'The action record is damaged.';
    }
    $now = ab_iso();

    if (ab_is_comment_kind((string)$a['kind'])) {
        $cid = (int)($after['comment_id'] ?? 0);
        $c = ab_one($db, 'SELECT * FROM comments WHERE id = ?', [$cid]);
        if ($c === null) {
            return 'The comment no longer exists.';
        }
        $current = ab_comment_snapshot($c);
        if ($a['kind'] === 'comment') {
            $db->prepare('UPDATE comments SET hidden = 1, updated_at = ? WHERE id = ?')->execute([$now, $cid]);
        } else {
            $db->prepare('UPDATE comments SET body = ?, public = ?, hidden = ?, updated_at = ? WHERE id = ?')
                ->execute([(string)$before['body'], (int)$before['public'], (int)$before['hidden'], $now, $cid]);
        }
        $new = ab_comment_snapshot(ab_one($db, 'SELECT * FROM comments WHERE id = ?', [$cid]));
        $undoId = ab_log_action($db, $actor, null, 'undo', (int)$a['entry_id'], $current, $new + ['undoes' => (int)$a['id']], $now);
        $db->prepare('UPDATE actions SET undone_by = ? WHERE id = ?')->execute([$undoId, (int)$a['id']]);
        return null;
    }

    $row = ab_entry_row($db, (int)$a['entry_id']);
    if ($row === null) {
        return 'The entry no longer exists.';
    }
    $current = ab_snapshot($row);
    if (ab_is_side_kind((string)$a['kind'])) {
        if ($a['kind'] === 'dismiss_reports') {
            ab_reopen_reports($db, $after['cleared_report_ids'] ?? [], (int)$a['id']);
        } elseif ($a['kind'] === 'block') {
            $db->prepare('UPDATE blocks SET lifted_at = ? WHERE id = ? AND lifted_at IS NULL')->execute([$now, (int)($after['block_id'] ?? 0)]);
        } else {
            $st = $db->prepare('UPDATE blocks SET lifted_at = NULL WHERE id = ?');
            foreach ((array)($after['block_ids'] ?? []) as $bid) {
                $st->execute([(int)$bid]);
            }
        }
        $undoId = ab_log_action($db, $actor, null, 'undo', (int)$row['id'], $current, $current + ['undoes' => (int)$a['id']], $now);
        $db->prepare('UPDATE actions SET undone_by = ? WHERE id = ?')->execute([$undoId, (int)$a['id']]);
        return null;
    }
    $moved = isset($after['moved_vote_ids']) && is_array($after['moved_vote_ids']) ? $after['moved_vote_ids'] : [];
    $targetId = isset($after['merged_into']) && $after['merged_into'] !== null ? (int)$after['merged_into'] : null;

    $sets = [];
    $params = [];
    foreach (AB_MUTABLE as $k) {
        $sets[] = $k . ' = ?';
        $params[] = $before[$k] ?? null;
    }
    $sets[] = 'updated_at = ?';
    $params[] = $now;
    $params[] = (int)$row['id'];
    $db->prepare('UPDATE entries SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);

    if ($moved) {
        $del = $db->prepare('DELETE FROM votes WHERE id = ?');
        foreach ($moved as $vid) {
            $del->execute([(int)$vid]);
        }
        if ($targetId !== null) {
            ab_recount($db, $targetId);
        }
    }
    ab_recount($db, (int)$row['id']);
    if (!empty($after['cleared_report_ids']) && is_array($after['cleared_report_ids'])) {
        ab_reopen_reports($db, $after['cleared_report_ids'], (int)$a['id']);
    }

    $new = ab_entry_row($db, (int)$row['id']);
    $undoId = ab_log_action($db, $actor, null, 'undo', (int)$row['id'], $current, ab_snapshot($new) + ['undoes' => (int)$a['id']], $now);
    $db->prepare('UPDATE actions SET undone_by = ? WHERE id = ?')->execute([$undoId, (int)$a['id']]);
    return null;
}

function ab_action_summary(array $a): string
{
    $before = json_decode((string)$a['before'], true);
    $after = json_decode((string)$a['after'], true);
    $before = is_array($before) ? $before : [];
    $after = is_array($after) ? $after : [];
    $id = (int)$a['entry_id'];
    switch ($a['kind']) {
        case 'create':
            return "Created owner item #$id.";
        case 'publish':
            $n = isset($after['cleared_report_ids']) && is_array($after['cleared_report_ids']) ? count($after['cleared_report_ids']) : 0;
            return "Published #$id." . ($n > 0 ? " Cleared $n " . ($n === 1 ? 'report' : 'reports') . '.' : '');
        case 'report_hide':
            $n = (int)($after['reporters'] ?? 0);
            return $n > 0 ? "Hidden after $n " . ($n === 1 ? 'report' : 'reports') . '.' : 'Hidden after reports.';
        case 'dismiss_reports':
            $n = isset($after['cleared_report_ids']) && is_array($after['cleared_report_ids']) ? count($after['cleared_report_ids']) : 0;
            $why = is_array($after['ai'] ?? null) ? trim((string)($after['ai']['reason'] ?? '')) : '';
            return "Dismissed $n " . ($n === 1 ? 'report' : 'reports') . ($why !== '' ? ': ' . $why : '.');
        case 'block':
            return 'Blocked the author.';
        case 'unblock':
            return 'Unblocked the author.';
        case 'reject':
            $r = (string)($after['reject_reason'] ?? 'other');
            return "Rejected #$id ($r)" . ($a['actor'] === 'system' && $r === 'abuse' ? ': the author is blocked.' : '.');
        case 'flag':
            return "Flagged #$id for the owner.";
        case 'pending':
            return "Moved #$id back to pending.";
        case 'private':
            return "Made #$id private.";
        case 'tag':
            $t = isset($after['tags']) ? ab_tags_of($after['tags']) : [];
            return $t ? "Tagged #$id: " . implode(', ', $t) . '.' : "Removed all tags from #$id.";
        case 'merge':
            $n = isset($after['moved_vote_ids']) && is_array($after['moved_vote_ids']) ? count($after['moved_vote_ids']) : 0;
            return "Merged #$id into #" . (string)($after['merged_into'] ?? '?') . " ($n " . ($n === 1 ? 'vote' : 'votes') . ' moved).';
        case 'set_status':
            return "Set #$id status from " . (string)($before['status'] ?? '?') . ' to ' . (string)($after['status'] ?? '?') . '.';
        case 'comment':
            return ((int)($after['public'] ?? 1) === 1 ? 'Commented publicly on' : 'Added a private note to') . " #$id.";
        case 'comment_edit':
            return "Edited a comment on #$id.";
        case 'edit':
            $what = [];
            foreach (['type', 'title', 'body', 'external_url'] as $k) {
                if (($before[$k] ?? null) !== ($after[$k] ?? null)) {
                    $what[] = $k;
                }
            }
            return 'Edited the ' . ($what ? implode(' and ', $what) : 'text') . " of #$id.";
        case 'undo':
            return 'Undid action #' . (string)($after['undoes'] ?? '?') . " on #$id.";
    }
    return "Changed #$id.";
}
