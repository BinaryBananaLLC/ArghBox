<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

/** Cloudflare's published Turnstile test secrets (always pass, always fail, token already spent). */
const AB_TURNSTILE_TEST_SECRETS = [
    '1x0000000000000000000000000000000AA',
    '2x0000000000000000000000000000000AA',
    '3x0000000000000000000000000000000AA',
];

function ab_turnstile_is_test_secret(string $secret): bool
{
    return in_array($secret, AB_TURNSTILE_TEST_SECRETS, true);
}

/**
 * Ask Cloudflare (or the configured verify URL) whether a Turnstile token is good.
 * Returns true/false; throws AbError(502 turnstile_failed) when the verifier cannot be reached.
 * A good token must also come from one of our hostnames and carry the action "arghbox" (when reported).
 */
function ab_turnstile_verify(string $token, string $ip): bool
{
    $cfg = ab_config();
    $fields = http_build_query([
        'secret' => $cfg['turnstile_secret_key'],
        'response' => $token,
        'remoteip' => $ip,
    ]);
    $url = $cfg['turnstile_verify_url'];
    $raw = false;
    $detail = '';
    if (function_exists('curl_init') && getenv('ARGHBOX_NO_CURL') !== '1') {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $fields,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        ]);
        $raw = curl_exec($ch);
        $detail = 'curl: ' . (curl_errno($ch) !== 0 ? 'error ' . curl_errno($ch) . ' ' . curl_error($ch) : 'no error')
            . ', HTTP ' . (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        // The handle is released when it goes out of scope (curl_close() is deprecated since PHP 8.5).
        unset($ch);
    } else {
        $ctx = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => $fields,
            'timeout' => 8,
            'ignore_errors' => true,
        ]]);
        $raw = @file_get_contents($url, false, $ctx);
        $status = isset($http_response_header[0]) ? (string)$http_response_header[0] : 'no response';
        $last = error_get_last();
        $detail = 'stream: ' . $status . ($raw === false && $last !== null ? ', ' . $last['message'] : '');
    }
    if (!is_string($raw) || $raw === '') {
        ab_log_error('turnstile: verification request failed (' . $detail . ')');
        throw new AbError(502, 'turnstile_failed', 'Could not reach the verification service. Try again.');
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        ab_log_error('turnstile: verifier answered with non-JSON (' . $detail . ')');
        throw new AbError(502, 'turnstile_failed', 'The verification service answered with something unexpected.');
    }
    if (($data['success'] ?? false) !== true) {
        return false;
    }
    // The token must have been issued for this site and for ArghBox, not replayed from another widget.
    if (!ab_turnstile_is_test_secret($cfg['turnstile_secret_key'])) {
        $allowed = $cfg['turnstile_hostnames'];
        $siteHost = strtolower((string)parse_url($cfg['site_url'], PHP_URL_HOST));
        if ($siteHost !== '') {
            $allowed[] = $siteHost;
        }
        $host = strtolower((string)($data['hostname'] ?? ''));
        if ($allowed && $host !== '' && !in_array($host, $allowed, true)) {
            ab_log_error('turnstile: token was issued for hostname "' . substr($host, 0, 100) . '", which is not in site_url or turnstile_hostnames');
            return false;
        }
    }
    $action = (string)($data['action'] ?? '');
    if ($action !== '' && $action !== 'arghbox') {
        ab_log_error('turnstile: token carries action "' . substr($action, 0, 50) . '", expected "arghbox"');
        return false;
    }
    return true;
}
