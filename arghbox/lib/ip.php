<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

/**
 * Client IP handling: canonical form, IPv4-mapped IPv6, /64 keys for IPv6, and trust rules for
 * proxy headers. Cloudflare ranges are Cloudflare's published list (https://www.cloudflare.com/ips/);
 * override with the `trusted_proxies` config list when they change.
 */

const AB_CF_RANGES = [
    '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
    '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
    '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
    '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
    '2a06:98c0::/29', '2c0f:f248::/32',
];

/** Canonical text form of an IP (IPv4-mapped IPv6 becomes IPv4), or null when it is not an IP. */
function ab_ip_canonical(string $ip): ?string
{
    $ip = trim($ip);
    if ($ip === '' || strlen($ip) > 45) {
        return null;
    }
    $bin = @inet_pton($ip);
    if ($bin === false) {
        return null;
    }
    if (strlen($bin) === 16 && substr($bin, 0, 12) === str_repeat("\0", 10) . "\xff\xff") {
        $bin = substr($bin, 12);
    }
    $text = inet_ntop($bin);
    return $text === false ? null : $text;
}

/** Is $ip (canonical) inside any of the entries (plain IPs or CIDR ranges)? */
function ab_ip_in_list(string $ip, array $list): bool
{
    $bin = @inet_pton($ip);
    if ($bin === false) {
        return false;
    }
    foreach ($list as $entry) {
        $entry = (string)$entry;
        $slash = strpos($entry, '/');
        $addr = $slash === false ? $entry : substr($entry, 0, $slash);
        $range = @inet_pton($addr);
        if ($range === false || strlen($range) !== strlen($bin)) {
            // Allow a mapped IPv6 entry to match an IPv4 address.
            $canon = ab_ip_canonical($addr);
            $range = $canon === null ? false : @inet_pton($canon);
            if ($range === false || strlen($range) !== strlen($bin)) {
                continue;
            }
        }
        $bits = $slash === false ? strlen($bin) * 8 : (int)substr($entry, $slash + 1);
        if ($bits < 0 || $bits > strlen($bin) * 8) {
            continue;
        }
        $full = intdiv($bits, 8);
        if ($full > 0 && substr($bin, 0, $full) !== substr($range, 0, $full)) {
            continue;
        }
        $rest = $bits % 8;
        if ($rest > 0) {
            $mask = (0xFF << (8 - $rest)) & 0xFF;
            if ((ord($bin[$full]) & $mask) !== (ord($range[$full]) & $mask)) {
                continue;
            }
        }
        return true;
    }
    return false;
}

/** Is the header one of the Cloudflare-style single client IP headers? */
function ab_ip_header_trusted(array $cfg, string $remote): bool
{
    $hdr = $cfg['trusted_ip_header'];
    $proxies = $cfg['trusted_proxies'];
    if ($hdr === 'HTTP_CF_CONNECTING_IP') {
        return ab_ip_in_list($remote, $proxies ?: AB_CF_RANGES);
    }
    if ($proxies) {
        return ab_ip_in_list($remote, $proxies);
    }
    return $hdr !== 'HTTP_X_FORWARDED_FOR';
}

/** The caller's canonical IP, honouring the configured proxy header only when its sender is trusted. */
function ab_client_ip(): string
{
    $cfg = ab_config();
    $remote = ab_ip_canonical((string)($_SERVER['REMOTE_ADDR'] ?? '')) ?? '0.0.0.0';
    $hdr = $cfg['trusted_ip_header'];
    if ($hdr === '' || !ab_ip_header_trusted($cfg, $remote)) {
        return $remote;
    }
    $raw = (string)($_SERVER[$hdr] ?? '');
    if ($raw === '') {
        return $remote;
    }
    // Right-most entry that is not one of our own proxies.
    foreach (array_reverse(explode(',', $raw)) as $part) {
        $ip = ab_ip_canonical($part);
        if ($ip === null) {
            return $remote;
        }
        if ($cfg['trusted_proxies'] && ab_ip_in_list($ip, $cfg['trusted_proxies'])) {
            continue;
        }
        return $ip;
    }
    return $remote;
}

/** Rate limit and hash key for an IP: IPv6 addresses are grouped by their /64. */
function ab_ip_key(string $ip): string
{
    if (strpos($ip, ':') === false) {
        return $ip;
    }
    $bin = @inet_pton($ip);
    if ($bin === false || strlen($bin) !== 16) {
        return $ip;
    }
    return inet_ntop(substr($bin, 0, 8) . str_repeat("\0", 8)) . '/64';
}

/** The caller's IP as text (for Turnstile's remoteip). */
function ab_ip(): string
{
    return ab_client_ip();
}

function ab_ip_hash(): string
{
    static $h = null;
    if ($h === null) {
        $h = ab_hash('ip', ab_ip_key(ab_client_ip()));
    }
    return $h;
}

/**
 * True when the web server already put the visitor's address in REMOTE_ADDR: the header's right-most
 * entry is REMOTE_ADDR itself. LiteSpeed on Hostinger does this behind Cloudflare (it honours the header
 * only from Cloudflare's addresses), so ab_client_ip() falls back to REMOTE_ADDR, which is already the
 * real visitor, and there is nothing to warn about. Only the health warning uses this, never the IP itself.
 */
function ab_ip_resolved_by_server(string $raw, string $remote): bool
{
    $parts = explode(',', $raw);
    $last = ab_ip_canonical((string)end($parts));
    return $last !== null && $last === $remote;
}

/** State of the proxy header setting, for authenticated health checks. */
function ab_ip_header_status(): array
{
    $cfg = ab_config_load();
    if ($cfg === null || $cfg['trusted_ip_header'] === '') {
        return ['state' => 'not_configured', 'warning' => null];
    }
    $remote = ab_ip_canonical((string)($_SERVER['REMOTE_ADDR'] ?? '')) ?? '0.0.0.0';
    $raw = (string)($_SERVER[$cfg['trusted_ip_header']] ?? '');
    $present = $raw !== '';
    $warning = null;
    if (!ab_ip_header_trusted($cfg, $remote) && !ab_ip_resolved_by_server($raw, $remote)) {
        $warning = $cfg['trusted_ip_header'] === 'HTTP_CF_CONNECTING_IP'
            ? 'This request did not come from a Cloudflare address, so the Cloudflare header is ignored. If you use Cloudflare, check that the site is proxied; behind another proxy list its addresses in trusted_proxies.'
            : 'This request did not come from a trusted proxy, so the header is ignored. Check trusted_proxies.';
    }
    return ['state' => $present ? 'present' : 'missing', 'warning' => $warning];
}
