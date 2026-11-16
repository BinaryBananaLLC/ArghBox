<?php
declare(strict_types=1);

/**
 * Router for `php -S` used by tools/dev.mjs.
 *   /arghbox/*   -> the arghbox/ folder (with the same denials as .htaccess)
 *   /art/*       -> the repo art/ folder (images only: logos and art/brand favicons), for the demo page
 *   anything else -> the demo/ folder, or the folder named in ARGHBOX_SITE_DIR (dev.mjs --site <dir>);
 *                    a tiny built-in page is shown when that folder has no index.html
 */

$root = dirname(__DIR__);
$uriPath = (string)parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$path = rawurldecode($uriPath);

$mime = [
    'html' => 'text/html; charset=utf-8', 'htm' => 'text/html; charset=utf-8', 'css' => 'text/css; charset=utf-8',
    'js' => 'text/javascript; charset=utf-8', 'mjs' => 'text/javascript; charset=utf-8', 'json' => 'application/json; charset=utf-8',
    'svg' => 'image/svg+xml', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif',
    'webp' => 'image/webp', 'ico' => 'image/x-icon', 'woff2' => 'font/woff2', 'woff' => 'font/woff', 'txt' => 'text/plain; charset=utf-8',
    'xml' => 'application/xml', 'webmanifest' => 'application/manifest+json', 'pdf' => 'application/pdf',
];

function dev_deny(int $code, string $msg): void
{
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    echo $msg;
    exit;
}

function dev_serve_file(string $file, array $mime): void
{
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    header('Content-Type: ' . ($mime[$ext] ?? 'application/octet-stream'));
    header('Cache-Control: no-cache');
    readfile($file);
    exit;
}

if (strpos($path, '..') !== false || strpos($path, "\0") !== false) {
    dev_deny(400, 'Bad path');
}

if ($path === '/arghbox') {
    header('Location: /arghbox/');
    exit;
}

if (strpos($path, '/art/') === 0) {
    $artFile = $root . $path;
    $artExt = strtolower(pathinfo($artFile, PATHINFO_EXTENSION));
    if (strpos($path, '/art/src/') === 0 || strpos($path, '/art/fonts/') === 0
        || !in_array($artExt, ['png', 'svg', 'ico', 'webmanifest'], true) || !is_file($artFile)) {
        dev_deny(404, 'Not found');
    }
    dev_serve_file($artFile, $mime);
}

if (strpos($path, '/arghbox/') === 0) {
    $rel = substr($path, strlen('/arghbox/'));
    $first = explode('/', $rel)[0];
    $base = basename($rel);
    if ($first === 'lib' || $first === 'data' || $base === 'config.php' || $base === 'config.example.php'
        || $base === 'VERSION' || strpos($base, '.sqlite') !== false || $base === '.htaccess') {
        dev_deny(403, 'Forbidden');
    }
    $target = $root . '/arghbox/' . $rel;
    if (is_dir($target)) {
        $target = rtrim($target, '/');
        foreach (['index.php', 'index.html'] as $idx) {
            if (is_file($target . '/' . $idx)) {
                $target .= '/' . $idx;
                break;
            }
        }
    }
    if (!is_file($target)) {
        dev_deny(404, 'Not found');
    }
    if (strtolower(pathinfo($target, PATHINFO_EXTENSION)) === 'php') {
        $_SERVER['SCRIPT_FILENAME'] = $target;
        $_SERVER['SCRIPT_NAME'] = '/arghbox/' . ltrim(substr($target, strlen($root . '/arghbox/')), '/');
        chdir(dirname($target));
        require $target;
        exit;
    }
    dev_serve_file($target, $mime);
}

$siteEnv = getenv('ARGHBOX_SITE_DIR');
$site = ($siteEnv !== false && $siteEnv !== '') ? rtrim(str_replace('\\', '/', $siteEnv), '/') : $root . '/demo';
$target = $site . $path;
if (is_dir($target)) {
    $target = rtrim($target, '/') . '/index.html';
}
if (is_file($target)) {
    dev_serve_file($target, $mime);
}
if (($path === '/' || $path === '/index.html') && !is_file($site . '/index.html')) {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    echo <<<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArghBox dev demo</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}code{background:#eee;padding:.1em .3em;border-radius:3px}</style>
</head>
<body>
<h1>ArghBox dev demo</h1>
<p>This is the built-in demo page of <code>tools/dev.mjs</code>. The feedback tab sits at the edge of the window.</p>
<p>Admin page: <a href="/arghbox/admin/">/arghbox/admin/</a>. Open the dialog with <a href="#arghbox">#arghbox</a>.</p>
<script src="/arghbox/arghbox.js" defer></script>
</body>
</html>
HTML;
    exit;
}
dev_deny(404, 'Not found');
