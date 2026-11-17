<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

function ab_config_defaults(): array
{
    return [
        'site_name' => 'My site',
        'site_url' => '',
        'about' => '',
        'turnstile_site_key' => '',
        'turnstile_secret_key' => '',
        'turnstile_verify_url' => 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        'secret' => '',
        'owner_token_sha256' => '',
        'triage_token_sha256' => '',
        'trusted_ip_header' => '',
        'allowed_origins' => [],
        'data_dir' => null,
        'moderation' => 'pending',
        'auto_apply_min_confidence' => 80,
        'credit' => true,
        'tags' => [],
        'welcome' => '',
        'read_token_sha256' => '',
        'mcp_enabled' => true,
        'mcp_allow_public_comments' => false, // deprecated alias of triage_public_writes
        'triage_public_writes' => false,
        'journal_mode' => 'delete',
        'trusted_proxies' => [],
        'turnstile_hostnames' => [],
        'contact_url' => '',
        'report_hide_at' => 3,
        'app_pass' => false,
        'limits' => [
            'entries_per_hour' => 5,
            'votes_per_hour' => 60,
            'sessions_per_hour' => 20,
            'votes_per_ip_per_entry' => 3,
            'admin_logins_per_hour' => 10,
            'pass_ttl_seconds' => 1800,
            'min_fill_ms' => 2500,
            'max_links' => 2,
            'mcp_calls_per_minute' => 120,
            'mcp_writes_per_minute' => 30,
            'sessions_global_per_hour' => 2000,
            'auth_failures_global_per_hour' => 500,
            'mine_per_hour' => 120,
            'reports_per_hour' => 10,
            'block_days' => 90,
        ],
    ];
}

function ab_document_root(): string
{
    return (string)($_SERVER['DOCUMENT_ROOT'] ?? '');
}

/** A contact link for the dialog footer: https://, http:// or mailto:, at most 300 chars, no whitespace or control characters. Else ''. */
function ab_clean_contact_url($v): string
{
    if (!is_string($v) || $v === '' || strlen($v) > 300 || preg_match('/[\s\p{Cc}\p{Cf}]/u', $v) !== 0) {
        return '';
    }
    if (preg_match('~^mailto:[^:]~i', $v) === 1) {
        return $v;
    }
    if (preg_match('~^https?://~i', $v) === 1) {
        $p = parse_url($v);
        return is_array($p) && !empty($p['host']) ? $v : '';
    }
    return '';
}

/** Locate config.php. Returns [path, location] or null. */
function ab_config_locate(): ?array
{
    $env = getenv('ARGHBOX_CONFIG');
    if (is_string($env) && $env !== '' && is_file($env)) {
        return [$env, 'env'];
    }
    $doc = ab_document_root();
    if ($doc !== '') {
        $p = dirname($doc) . '/arghbox-private/config.php';
        if (is_file($p)) {
            return [$p, 'private'];
        }
    }
    $local = dirname(__DIR__) . '/config.php';
    if (is_file($local)) {
        return [$local, 'local'];
    }
    return null;
}

/**
 * Load and normalize the configuration. Returns null when no config file exists.
 * Throws AbError(503 not_configured) when the file exists but is unusable.
 */
function ab_config_load(): ?array
{
    static $cache = false;
    if ($cache !== false) {
        return $cache;
    }
    $loc = ab_config_locate();
    if ($loc === null) {
        return $cache = null;
    }
    $loaded = (static function (string $path) {
        return require $path;
    })($loc[0]);
    if (!is_array($loaded)) {
        throw new AbError(503, 'not_configured', 'config.php must return an array.');
    }
    $cfg = ab_config_defaults();
    $limits = $cfg['limits'];
    foreach ($loaded as $k => $v) {
        if ($k !== 'limits' && array_key_exists($k, $cfg)) {
            $cfg[$k] = $v;
        }
    }
    if (isset($loaded['limits']) && is_array($loaded['limits'])) {
        foreach ($limits as $k => $default) {
            if (isset($loaded['limits'][$k]) && is_numeric($loaded['limits'][$k])) {
                $limits[$k] = (int)$loaded['limits'][$k];
            }
        }
    }
    $cfg['limits'] = $limits;
    $cfg['allowed_origins'] = array_values(array_filter(array_map(
        static fn($o) => rtrim(trim((string)$o), '/'),
        is_array($cfg['allowed_origins']) ? $cfg['allowed_origins'] : []
    ), static fn($o) => $o !== ''));
    $cfg['moderation'] = $cfg['moderation'] === 'publish' ? 'publish' : 'pending';
    $cfg['credit'] = (bool)$cfg['credit'];
    $cfg['journal_mode'] = strtolower((string)$cfg['journal_mode']) === 'wal' ? 'wal' : 'delete';
    $cfg['mcp_enabled'] = (bool)$cfg['mcp_enabled'];
    // triage_public_writes is the real switch; mcp_allow_public_comments is its deprecated alias.
    $cfg['triage_public_writes'] = (bool)$cfg['triage_public_writes'] || (bool)$cfg['mcp_allow_public_comments'];
    $cfg['mcp_allow_public_comments'] = $cfg['triage_public_writes'];
    foreach (['trusted_proxies', 'turnstile_hostnames'] as $k) {
        $cfg[$k] = array_values(array_filter(array_map(
            static fn($o) => strtolower(trim((string)$o)),
            is_array($cfg[$k]) ? $cfg[$k] : []
        ), static fn($o) => $o !== ''));
    }
    $cfg['contact_url'] = ab_clean_contact_url($cfg['contact_url']);
    $cfg['report_hide_at'] = is_numeric($cfg['report_hide_at']) ? max(0, min(100, (int)$cfg['report_hide_at'])) : 3;
    $cfg['app_pass'] = $cfg['app_pass'] === true;
    $cfg['limits']['block_days'] = max(1, (int)$cfg['limits']['block_days']);
    $cfg['welcome'] = ab_truncate(trim(is_string($cfg['welcome']) ? $cfg['welcome'] : ''), 500);
    $cfg['read_token_sha256'] = strtolower((string)$cfg['read_token_sha256']);
    $cfg['auto_apply_min_confidence'] = (int)$cfg['auto_apply_min_confidence'];
    foreach (['site_name', 'site_url', 'about', 'turnstile_site_key', 'turnstile_secret_key', 'turnstile_verify_url',
              'secret', 'trusted_ip_header'] as $k) {
        $cfg[$k] = (string)$cfg[$k];
    }
    $cfg['owner_token_sha256'] = strtolower((string)$cfg['owner_token_sha256']);
    $cfg['triage_token_sha256'] = strtolower((string)$cfg['triage_token_sha256']);
    $cfg['data_dir'] = ($cfg['data_dir'] === null || $cfg['data_dir'] === '') ? null : (string)$cfg['data_dir'];
    $cfg['_location'] = $loc[1];
    $cfg['_valid'] = (bool)preg_match('/^[0-9a-fA-F]{64}$/', $cfg['secret']);
    return $cache = $cfg;
}

/** The usable configuration; throws 503 not_configured when there is none. */
function ab_config(): array
{
    $cfg = ab_config_load();
    if ($cfg === null) {
        throw new AbError(503, 'not_configured', 'ArghBox is not configured yet: config.php is missing.');
    }
    if (!$cfg['_valid']) {
        throw new AbError(503, 'not_configured', 'config.php needs a "secret" of 64 hex characters.');
    }
    return $cfg;
}

function ab_inside(string $path, string $root): bool
{
    $p = realpath($path);
    $r = realpath($root);
    if ($p === false || $r === false) {
        return false;
    }
    $p = rtrim(str_replace('\\', '/', $p), '/') . '/';
    $r = rtrim(str_replace('\\', '/', $r), '/') . '/';
    if (DIRECTORY_SEPARATOR === '\\') {
        $p = strtolower($p);
        $r = strtolower($r);
    }
    return strpos($p, $r) === 0;
}

function ab_dir_usable(string $dir, bool $create): bool
{
    if (!is_dir($dir)) {
        if (!$create || !@mkdir($dir, 0700, true)) {
            return false;
        }
    }
    return is_writable($dir);
}

/** Write a deny-all .htaccess and an empty index.html into a data directory when missing. */
function ab_protect_dir(string $dir): void
{
    try {
        $ht = $dir . '/.htaccess';
        if (!is_file($ht)) {
            @file_put_contents($ht, "# ArghBox: nothing in this folder is ever served.\n<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order deny,allow\n  Deny from all\n</IfModule>\n");
        }
        $ix = $dir . '/index.html';
        if (!is_file($ix)) {
            @file_put_contents($ix, '');
        }
    } catch (Throwable $e) {
        // Best effort.
    }
}

/**
 * Resolve the data directory. Returns ['path' => string, 'kind' => 'outside_webroot'|'inside_webroot_protected']
 * or null when nothing usable exists. A usable directory always gets a deny-all .htaccess and an index.html.
 */
function ab_data_dir_resolve(?array $cfg, bool $create = true): ?array
{
    $found = ab_data_dir_pick($cfg, $create);
    if ($found !== null && $create) {
        ab_protect_dir($found['path']);
    }
    return $found;
}

function ab_data_dir_pick(?array $cfg, bool $create): ?array
{
    $doc = ab_document_root();
    $classify = static function (string $dir) use ($doc): string {
        return ($doc !== '' && ab_inside($dir, $doc)) ? 'inside_webroot_protected' : 'outside_webroot';
    };
    if ($cfg !== null && $cfg['data_dir'] !== null) {
        $d = $cfg['data_dir'];
        if (ab_dir_usable($d, $create) && ($doc === '' || !ab_inside($d, $doc))) {
            return ['path' => rtrim($d, '/\\'), 'kind' => 'outside_webroot'];
        }
    }
    $env = getenv('ARGHBOX_DATA_DIR');
    if (is_string($env) && $env !== '' && ab_dir_usable($env, $create)) {
        return ['path' => rtrim($env, '/\\'), 'kind' => $classify($env)];
    }
    if ($doc !== '') {
        $p = dirname($doc) . '/arghbox-private';
        if (ab_dir_usable($p, $create)) {
            return ['path' => $p, 'kind' => 'outside_webroot'];
        }
    }
    $local = dirname(__DIR__) . '/data';
    if (is_dir($local) && is_writable($local)) {
        return ['path' => $local, 'kind' => 'inside_webroot_protected'];
    }
    return null;
}

/** Does the parent of the data directory look like a web root? Returns a warning or null. */
function ab_data_dir_warning(string $dataDir): ?string
{
    $parent = dirname($dataDir);
    $name = strtolower(basename($parent));
    if (in_array($name, ['public_html', 'www', 'htdocs', 'html'], true)) {
        return 'The data folder sits inside a folder named "' . $name . '", which is usually the web root. Move it above the web root.';
    }
    if (is_file($parent . '/index.php') || is_file($parent . '/index.html')) {
        return 'The data folder sits next to an index file, so its parent looks like a web root. Move it above the web root.';
    }
    return null;
}

/** Cached resolution using the loaded config. */
function ab_data_dir_state(): ?array
{
    static $state = false;
    if ($state !== false) {
        return $state;
    }
    try {
        $cfg = ab_config_load();
    } catch (Throwable $e) {
        $cfg = null;
    }
    return $state = ab_data_dir_resolve($cfg, true);
}

/** The resolved data dir for logging; never throws. */
function ab_data_dir_cached(): ?string
{
    try {
        $r = ab_data_dir_state();
        return $r['path'] ?? null;
    } catch (Throwable $e) {
        return null;
    }
}
