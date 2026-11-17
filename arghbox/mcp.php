<?php
declare(strict_types=1);

/**
 * ArghBox MCP server: stateless Streamable HTTP, JSON responses only. See docs/SPEC.md section 7b.
 * Connect with: claude mcp add --transport http arghbox https://example.com/arghbox/mcp.php
 *               --header "Authorization: Bearer <triage token>"
 */

define('ARGHBOX_BOOT', true);

foreach (['version', 'http', 'config', 'ip', 'security', 'db', 'ratelimit', 'entries', 'votes', 'reports', 'actions', 'admin', 'export', 'mcp'] as $part) {
    require __DIR__ . '/lib/' . $part . '.php';
}

function ab_mcp_fail(Throwable $e): void
{
    if (!($e instanceof AbError)) {
        ab_log_error(get_class($e) . ': ' . $e->getMessage() . ' at ' . basename($e->getFile()) . ':' . $e->getLine());
    }
    if (ab_is_busy($e)) {
        $e = ab_busy_error();
    }
    $status = $e instanceof AbError ? $e->status : 500;
    $msg = $e instanceof AbError ? $e->getMessage() : 'Internal error.';
    ab_mcp_error($status, null, $e instanceof AbError ? -32000 : -32603, $msg, null, ($e instanceof AbError && $e->errorCode === 'busy') ? ['Retry-After: 2'] : []);
}

ab_boot();
// Errors are JSON-RPC errors on this endpoint, never the REST error shape.
set_exception_handler('ab_mcp_fail');
try {
    ab_mcp_dispatch();
} catch (Throwable $e) {
    ab_mcp_fail($e);
}
