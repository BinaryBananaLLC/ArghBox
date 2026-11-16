<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

function ab_now(): int
{
    return time();
}

function ab_iso(?int $t = null): string
{
    return gmdate('Y-m-d\TH:i:s\Z', $t ?? time());
}

function ab_b64u(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function ab_b64u_decode(string $s): ?string
{
    if ($s === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $s)) {
        return null;
    }
    $r = base64_decode(strtr($s, '-_', '+/'), true);
    return $r === false ? null : $r;
}

/** hex HMAC-SHA256 of "<label>|<value>". */
function ab_hash(string $label, string $value): string
{
    return hash_hmac('sha256', $label . '|' . $value, ab_config()['secret']);
}

function ab_valid_voter(string $v): bool
{
    return (bool)preg_match('/^[A-Za-z0-9_-]{22,64}$/', $v);
}

function ab_voter_from(array $in): string
{
    $v = $in['voter'] ?? null;
    if (!is_string($v) || !ab_valid_voter($v)) {
        throw ab_invalid('voter', 'The voter key is missing or malformed.');
    }
    return $v;
}

// ---- Passes -------------------------------------------------------------

function ab_make_pass(): array
{
    $ttl = (int)ab_config()['limits']['pass_ttl_seconds'];
    $exp = ab_now() + $ttl;
    $payload = ab_b64u(json_encode(['h' => ab_ip_hash(), 'e' => $exp, 'n' => ab_b64u(random_bytes(9))]));
    $sig = ab_b64u(hash_hmac('sha256', 'pass|' . $payload, ab_config()['secret'], true));
    return [$payload . '.' . $sig, $exp];
}

/** Verify a pass; throws pass_invalid / pass_expired. */
function ab_check_pass($pass): void
{
    if (!is_string($pass) || $pass === '' || strlen($pass) > 400 || substr_count($pass, '.') !== 1) {
        throw new AbError(401, 'pass_invalid', 'The pass is missing or invalid.');
    }
    [$payload, $sig] = explode('.', $pass, 2);
    $expect = ab_b64u(hash_hmac('sha256', 'pass|' . $payload, ab_config()['secret'], true));
    if (!hash_equals($expect, $sig)) {
        throw new AbError(401, 'pass_invalid', 'The pass is missing or invalid.');
    }
    $raw = ab_b64u_decode($payload);
    $data = $raw === null ? null : json_decode($raw, true);
    if (!is_array($data) || !isset($data['h'], $data['e']) || !is_string($data['h'])) {
        throw new AbError(401, 'pass_invalid', 'The pass is missing or invalid.');
    }
    if ((int)$data['e'] < ab_now()) {
        throw new AbError(401, 'pass_expired', 'The pass has expired. Get a new one.');
    }
    if (!hash_equals($data['h'], ab_ip_hash())) {
        throw new AbError(401, 'pass_invalid', 'The pass was issued to another network.');
    }
}

// ---- Admin authentication ----------------------------------------------

function ab_clean_reviewer($v): string
{
    $s = is_string($v) ? $v : '';
    $s = preg_replace('/[^A-Za-z0-9 ._:+()\/-]/', '', $s) ?? '';
    $s = trim($s);
    return $s === '' ? 'triage' : substr($s, 0, 60);
}

/** Is this actor string a triage (AI) actor? */
function ab_actor_is_triage(string $actor): bool
{
    return strpos($actor, 'triage:') === 0;
}

/** The current admin epoch (bumped by logout; old cookies stop working). */
function ab_admin_epoch(): string
{
    $v = ab_scalar(ab_db(), "SELECT value FROM meta WHERE key = 'admin_epoch'");
    return $v === false ? '0' : (string)$v;
}

function ab_admin_epoch_bump(): void
{
    ab_tx(static function (PDO $db): void {
        $cur = ab_scalar($db, "SELECT value FROM meta WHERE key = 'admin_epoch'");
        $next = (string)(($cur === false ? 0 : (int)$cur) + 1);
        $db->prepare("INSERT INTO meta(key, value) VALUES('admin_epoch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")->execute([$next]);
    });
}

/** Fingerprint of the current owner token hash, so rotating the owner token invalidates cookies. */
function ab_owner_binding(): string
{
    return hash('sha256', ab_config()['owner_token_sha256']);
}

function ab_admin_cookie_make(): string
{
    $payload = ab_b64u(json_encode(['a' => 'owner', 'e' => ab_now() + 43200, 'k' => ab_owner_binding(), 'n' => ab_admin_epoch()]));
    return $payload . '.' . ab_b64u(hash_hmac('sha256', 'admin|' . $payload, ab_config()['secret'], true));
}

function ab_admin_cookie_valid(string $cookie): bool
{
    if ($cookie === '' || substr_count($cookie, '.') !== 1) {
        return false;
    }
    [$payload, $sig] = explode('.', $cookie, 2);
    $expect = ab_b64u(hash_hmac('sha256', 'admin|' . $payload, ab_config()['secret'], true));
    if (!hash_equals($expect, $sig)) {
        return false;
    }
    $raw = ab_b64u_decode($payload);
    $data = $raw === null ? null : json_decode($raw, true);
    if (!is_array($data) || ($data['a'] ?? '') !== 'owner' || (int)($data['e'] ?? 0) < ab_now()) {
        return false;
    }
    if (!is_string($data['k'] ?? null) || !hash_equals(ab_owner_binding(), $data['k'])) {
        return false;
    }
    return is_string($data['n'] ?? null) && hash_equals(ab_admin_epoch(), $data['n']);
}

function ab_csrf_for(string $cookie): string
{
    return hash_hmac('sha256', 'csrf|' . $cookie, ab_config()['secret']);
}

function ab_cookie_path(): string
{
    $uri = (string)parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    $dir = str_replace('\\', '/', dirname($uri));
    return ($dir === '' || $dir === '.') ? '/' : $dir;
}

function ab_set_admin_cookie(string $value, int $expires): void
{
    setcookie('arghbox_admin', $value, [
        'expires' => $expires,
        'path' => ab_cookie_path(),
        'secure' => ab_is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

/** Which role does this bearer token have? 'owner', 'triage', 'read' or null. */
function ab_token_role(string $token, array $cfg): ?string
{
    if ($token === '') {
        return null;
    }
    $h = hash('sha256', $token);
    foreach (['owner' => 'owner_token_sha256', 'triage' => 'triage_token_sha256', 'read' => 'read_token_sha256'] as $role => $key) {
        if ($cfg[$key] !== '' && hash_equals($cfg[$key], $h)) {
            return $role;
        }
    }
    return null;
}

/** The bearer token of the request, or ''. */
function ab_bearer(): string
{
    $auth = ab_header('Authorization');
    return stripos($auth, 'Bearer ') === 0 ? trim(substr($auth, 7)) : '';
}

/**
 * Record a failed credential check (wrong bearer or login token). The per-IP and the global counter are
 * checked first and updated in one transaction; throws 429 when either limit is reached.
 */
function ab_auth_failure(): void
{
    $cfg = ab_config();
    $ipKey = 'authfail|' . ab_ip_hash();
    $max = (int)$cfg['limits']['admin_logins_per_hour'];
    $globalMax = (int)$cfg['limits']['auth_failures_global_per_hour'];
    ab_tx(static function (PDO $db) use ($ipKey, $max, $globalMax): void {
        ab_rl_check($db, 'authfail|*', $globalMax);
        ab_rl_check($db, $ipKey, $max);
        ab_rl_hit($db, 'authfail|*');
        ab_rl_hit($db, $ipKey);
    });
}

/** Refuse plain HTTP for sign-in unless the host is loopback (development). */
function ab_require_https(): void
{
    if (ab_is_https() || ab_host_is_loopback()) {
        return;
    }
    throw new AbError(403, 'forbidden', 'Sign in over https:// only. This page was requested over plain http, where your token could be read by others.');
}

function ab_host_is_loopback(): bool
{
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    if ($host !== '' && $host[0] === '[') {
        $host = (string)substr($host, 1, (int)strpos($host, ']') - 1);
    } else {
        $host = explode(':', $host)[0];
    }
    return $host === 'localhost' || $host === '127.0.0.1' || $host === '::1'
        || (strlen($host) > 10 && substr($host, -10) === '.localhost');
}

/**
 * Authenticate an admin request. Returns ['actor' => string, 'via' => 'owner'|'triage'|'read'|'cookie', 'csrf' => ?string].
 * Throws 401 unauthorized (wrong bearers are throttled) or 403 forbidden (read token on POST).
 */
function ab_admin_auth(bool $isPost, ?string $reviewerHint = null): array
{
    $cfg = ab_config();
    $auth = ab_header('Authorization');
    if ($auth !== '') {
        $role = ab_token_role(ab_bearer(), $cfg);
        if ($role === 'owner') {
            return ['actor' => 'owner', 'via' => 'owner', 'csrf' => null];
        }
        if ($role === 'triage') {
            return ['actor' => 'triage:' . ab_clean_reviewer($reviewerHint), 'via' => 'triage', 'csrf' => null];
        }
        if ($role === 'read') {
            if ($isPost) {
                throw new AbError(403, 'forbidden', 'This token is read-only.');
            }
            return ['actor' => 'read', 'via' => 'read', 'csrf' => null];
        }
        ab_auth_failure();
        throw new AbError(401, 'unauthorized', 'Sign in with a valid token.');
    }
    $cookie = (string)($_COOKIE['arghbox_admin'] ?? '');
    if ($cookie !== '' && ab_admin_cookie_valid($cookie)) {
        $csrf = ab_csrf_for($cookie);
        if ($isPost) {
            $sent = ab_header('X-ArghBox-CSRF');
            if ($sent === '' || !hash_equals($csrf, $sent)) {
                throw new AbError(401, 'unauthorized', 'The CSRF token is missing or wrong.');
            }
        }
        return ['actor' => 'owner', 'via' => 'cookie', 'csrf' => $csrf];
    }
    throw new AbError(401, 'unauthorized', 'Sign in with a valid token.');
}

/** Is the caller authenticated (owner, triage or read bearer, or the admin cookie)? Never throws, never counts failures. */
function ab_caller_is_privileged(): bool
{
    try {
        $cfg = ab_config();
        if (ab_header('Authorization') !== '') {
            $role = ab_token_role(ab_bearer(), $cfg);
            return $role !== null; // owner, triage and read tokens all see the full health details
        }
        $cookie = (string)($_COOKIE['arghbox_admin'] ?? '');
        return $cookie !== '' && ab_admin_cookie_valid($cookie);
    } catch (Throwable $e) {
        return false;
    }
}
