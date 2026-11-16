<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

/**
 * Cast or remove a vote. Returns ['id' => final target id, 'votes' => int, 'voted' => bool].
 */
function ab_cast_vote(string $voter, int $id, bool $on): array
{
    $cfg = ab_config();
    $voterHash = ab_hash('voter', $voter);
    $ipHash = ab_ip_hash();
    $limits = $cfg['limits'];

    return ab_tx(static function (PDO $db) use ($voterHash, $ipHash, $id, $on, $limits): array {
        $target = ab_resolve_target($db, $id);
        $row = $target === null ? null : ab_entry_row($db, $target);
        if ($row === null || $row['state'] !== 'published') {
            throw new AbError(404, 'not_found', 'That entry does not exist.');
        }
        $tid = (int)$row['id'];
        $existing = ab_one($db, 'SELECT id, moved_from FROM votes WHERE entry_id = ? AND voter_hash = ?', [$tid, $voterHash]);

        if ($on) {
            if ($existing === null) {
                ab_rl_check($db, 'votes|' . $ipHash, (int)$limits['votes_per_hour']);
                $perEntry = (int)ab_scalar($db, 'SELECT COUNT(*) FROM votes WHERE entry_id = ? AND ip_hash = ?', [$tid, $ipHash]);
                if ($perEntry >= (int)$limits['votes_per_ip_per_entry']) {
                    throw new AbError(429, 'rate_limited', 'Too many votes from your network on this entry.', null, 3600);
                }
                ab_insert_vote($db, $tid, $voterHash, $ipHash);
                ab_rl_hit($db, 'votes|' . $ipHash);
            }
        } elseif ($existing !== null && $existing['moved_from'] === null) {
            $db->prepare('DELETE FROM votes WHERE id = ?')->execute([(int)$existing['id']]);
        }
        $n = ab_recount($db, $tid);
        $voted = ab_one($db, 'SELECT 1 FROM votes WHERE entry_id = ? AND voter_hash = ?', [$tid, $voterHash]) !== null;
        return ['id' => $tid, 'votes' => $n, 'voted' => $voted];
    });
}
