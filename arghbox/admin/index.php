<?php
declare(strict_types=1);

// ArghBox admin page shell. No secrets and no logic: headers plus the HTML skeleton.
// Everything else is rendered by admin.js from the admin API (../api.php).
// no-transform: proxies must not rewrite this page. It stops Cloudflare from injecting its Web
// Analytics beacon, which the CSP below would block (a console error on every admin page load).
header('Cache-Control: no-store, no-transform');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
header('X-Robots-Tag: noindex, nofollow');
header('Content-Type: text/html; charset=utf-8');

// Signing in sends the owner token, so refuse plain http (except on this machine, for development).
$abHttps = (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off')
    || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https'
    || strpos(strtolower((string)($_SERVER['HTTP_CF_VISITOR'] ?? '')), '"https"') !== false;
$abHost = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
$abHost = $abHost !== '' && $abHost[0] === '[' ? substr($abHost, 1, max(0, (int)strpos($abHost, ']') - 1)) : explode(':', $abHost)[0];
$abLoopback = $abHost === 'localhost' || $abHost === '127.0.0.1' || $abHost === '::1' || substr($abHost, -10) === '.localhost';
if (!$abHttps && !$abLoopback) {
    http_response_code(403);
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>ArghBox admin</title><link rel="stylesheet" href="admin.css"></head>'
        . '<body><main class="login"><div class="login-card"><h1>Use https://</h1><p>The admin page only works over a secure connection, because signing in sends your token. '
        . 'Open this page again with <strong>https://</strong> at the start of the address.</p></div></main></body></html>';
    exit;
}
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>ArghBox admin</title>
<link rel="icon" href="logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="admin.css">
</head>
<body>
<div id="app" class="app">
  <noscript><p class="boot-note">The ArghBox admin page needs JavaScript.</p></noscript>
  <p class="boot-note" id="boot-note">Loading...</p>
</div>
<script src="admin.js"></script>
</body>
</html>
