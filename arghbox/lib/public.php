<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

function ab_h_health(): void
{
    $cfg = null;
    $problem = false;
    try {
        $cfg = ab_config_load();
    } catch (Throwable $e) {
        $problem = true;
    }
    $sqlite = null;
    if (extension_loaded('pdo_sqlite')) {
        try {
            $mem = new PDO('sqlite::memory:');
            $sqlite = (string)$mem->query('select sqlite_version()')->fetchColumn();
        } catch (Throwable $e) {
            $sqlite = null;
        }
    }
    $st = ab_data_dir_resolve($cfg, $cfg !== null);
    $dataKind = $st === null ? 'error' : $st['kind'];
    $configValid = $cfg !== null && !$problem && $cfg['_valid'];
    // ok means: this install can serve requests.
    $ready = $configValid && $sqlite !== null && $dataKind !== 'error';
    // Details that help an attacker (where things are, how the proxy header is treated) only go to the owner.
    $privileged = $cfg !== null && $configValid && ab_caller_is_privileged();
    $out = [
        'ok' => $ready,
        'version' => ARGHBOX_VERSION,
        'php' => $privileged ? PHP_VERSION : PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
        'sqlite' => $sqlite,
        'config' => $cfg === null ? 'missing' : 'found',
        'data_dir' => $dataKind,
        'turnstile' => $cfg !== null && $cfg['turnstile_site_key'] !== '' && $cfg['turnstile_secret_key'] !== '',
        'ip_header' => $cfg !== null && $cfg['trusted_ip_header'] !== '' ? 'configured' : 'not_configured',
        'moderation' => $cfg === null ? null : $cfg['moderation'],
        'admin' => $cfg !== null && $cfg['owner_token_sha256'] !== '',
        'config_valid' => $configValid,
    ];
    if ($privileged) {
        $ip = ab_ip_header_status();
        $out['ip_header'] = $ip['state'];
        $out['config_location'] = $cfg['_location'];
        $out['warnings'] = array_values(array_filter([
            $ip['warning'],
            $st !== null ? ab_data_dir_warning($st['path']) : null,
            ab_turnstile_is_test_secret($cfg['turnstile_secret_key']) ? 'Turnstile is using Cloudflare test keys: every visitor passes. Use your real keys in production.' : null,
        ]));
        $out['turnstile_test_keys'] = ab_turnstile_is_test_secret($cfg['turnstile_secret_key']);
        $out['data_dir_warning'] = $st !== null ? ab_data_dir_warning($st['path']) : null;
    }
    ab_send($ready ? 200 : 503, $out);
}

function ab_h_list(): void
{
    $cfg = ab_config();
    $db = ab_db();
    $alias = ab_alias_info($db);
    $rows = ab_all($db, "SELECT * FROM entries WHERE state = 'published' ORDER BY votes DESC, created_at DESC, id DESC LIMIT 500");
    $entries = [];
    $ids = [];
    $tagCounts = [];
    foreach ($rows as $r) {
        $e = ab_public_entry($r, $alias);
        $entries[] = $e;
        $ids[(int)$r['id']] = true;
        foreach ($e['tags'] as $t) {
            $tagCounts[$t] = ($tagCounts[$t] ?? 0) + 1;
        }
    }
    $tc = [];
    foreach ($tagCounts as $t => $n) {
        $tc[] = ['tag' => (string)$t, 'count' => $n];
    }
    usort($tc, static fn($a, $b) => [$b['count'], $a['tag']] <=> [$a['count'], $b['tag']]);
    $voted = [];
    $voter = ab_header('X-ArghBox-Voter');
    if ($voter !== '' && ab_valid_voter($voter)) {
        $vh = ab_hash('voter', $voter);
        foreach (ab_all($db, 'SELECT entry_id FROM votes WHERE voter_hash = ?', [$vh]) as $v) {
            if (isset($ids[(int)$v['entry_id']])) {
                $voted[] = (int)$v['entry_id'];
            }
        }
    }
    ab_ok([
        'site' => ['name' => $cfg['site_name']],
        'welcome' => $cfg['welcome'],
        'max_links' => (int)$cfg['limits']['max_links'],
        'version' => ARGHBOX_VERSION,
        'turnstile_site_key' => $cfg['turnstile_site_key'],
        'moderation' => $cfg['moderation'],
        'credit' => $cfg['credit'],
        'entries' => $entries,
        'tag_counts' => $tc,
        'voted' => $voted,
    ]);
}

function ab_h_session(): void
{
    $cfg = ab_config();
    $in = ab_body();
    if ($cfg['turnstile_secret_key'] === '') {
        throw new AbError(503, 'turnstile_not_configured', 'Turnstile is not configured on this server.');
    }
    $token = $in['turnstile'] ?? null;
    // Do not bother Cloudflare (or count against the limits) for tokens that cannot be real.
    if (!is_string($token) || $token === '' || strlen($token) > 2048 || !preg_match('/^[A-Za-z0-9._-]+$/', $token)) {
        throw new AbError(403, 'turnstile_failed', 'The human check is missing. Reload and try again.');
    }
    ab_rl_take_all([
        ['sessions|*', (int)$cfg['limits']['sessions_global_per_hour']],
        ['sessions|' . ab_ip_hash(), (int)$cfg['limits']['sessions_per_hour']],
    ]);
    if (!ab_turnstile_verify($token, ab_ip())) {
        throw new AbError(403, 'turnstile_failed', 'The human check failed. Try again.');
    }
    [$pass, $exp] = ab_make_pass();
    ab_ok(['pass' => $pass, 'expires_at' => ab_iso($exp), 'expires_in' => $exp - ab_now()]);
}

function ab_fake_add(string $type, string $title, string $body): void
{
    ab_ok([
        'entry' => [
            'id' => 0, 'type' => $type, 'title' => $title, 'body' => $body, 'votes' => 1, 'status' => 'open',
            'status_at' => null, 'tags' => [], 'comments' => [], 'similar' => 0, 'aliases' => [], 'source' => 'visitor',
            'created_at' => ab_iso(), 'state' => 'pending',
        ],
        'receipt' => ab_b64u(random_bytes(18)),
    ]);
}

function ab_h_add(): void
{
    $cfg = ab_config();
    $in = ab_body();
    ab_check_pass($in['pass'] ?? null);
    $voter = ab_voter_from($in);

    $type = $in['type'] ?? null;
    if (!is_string($type) || !in_array($type, AB_TYPES, true)) {
        throw ab_invalid('type', 'The type must be idea, bug or question.');
    }
    $title = ab_clean_title($in['title'] ?? null);
    $body = ab_clean_body($in['body'] ?? null);
    ab_check_links($title, $body, (int)$cfg['limits']['max_links']);

    // Bots: silent fake success, nothing stored.
    $hp = $in['hp'] ?? '';
    $elapsed = $in['elapsed_ms'] ?? null;
    if ((is_string($hp) && $hp !== '') || (!is_string($hp) && $hp !== null && $hp !== false && $hp !== '')) {
        ab_fake_add($type, $title, $body);
    }
    if (!is_numeric($elapsed) || (float)$elapsed < (int)$cfg['limits']['min_fill_ms']) {
        ab_fake_add($type, $title, $body);
    }
    $context = ab_clean_context($in['context'] ?? null);

    $ipHash = ab_ip_hash();
    $receipt = ab_b64u(random_bytes(18));
    $state = $cfg['moderation'] === 'publish' ? 'published' : 'pending';
    $limit = (int)$cfg['limits']['entries_per_hour'];

    $row = ab_tx(static function (PDO $db) use ($limit, $ipHash, $type, $title, $body, $context, $state, $receipt, $voter): array {
        ab_rl_check($db, 'entries|' . $ipHash, $limit);
        $id = ab_insert_entry($db, [
            'type' => $type, 'title' => $title, 'body' => $body, 'state' => $state, 'context' => $context,
            'author_hash' => $ipHash, 'receipt_hash' => ab_hash('receipt', $receipt),
        ]);
        ab_insert_vote($db, $id, ab_hash('voter', $voter), $ipHash);
        ab_recount($db, $id);
        ab_rl_hit($db, 'entries|' . $ipHash);
        return ab_entry_row($db, $id);
    });
    ab_ok(['entry' => ab_public_entry($row, ab_empty_ctx()) + ['state' => $state], 'receipt' => $receipt]);
}

function ab_h_vote(): void
{
    ab_config();
    $in = ab_body();
    ab_check_pass($in['pass'] ?? null);
    $voter = ab_voter_from($in);
    $id = $in['id'] ?? null;
    if (!is_int($id) || $id < 1) {
        throw ab_invalid('id', 'The entry id is missing.');
    }
    $on = $in['on'] ?? true;
    if (!is_bool($on)) {
        throw ab_invalid('on', '"on" must be true or false.');
    }
    ab_ok(ab_cast_vote($voter, $id, $on));
}

function ab_h_mine(): void
{
    $cfg = ab_config();
    $in = ab_body();
    ab_rl_take('mine', (int)$cfg['limits']['mine_per_hour']);
    $receipts = $in['receipts'] ?? null;
    if (!is_array($receipts) || count($receipts) > 50) {
        throw ab_invalid('receipts', 'Send at most 50 receipts.');
    }
    $db = ab_db();
    $ctx = ab_alias_info($db);
    $out = [];
    foreach ($receipts as $rc) {
        if (!is_string($rc) || $rc === '' || strlen($rc) > 100) {
            continue;
        }
        $r = ab_one($db, 'SELECT * FROM entries WHERE receipt_hash = ?', [ab_hash('receipt', $rc)]);
        if ($r === null) {
            continue;
        }
        $mergedInto = null;
        $mergedTitle = null;
        if ($r['state'] === 'merged' && $r['merged_into'] !== null) {
            $final = ab_resolve_target($db, (int)$r['merged_into']);
            $t = $final === null ? null : ab_entry_row($db, $final);
            if ($t !== null) {
                $mergedInto = (int)$t['id'];
                $mergedTitle = $t['title'];
            }
        }
        $state = $r['state'] === 'flagged' ? 'pending' : $r['state'];
        $out[] = [
            'receipt' => $rc,
            'id' => (int)$r['id'],
            'type' => $r['type'],
            'title' => $r['title'],
            'state' => $state,
            'status' => $r['status'],
            'tags' => ab_tags_of($r['tags']),
            'comments' => $ctx['pub'][(int)$r['id']] ?? [],
            'merged_into' => $mergedInto,
            'merged_into_title' => $mergedTitle,
            'reject_reason' => $r['state'] === 'rejected' ? $r['reject_reason'] : null,
        ];
    }
    ab_ok(['entries' => $out]);
}
