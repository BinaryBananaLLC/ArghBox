<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

/** Throws rate_limited when the counter for $key has reached $max in the current window. */
function ab_rl_check(PDO $db, string $key, int $max, int $window = 3600): void
{
    $row = ab_one($db, 'SELECT window_start, count FROM limits WHERE key = ?', [$key]);
    if ($row === null) {
        return;
    }
    $now = ab_now();
    $start = (int)$row['window_start'];
    if ($now - $start >= $window) {
        return;
    }
    if ((int)$row['count'] >= $max) {
        $wait = max(1, $start + $window - $now);
        throw new AbError(429, 'rate_limited', 'Too many requests. Try again later.', null, $wait);
    }
}

/** Count one event for $key. Expired rows are pruned on about one hit in fifty. */
function ab_rl_hit(PDO $db, string $key, int $window = 3600): void
{
    $now = ab_now();
    $row = ab_one($db, 'SELECT window_start, count FROM limits WHERE key = ?', [$key]);
    if ($row === null || $now - (int)$row['window_start'] >= $window) {
        $st = $db->prepare('INSERT INTO limits(key, window_start, count) VALUES(?, ?, 1)
            ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1');
        $st->execute([$key, $now]);
    } else {
        $db->prepare('UPDATE limits SET count = count + 1 WHERE key = ?')->execute([$key]);
    }
    if (random_int(1, 50) === 1) {
        $db->prepare('DELETE FROM limits WHERE window_start < ?')->execute([$now - 86400]);
    }
}

/**
 * Check several counters, then count all of them, in one transaction. Nothing is written when any
 * limit is reached. $specs is a list of [key, max] (hourly windows).
 */
function ab_rl_take_all(array $specs): void
{
    ab_tx(static function (PDO $db) use ($specs): void {
        foreach ($specs as [$key, $max]) {
            ab_rl_check($db, (string)$key, (int)$max);
        }
        foreach ($specs as [$key]) {
            ab_rl_hit($db, (string)$key);
        }
    });
}

/** Check and count in one go (used where every attempt counts). */
function ab_rl_take(string $name, int $max): void
{
    ab_rl_take_all([[$name . '|' . ab_ip_hash(), $max]]);
}
