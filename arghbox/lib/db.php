<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

const AB_SCHEMA_VERSION = 3;
const AB_JOURNAL_DEFAULT = 'delete';

function ab_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    if (!extension_loaded('pdo_sqlite')) {
        throw new RuntimeException('pdo_sqlite is not available');
    }
    $state = ab_data_dir_state();
    if ($state === null) {
        throw new RuntimeException('no usable data directory');
    }
    $file = ab_db_file($state['path']);
    $isNew = !is_file($file);
    $pdo = new PDO('sqlite:' . $file, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    // How long a connection waits for another PHP worker's write lock (ARGHBOX_BUSY_TIMEOUT_MS is for tests).
    $pdo->exec('PRAGMA busy_timeout=' . max(50, (int)(getenv('ARGHBOX_BUSY_TIMEOUT_MS') ?: 5000)));
    ab_set_journal_mode($pdo);
    $pdo->exec('PRAGMA foreign_keys=ON');
    ab_migrate($pdo);
    if ($isNew) {
        @chmod($file, 0600);
    }
    return $pdo;
}

/** True for SQLITE_BUSY / SQLITE_LOCKED ("database is locked"): another PHP worker holds the write lock. */
function ab_is_busy(Throwable $e): bool
{
    if (!($e instanceof PDOException)) {
        return false;
    }
    $code = $e->errorInfo[1] ?? null;
    if ($code === 5 || $code === 6) {
        return true;
    }
    $m = $e->getMessage();
    return stripos($m, 'database is locked') !== false || stripos($m, 'database table is locked') !== false;
}

function ab_busy_error(): AbError
{
    return new AbError(503, 'busy', 'The server is busy right now. Please try again in a moment.', null, 2);
}

/** Run $fn; a busy database is retried once after a short random pause, then answered as 503 busy. */
function ab_with_busy_retry(callable $fn)
{
    try {
        return $fn();
    } catch (Throwable $e) {
        if (!ab_is_busy($e)) {
            throw $e;
        }
    }
    usleep(random_int(30000, 150000));
    try {
        return $fn();
    } catch (Throwable $e) {
        throw ab_is_busy($e) ? ab_busy_error() : $e;
    }
}

/**
 * Journal mode. WAL lets readers and the writer work at the same time; DELETE is the classic rollback journal.
 * ARGHBOX_JOURNAL_MODE=wal|delete overrides the default; WAL falls back to DELETE when it cannot be enabled
 * (some network filesystems).
 */
function ab_set_journal_mode(PDO $pdo): void
{
    $want = strtolower((string)(getenv('ARGHBOX_JOURNAL_MODE') ?: (ab_config_load()['journal_mode'] ?? AB_JOURNAL_DEFAULT)));
    try {
        if ($want === 'wal') {
            $got = strtolower((string)$pdo->query('PRAGMA journal_mode=WAL')->fetchColumn());
            if ($got === 'wal') {
                return;
            }
        }
        $pdo->query('PRAGMA journal_mode=DELETE')->fetchColumn();
    } catch (PDOException $e) {
        if (!ab_is_busy($e)) {
            throw $e;
        }
        // Someone else holds the lock; the file keeps the mode it already has.
    }
}

/** The database file: an existing arghbox.sqlite keeps being used, new installs get an unguessable name. */
function ab_db_file(string $dir): string
{
    $old = $dir . '/arghbox.sqlite';
    if (is_file($old)) {
        return $old;
    }
    return $dir . '/arghbox-' . substr(hash_hmac('sha256', 'db', ab_config()['secret']), 0, 8) . '.sqlite';
}

function ab_schema_version(PDO $db): int
{
    try {
        $v = $db->query("SELECT value FROM meta WHERE key='schema_version'")->fetchColumn();
        return $v === false ? 0 : (int)$v;
    } catch (PDOException $e) {
        return 0;
    }
}

function ab_migrate(PDO $db): void
{
    if (ab_schema_version($db) >= AB_SCHEMA_VERSION) {
        return;
    }
    $db->exec('BEGIN IMMEDIATE');
    try {
        if (ab_schema_version($db) < 1) {
            $db->exec("CREATE TABLE IF NOT EXISTS entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              type TEXT NOT NULL,
              title TEXT NOT NULL,
              body TEXT NOT NULL DEFAULT '',
              title_original TEXT NOT NULL,
              body_original TEXT NOT NULL DEFAULT '',
              source TEXT NOT NULL DEFAULT 'visitor',
              state TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'open',
              status_at TEXT NULL,
              merged_into INTEGER NULL REFERENCES entries(id),
              reject_reason TEXT NULL,
              tags TEXT NOT NULL DEFAULT '[]',
              votes INTEGER NOT NULL DEFAULT 0,
              context TEXT NOT NULL DEFAULT '{}',
              ai TEXT NULL,
              author_hash TEXT NOT NULL,
              receipt_hash TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )");
            $db->exec("CREATE TABLE IF NOT EXISTS comments (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              entry_id INTEGER NOT NULL REFERENCES entries(id),
              body TEXT NOT NULL,
              public INTEGER NOT NULL DEFAULT 1,
              hidden INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )");
            $db->exec('CREATE INDEX IF NOT EXISTS idx_comments_entry ON comments(entry_id)');
            $db->exec("CREATE TABLE IF NOT EXISTS votes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              entry_id INTEGER NOT NULL REFERENCES entries(id),
              voter_hash TEXT NOT NULL,
              ip_hash TEXT NOT NULL,
              moved_from INTEGER NULL,
              created_at TEXT NOT NULL,
              UNIQUE(entry_id, voter_hash)
            )");
            $db->exec("CREATE TABLE IF NOT EXISTS runs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              at TEXT NOT NULL,
              reviewer TEXT NOT NULL,
              counts TEXT NOT NULL,
              digest TEXT NOT NULL DEFAULT ''
            )");
            $db->exec("CREATE TABLE IF NOT EXISTS actions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              at TEXT NOT NULL,
              actor TEXT NOT NULL,
              run_id INTEGER NULL REFERENCES runs(id),
              kind TEXT NOT NULL,
              entry_id INTEGER NOT NULL,
              before TEXT NOT NULL,
              after TEXT NOT NULL,
              undone_by INTEGER NULL
            )");
            $db->exec('CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)');
            $db->exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
            $db->exec('CREATE INDEX IF NOT EXISTS idx_entries_state ON entries(state)');
            $db->exec('CREATE INDEX IF NOT EXISTS idx_entries_merged ON entries(merged_into)');
            $db->exec('CREATE INDEX IF NOT EXISTS idx_votes_entry ON votes(entry_id)');
            $db->exec('CREATE INDEX IF NOT EXISTS idx_votes_ip_entry ON votes(ip_hash, entry_id)');
            $db->exec('CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes(voter_hash)');
            $db->exec('CREATE INDEX IF NOT EXISTS idx_actions_entry ON actions(entry_id)');
            $db->exec('CREATE INDEX IF NOT EXISTS idx_actions_run ON actions(run_id)');
        }
        if (ab_schema_version($db) < 2) {
            $cols = array_column(ab_all($db, 'PRAGMA table_info(entries)'), 'name');
            if (!in_array('external_url', $cols, true)) {
                $db->exec('ALTER TABLE entries ADD COLUMN external_url TEXT NULL');
            }
        }
        if (ab_schema_version($db) < 3) {
            $db->exec('CREATE INDEX IF NOT EXISTS idx_limits_window ON limits(window_start)');
            $db->exec('CREATE INDEX IF NOT EXISTS idx_entries_receipt ON entries(receipt_hash)');
        }
        $st = $db->prepare("INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
        $st->execute([(string)AB_SCHEMA_VERSION]);
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->exec('ROLLBACK');
        }
        throw $e;
    }
}

/** Run $fn inside one write transaction (BEGIN IMMEDIATE); rolls back on any throwable. */
function ab_tx(callable $fn)
{
    return ab_with_busy_retry(static function () use ($fn) {
        $db = ab_db();
        $db->exec('BEGIN IMMEDIATE');
        try {
            $r = $fn($db);
            $db->exec('COMMIT');
            return $r;
        } catch (Throwable $e) {
            if ($db->inTransaction()) {
                $db->exec('ROLLBACK');
            }
            throw $e;
        }
    });
}

function ab_one(PDO $db, string $sql, array $params = []): ?array
{
    $r = ab_with_busy_retry(static function () use ($db, $sql, $params) {
        $st = $db->prepare($sql);
        $st->execute($params);
        return $st->fetch();
    });
    return $r === false ? null : $r;
}

function ab_all(PDO $db, string $sql, array $params = []): array
{
    return ab_with_busy_retry(static function () use ($db, $sql, $params) {
        $st = $db->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    });
}

function ab_scalar(PDO $db, string $sql, array $params = [])
{
    return ab_with_busy_retry(static function () use ($db, $sql, $params) {
        $st = $db->prepare($sql);
        $st->execute($params);
        return $st->fetchColumn();
    });
}
