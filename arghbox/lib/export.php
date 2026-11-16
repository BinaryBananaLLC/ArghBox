<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

// ---- Atom feed (public) ---------------------------------------------------

function ab_xml(string $s): string
{
    // Drop characters that are not allowed in XML 1.0, then escape.
    $s = preg_replace('/[^\x{9}\x{A}\x{D}\x{20}-\x{D7FF}\x{E000}-\x{FFFD}\x{10000}-\x{10FFFF}]/u', '', $s) ?? '';
    return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function ab_status_label(string $status): string
{
    $map = ['planned' => 'Planned', 'in_progress' => 'In progress', 'done' => 'Done', 'declined' => 'Declined'];
    return $map[$status] ?? '';
}

function ab_h_feed(): void
{
    $cfg = ab_config();
    $db = ab_db();
    $rows = ab_all($db, "SELECT * FROM entries WHERE state = 'published' ORDER BY updated_at DESC, id DESC LIMIT 50");
    $ctx = ab_alias_info($db);
    $site = rtrim($cfg['site_url'], '/');
    $urnBase = 'urn:arghbox:' . substr(ab_hash('feed', 'id'), 0, 32);
    $feedId = $site !== '' ? $site . '/#arghbox-feed' : $urnBase;
    $updated = $rows ? (string)$rows[0]['updated_at'] : ab_iso();
    // The self link comes from the configured site_url, never from request headers.
    $self = $site !== '' ? $site . preg_replace('/[^A-Za-z0-9_.\/-]/', '', (string)($_SERVER['SCRIPT_NAME'] ?? '/arghbox/api.php')) . '?action=feed' : '';

    $x = '<?xml version="1.0" encoding="utf-8"?>' . "\n";
    $x .= '<feed xmlns="http://www.w3.org/2005/Atom">' . "\n";
    $x .= '  <title>' . ab_xml($cfg['site_name']) . '</title>' . "\n";
    $x .= '  <id>' . ab_xml($feedId) . '</id>' . "\n";
    $x .= '  <updated>' . ab_xml($updated) . '</updated>' . "\n";
    $x .= '  <author><name>' . ab_xml($cfg['site_name']) . '</name></author>' . "\n";
    if ($site !== '') {
        $x .= '  <link rel="alternate" href="' . ab_xml($site . '/') . '"/>' . "\n";
    }
    if ($self !== '') {
        $x .= '  <link rel="self" type="application/atom+xml" href="' . ab_xml($self) . '"/>' . "\n";
    }
    $x .= '  <generator version="' . ab_xml(ARGHBOX_VERSION) . '">ArghBox</generator>' . "\n";
    foreach ($rows as $r) {
        $id = (int)$r['id'];
        $label = ab_status_label((string)$r['status']);
        $title = ($label !== '' ? '[' . $label . '] ' : '') . $r['title'];
        $text = (string)$r['body'];
        $comments = $ctx['pub'][$id] ?? [];
        if ($comments) {
            $last = $comments[count($comments) - 1];
            $text .= ($text !== '' ? "\n\n" : '') . $last['body'];
        }
        $entryId = $site !== '' ? $site . '/#arghbox-' . $id : $urnBase . ':' . $id;
        $x .= "  <entry>\n";
        $x .= '    <title>' . ab_xml($title) . "</title>\n";
        $x .= '    <id>' . ab_xml($entryId) . "</id>\n";
        $x .= '    <updated>' . ab_xml((string)$r['updated_at']) . "</updated>\n";
        $x .= '    <published>' . ab_xml((string)$r['created_at']) . "</published>\n";
        if ($site !== '') {
            $x .= '    <link rel="alternate" href="' . ab_xml($site . '/#arghbox-' . $id) . "\"/>\n";
        }
        $x .= '    <content type="text">' . ab_xml($text) . "</content>\n";
        foreach (ab_tags_of($r['tags']) as $t) {
            $x .= '    <category term="' . ab_xml((string)$t) . "\"/>\n";
        }
        $x .= "  </entry>\n";
    }
    $x .= "</feed>\n";
    ab_send_raw(200, 'application/atom+xml; charset=utf-8', $x, ['Cache-Control: public, max-age=600']);
}

// ---- Export (admin) -------------------------------------------------------

/** One CSV field: quoted when needed, and neutralised against spreadsheet formula injection. */
function ab_csv_field($v, bool $text = false): string
{
    $s = $v === null ? '' : (string)$v;
    if ($text && $s !== '' && strpos("=+-@\t\r", $s[0]) !== false) {
        $s = "'" . $s;
    }
    if (preg_match('/[",\r\n]/', $s)) {
        return '"' . str_replace('"', '""', $s) . '"';
    }
    return $s;
}

function ab_csv_row(array $fields): string
{
    return implode(',', $fields) . "\r\n";
}

function ab_export_slug(string $name): string
{
    $s = strtolower(preg_replace('/[^A-Za-z0-9]+/', '-', $name) ?? '');
    $s = trim(substr($s, 0, 40), '-');
    return $s === '' ? 'site' : $s;
}

/** @return array{0: string, 1: string, 2: string} content type, filename, body */
function ab_svc_export(string $format, string $state): array
{
    $cfg = ab_config();
    $db = ab_db();
    if (!in_array($format, ['json', 'csv', 'jira-csv'], true)) {
        throw ab_invalid('format', 'format must be json, csv or jira-csv.');
    }
    if ($state !== '' && !in_array($state, AB_STATES, true)) {
        throw ab_invalid('state', 'Unknown state.');
    }
    $ctx = ab_alias_info($db);
    $base = 'arghbox-' . ab_export_slug($cfg['site_name']) . '-' . gmdate('Ymd');

    if ($format === 'jira-csv') {
        $rows = ab_all($db, "SELECT * FROM entries WHERE state = 'published' AND status IN ('open', 'planned', 'in_progress') ORDER BY id");
        $map = ['bug' => 'Bug', 'idea' => 'Story', 'question' => 'Task'];
        $out = "\xEF\xBB\xBF" . ab_csv_row(['Summary', 'Description', 'Issue Type', 'Labels']);
        foreach ($rows as $r) {
            $desc = trim((string)$r['body']);
            $desc .= ($desc !== '' ? "\n\n" : '') . 'From ArghBox #' . (int)$r['id'] . ', ' . (int)$r['votes'] . ((int)$r['votes'] === 1 ? ' vote' : ' votes');
            $out .= ab_csv_row([
                ab_csv_field($r['title'], true), ab_csv_field($desc, true), ab_csv_field($map[$r['type']] ?? 'Task'),
                ab_csv_field(implode(' ', ab_tags_of($r['tags']))),
            ]);
        }
        return ['text/csv; charset=utf-8', $base . '-jira.csv', $out];
    }

    if ($state !== '') {
        $rows = ab_all($db, 'SELECT * FROM entries WHERE state = ? ORDER BY id', [$state]);
    } else {
        $rows = ab_all($db, "SELECT * FROM entries WHERE state != 'rejected' ORDER BY id");
    }

    if ($format === 'json') {
        $entries = [];
        foreach ($rows as $r) {
            $entries[] = ab_admin_entry($r, $ctx);
        }
        $runs = [];
        foreach (ab_all($db, 'SELECT * FROM runs ORDER BY id') as $r) {
            $runs[] = ab_run_out($r);
        }
        $doc = [
            'exported_at' => ab_iso(), 'version' => ARGHBOX_VERSION,
            'site' => ['name' => $cfg['site_name'], 'url' => $cfg['site_url']],
            'tags' => ab_tag_vocabulary($db, $cfg), 'entries' => $entries, 'runs' => $runs,
        ];
        $flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRETTY_PRINT;
        return ['application/json; charset=utf-8', $base . '.json', (string)json_encode($doc, $flags) . "\n"];
    }

    $out = "\xEF\xBB\xBF" . ab_csv_row(array_map('ab_csv_field', [
        'id', 'type', 'state', 'status', 'title', 'body', 'votes', 'tags', 'created_at', 'updated_at',
        'merged_into', 'reject_reason', 'external_url', 'source', 'comments',
    ]));
    foreach ($rows as $r) {
        $id = (int)$r['id'];
        $comments = array_map(static fn($c) => (string)$c['body'], $ctx['pub'][$id] ?? []);
        $out .= ab_csv_row([
            (string)$id, ab_csv_field($r['type']), ab_csv_field($r['state']), ab_csv_field($r['status']),
            ab_csv_field($r['title'], true), ab_csv_field($r['body'], true), (string)(int)$r['votes'],
            ab_csv_field(implode(';', ab_tags_of($r['tags']))), ab_csv_field($r['created_at']), ab_csv_field($r['updated_at']),
            $r['merged_into'] === null ? '' : (string)(int)$r['merged_into'], ab_csv_field($r['reject_reason']),
            ab_csv_field($r['external_url'] ?? null), ab_csv_field($r['source']),
            ab_csv_field(implode("\n\n", $comments), true),
        ]);
    }
    return ['text/csv; charset=utf-8', $base . '.csv', $out];
}

function ab_h_admin_export(array $auth): void
{
    $format = ab_qstr($_GET, 'format');
    [$type, $file, $body] = ab_svc_export($format === '' ? 'json' : $format, ab_qstr($_GET, 'state'));
    ab_send_raw(200, $type, $body, [
        'Cache-Control: no-store',
        'Content-Disposition: attachment; filename="' . $file . '"',
    ]);
}
