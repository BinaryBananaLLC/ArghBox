<?php
declare(strict_types=1);

/**
 * Seed a dev or test ArghBox database from a JSON file. CLI only.
 *
 *   ARGHBOX_CONFIG=/path/config.php php tools/seed.php <file.json> [--if-empty]
 *
 * Entry fields: type, title, body, state, status, status_at, source, tags, votes (number of
 * fake voters), comments [{body, public}], merged_into (index in the file), reject_reason,
 * author (any string, hashed like an IP), created_at, days_ago, status_days_ago, context.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

define('ARGHBOX_BOOT', true);
$lib = dirname(__DIR__) . '/arghbox/lib/';
foreach (['version', 'http', 'config', 'security', 'db', 'entries', 'actions'] as $part) {
    require $lib . $part . '.php';
}

$args = array_slice($argv, 1);
$ifEmpty = in_array('--if-empty', $args, true);
$files = array_values(array_filter($args, static fn($a) => strpos($a, '--') !== 0));
if (count($files) !== 1 || !is_file($files[0])) {
    fwrite(STDERR, "Usage: php tools/seed.php <file.json> [--if-empty]\n");
    exit(2);
}
$items = json_decode((string)file_get_contents($files[0]), true);
if (!is_array($items)) {
    fwrite(STDERR, "The seed file is not a JSON array.\n");
    exit(2);
}
if (isset($items['entries']) && is_array($items['entries'])) {
    $items = $items['entries'];
}

try {
    $db = ab_db();
    if ($ifEmpty && (int)ab_scalar($db, 'SELECT COUNT(*) FROM entries') > 0) {
        echo json_encode(['ok' => true, 'seeded' => 0, 'skipped' => 'database is not empty']) . "\n";
        exit(0);
    }
    $now = time();
    $ids = [];
    ab_tx(static function (PDO $db) use ($items, $now, &$ids): void {
        foreach ($items as $i => $it) {
            $created = isset($it['created_at']) ? (string)$it['created_at']
                : ab_iso($now - (int)round(((float)($it['days_ago'] ?? 1)) * 86400));
            $status = (string)($it['status'] ?? 'open');
            $statusAt = null;
            if (isset($it['status_at'])) {
                $statusAt = (string)$it['status_at'];
            } elseif (isset($it['status_days_ago'])) {
                $statusAt = ab_iso($now - (int)round(((float)$it['status_days_ago']) * 86400));
            }
            $source = (string)($it['source'] ?? 'visitor');
            $state = (string)($it['state'] ?? 'published');
            $author = isset($it['author']) ? (string)$it['author'] : 'seed-author-' . $i;
            $id = ab_insert_entry($db, [
                'type' => (string)($it['type'] ?? 'idea'),
                'title' => (string)$it['title'],
                'body' => (string)($it['body'] ?? ''),
                'source' => $source,
                'state' => $state === 'merged' ? 'published' : $state,
                'status' => $status,
                'status_at' => $statusAt,
                'tags' => ab_clean_tags($it['tags'] ?? []),
                'reject_reason' => $state === 'rejected' ? (string)($it['reject_reason'] ?? 'other') : null,
                'context' => is_array($it['context'] ?? null) ? $it['context'] : [],
                'author_hash' => $source === 'owner' ? '' : ab_hash('ip', $author),
                'receipt_hash' => '',
                'created_at' => $created,
            ]);
            $ids[$i] = $id;
            $n = (int)($it['votes'] ?? ($source === 'owner' ? 0 : 1));
            for ($k = 1; $k <= $n; $k++) {
                $voter = 'seed-' . ($i * 1000 + $k);
                $ip = $k === 1 ? ab_hash('ip', $author) : ab_hash('ip', 'seed-ip-' . ($i * 1000 + $k));
                ab_insert_vote($db, $id, ab_hash('voter', $voter), $ip, null, $created);
            }
            ab_recount($db, $id);
            foreach ((array)($it['comments'] ?? []) as $c) {
                ab_insert_comment($db, $id, (string)$c['body'], (bool)($c['public'] ?? true), $statusAt ?? $created);
            }
        }
        // Second pass: merges (copy votes like a real merge).
        foreach ($items as $i => $it) {
            if (($it['state'] ?? '') !== 'merged') {
                continue;
            }
            $t = $it['merged_into'] ?? null;
            if (!is_int($t) || !isset($ids[$t])) {
                throw new RuntimeException('entry ' . $i . ' is merged but merged_into is not an index in the file');
            }
            $row = ab_entry_row($db, $ids[$i]);
            ab_merge($db, $row, $ids[$t], 'system', null);
        }
    });
    echo json_encode(['ok' => true, 'seeded' => count($ids)]) . "\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Seeding failed: ' . $e->getMessage() . "\n");
    exit(1);
}
