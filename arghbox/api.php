<?php
declare(strict_types=1);

/**
 * ArghBox API: the only PHP entry point for JSON. See docs/SPEC.md sections 6 and 7.
 * This file only wires the pieces in lib/ together.
 */

define('ARGHBOX_BOOT', true);

foreach (['version', 'http', 'config', 'ip', 'security', 'db', 'ratelimit', 'turnstile', 'entries', 'votes', 'actions', 'public', 'admin', 'export', 'router'] as $part) {
    require __DIR__ . '/lib/' . $part . '.php';
}

ab_boot();
try {
    ab_dispatch();
} catch (Throwable $e) {
    ab_handle_throwable($e);
}
