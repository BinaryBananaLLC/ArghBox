<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

function ab_same_origin(string $origin): bool
{
    $p = parse_url($origin);
    if (!is_array($p) || empty($p['host'])) {
        return false;
    }
    $host = strtolower($p['host']) . (isset($p['port']) ? ':' . $p['port'] : '');
    return $host === strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
}

/**
 * Is a cross-origin caller listed in allowed_origins? Entries are exact origins; an entry ending in ":*"
 * (e.g. "http://localhost:*") allows that scheme and host on any port, for local development servers.
 */
function ab_origin_allowed(string $origin, array $allowed): bool
{
    $origin = rtrim($origin, '/');
    foreach ($allowed as $o) {
        if (!is_string($o)) {
            continue;
        }
        if ($o === $origin) {
            return true;
        }
        if (substr($o, -2) === ':*' && preg_match('~^' . preg_quote(substr($o, 0, -2), '~') . '(:[0-9]{1,5})?$~D', $origin)) {
            return true;
        }
    }
    return false;
}

/** Public actions: name => [method, handler]. */
function ab_public_routes(): array
{
    return [
        'list' => ['GET', 'ab_h_list'],
        'session' => ['POST', 'ab_h_session'],
        'add' => ['POST', 'ab_h_add'],
        'vote' => ['POST', 'ab_h_vote'],
        'report' => ['POST', 'ab_h_report'],
        'mine' => ['POST', 'ab_h_mine'],
        'feed' => ['GET', 'ab_h_feed'],
    ];
}

/** Admin actions: name => [method, handler]. */
function ab_admin_routes(): array
{
    return [
        'admin.me' => ['GET', 'ab_h_admin_me'],
        'admin.logout' => ['POST', 'ab_h_admin_logout'],
        'admin.queue' => ['GET', 'ab_h_admin_queue'],
        'admin.apply' => ['POST', 'ab_h_admin_apply'],
        'admin.create' => ['POST', 'ab_h_admin_create'],
        'admin.update' => ['POST', 'ab_h_admin_update'],
        'admin.comment' => ['POST', 'ab_h_admin_comment'],
        'admin.comment_update' => ['POST', 'ab_h_admin_comment_update'],
        'admin.undo' => ['POST', 'ab_h_admin_undo'],
        'admin.entry' => ['GET', 'ab_h_admin_entry'],
        'admin.export' => ['GET', 'ab_h_admin_export'],
        'admin.entries' => ['GET', 'ab_h_admin_entries'],
        'admin.log' => ['GET', 'ab_h_admin_log'],
        'admin.runs' => ['GET', 'ab_h_admin_runs'],
        'admin.stats' => ['GET', 'ab_h_admin_stats'],
        'admin.dismiss_reports' => ['POST', 'ab_h_admin_dismiss_reports'],
        'admin.block' => ['POST', 'ab_h_admin_block'],
        'admin.unblock' => ['POST', 'ab_h_admin_unblock'],
    ];
}

function ab_dispatch(): void
{
    $method = ab_method();
    $action = $_GET['action'] ?? '';
    $action = is_string($action) ? $action : '';

    if ($action === 'health') {
        if ($method !== 'GET') {
            throw new AbError(405, 'method_not_allowed', 'Use GET.');
        }
        ab_h_health();
        return;
    }

    $cfg = ab_config();
    $isAdmin = strpos($action, 'admin.') === 0;
    $routes = $isAdmin ? ab_admin_routes() : ab_public_routes();
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    $crossOrigin = $origin !== '' && !ab_same_origin($origin);

    if ($method === 'OPTIONS') {
        if ($crossOrigin && !$isAdmin) {
            if (!ab_origin_allowed($origin, $cfg['allowed_origins'])) {
                throw new AbError(403, 'origin_not_allowed', 'This origin is not allowed.');
            }
            ab_cors($origin);
        }
        ab_send(204, []);
    }

    if ($crossOrigin) {
        $allowed = !$isAdmin && ab_origin_allowed($origin, $cfg['allowed_origins']);
        if ($allowed) {
            ab_cors($origin);
        } elseif ($method === 'POST') {
            throw new AbError(403, 'origin_not_allowed', 'This origin is not allowed.');
        }
    }

    if ($action === 'admin.login') {
        if ($method !== 'POST') {
            throw new AbError(405, 'method_not_allowed', 'Use POST.');
        }
        ab_h_admin_login();
        return;
    }
    if (!isset($routes[$action])) {
        throw new AbError(404, 'not_found', 'Unknown action.');
    }
    [$want, $handler] = $routes[$action];
    if ($method !== $want) {
        throw new AbError(405, 'method_not_allowed', 'Use ' . $want . ' for this action.');
    }
    if ($isAdmin) {
        $hint = $_GET['reviewer'] ?? null;
        if ($method === 'POST') {
            try {
                $b = ab_body(AB_ADMIN_BODY_MAX);
                $hint = $b['run']['reviewer'] ?? ($b['reviewer'] ?? $hint);
            } catch (AbError $e) {
                // Reported after authentication.
            }
        }
        $auth = ab_admin_auth($method === 'POST', is_string($hint) ? $hint : null);
        $handler($auth);
        return;
    }
    $handler();
}

function ab_cors(string $origin): void
{
    ab_add_header('Access-Control-Allow-Origin: ' . $origin);
    ab_add_header('Vary: Origin');
    ab_add_header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    ab_add_header('Access-Control-Allow-Headers: Content-Type, X-ArghBox-Voter');
    ab_add_header('Access-Control-Max-Age: 600');
}
