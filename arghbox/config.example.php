<?php
/**
 * ArghBox configuration. Copy this file to config.php and fill it in.
 *
 * Best place: one folder ABOVE your web root, as arghbox-private/config.php
 * (for example /home/you/domains/example.com/arghbox-private/config.php).
 * Second best: next to api.php as arghbox/config.php (.htaccess blocks it).
 *
 * Generate the secret and the tokens with:  node tools/new-secrets.mjs   (add --read for a read-only token)
 * Only the sha256 hashes of the tokens go in this file. Never commit config.php.
 * Then open /arghbox/api.php?action=health: config must be "found" and config_valid true.
 */
return [
    // Shown in the dialog title and on the admin page.
    'site_name' => 'My site',
    // The site's public URL (used in admin links and the triage packet).
    'site_url' => 'https://example.com',
    // One paragraph about the site and its audience. The triage AI reads it.
    'about' => 'Describe what your site does and who uses it.',

    // Cloudflare Turnstile keys (free): https://dash.cloudflare.com/?to=/:account/turnstile
    'turnstile_site_key' => '',
    'turnstile_secret_key' => '',
    // Hostnames a Turnstile token may come from, besides the host of site_url (e.g. a www and a non-www name).
    'turnstile_hostnames' => [],
    // Only change this for tests.
    'turnstile_verify_url' => 'https://challenges.cloudflare.com/turnstile/v0/siteverify',

    // 64 hex characters. Keys the HMACs for IP hashes, voters, passes and admin cookies.
    'secret' => '',
    // sha256 hex of the owner token (admin page sign-in and admin API).
    'owner_token_sha256' => '',
    // sha256 hex of the triage token (admin API only, used by the triage skill).
    'triage_token_sha256' => '',

    // '' uses REMOTE_ADDR. Behind Cloudflare use 'HTTP_CF_CONNECTING_IP'; Hostinger CDN: 'HTTP_X_REAL_IP'.
    // The header is only believed when the connection comes from a trusted proxy: Cloudflare's published
    // address ranges for HTTP_CF_CONNECTING_IP, or the addresses in trusted_proxies. 'HTTP_X_FORWARDED_FOR'
    // is only used together with trusted_proxies.
    'trusted_ip_header' => '',
    // Addresses or CIDR ranges of your own proxies, e.g. ['203.0.113.7', '10.0.0.0/8']. Empty: Cloudflare's
    // ranges (built in) for HTTP_CF_CONNECTING_IP, and any sender for other single-address headers.
    'trusted_proxies' => [],

    // Extra origins allowed to call the public API from a browser (CORS).
    // The site's own origin always works. Example: ['https://www.example.com'].
    'allowed_origins' => [],

    // Absolute path outside the web root, or null for automatic (arghbox-private/ next to the web root; see docs).
    // A path inside the web root is ignored. If the chosen folder is not writable, ArghBox falls back
    // to arghbox/data/ and the health check says inside_webroot_protected.
    'data_dir' => null,

    // 'pending': new entries wait for triage or your review. 'publish': shown at once.
    'moderation' => 'pending',
    // Triage decisions with a lower confidence are stored as "flag" for you to decide.
    'auto_apply_min_confidence' => 80,
    // Show the small "ArghBox" credit link in the dialog.
    'credit' => true,
    // Short plain-text note from you shown at the top of the dialog (at most 500 characters).
    // Example: 'Tell us what bugs you. We read everything and reply here.'
    'welcome' => '',

    // sha256 hex of an optional READ-ONLY token: admin GET actions, exports and the MCP read tools only.
    // Hand this out for reporting or "what are users asking about?" sessions. Leave '' to disable.
    // Get a token and its hash with:  node tools/new-secrets.mjs --read
    'read_token_sha256' => '',

    // Serve mcp.php, the MCP server for Claude Code, Cursor and other MCP clients (it needs the triage token).
    'mcp_enabled' => true,
    // Let the TRIAGE token (the AI: the triage skill and MCP) put new text on the public board: public comments,
    // public tasks, publishing entries, rewriting published titles. Off by default, so a poisoned visitor entry
    // cannot make an AI publish text on your site. Statuses, tags, merges, rejections and private notes always work.
    // (Old name: mcp_allow_public_comments, still accepted.)
    'triage_public_writes' => false,

    // SQLite journal mode: 'delete' (default, works everywhere) or 'wal' (readers and writers overlap; creates
    // -wal and -shm files next to the database; do not use on network filesystems). WAL falls back to delete
    // when it cannot be enabled.
    'journal_mode' => 'delete',

    // A "Contact" link in the dialog footer: an https://, http:// or mailto: address, at most 300 characters, with no
    // spaces. Anything else is ignored. App stores want apps that show user posts to publish contact details.
    // Example: 'mailto:feedback@example.com'
    'contact_url' => '',

    // Visitors can report a published entry. When this many DIFFERENT people (distinct network addresses) have an open
    // report on it, it is hidden (back to pending) until you or the triage AI review it. 0 = never hide automatically.
    // Whatever the number, reported entries show up in the admin page's Reported list. 0 to 100.
    'report_hide_at' => 3,

    // Opt-in, WEAKER protection for mobile apps whose WebView cannot run Cloudflare Turnstile: the app page asks for a
    // pass without the human check. Anyone can ask for it, so it proves neither a human nor a genuine app. New entries
    // still wait for review, but votes are then limited only by the per-IP caps. Leave false unless you ship the box in an app.
    'app_pass' => false,

    // Optional preset tags offered first to the triage AI and to you, e.g. ['map', 'export', 'mobile'].
    'tags' => [],

    // Rate limits and form checks. Missing keys use these defaults.
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
        'sessions_global_per_hour' => 2000,       // Turnstile checks per hour for the whole site
        'auth_failures_global_per_hour' => 500,   // wrong tokens per hour for the whole site
        'mine_per_hour' => 120,                   // "your arghs" lookups per visitor per hour
        'reports_per_hour' => 10,                 // reports per network address per hour
        'block_days' => 90,                       // how long a blocked author stays blocked
    ],
];
