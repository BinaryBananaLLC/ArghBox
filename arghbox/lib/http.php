<?php
declare(strict_types=1);
defined('ARGHBOX_BOOT') || exit;

/** An error that becomes a JSON error response. */
final class AbError extends Exception
{
    public int $status;
    public string $errorCode;
    public ?string $field;
    public ?int $retryAfter;

    public function __construct(int $status, string $errorCode, string $message, ?string $field = null, ?int $retryAfter = null)
    {
        parent::__construct($message);
        $this->status = $status;
        $this->errorCode = $errorCode;
        $this->field = $field;
        $this->retryAfter = $retryAfter;
    }
}

function ab_invalid(string $field, string $message): AbError
{
    return new AbError(400, 'invalid_input', $message, $field);
}

/** @return array<int,string> */
function &ab_extra_headers_ref(): array
{
    static $h = [];
    return $h;
}

function ab_add_header(string $line): void
{
    $h = &ab_extra_headers_ref();
    $h[] = $line;
}

/** Convert an empty array into an object so it encodes as {}. */
function ab_obj($v)
{
    return (is_array($v) && count($v) === 0) ? new stdClass() : $v;
}

function ab_json(array $body): string
{
    $flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR;
    $out = json_encode($body, $flags);
    return $out === false ? '{"ok":false,"error":"server_error","message":"Server error."}' : $out;
}

/** Send a JSON response and stop. */
function ab_send(int $status, array $body, array $headers = []): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header('X-Robots-Tag: noindex, nofollow');
        foreach (ab_extra_headers_ref() as $line) {
            header($line);
        }
        foreach ($headers as $line) {
            header($line);
        }
    }
    if ($status !== 204) {
        echo ab_json($body);
    }
    exit;
}

function ab_ok(array $body = [], int $status = 200): void
{
    ab_send($status, ['ok' => true] + $body);
}

function ab_send_error(AbError $e): void
{
    $body = ['ok' => false, 'error' => $e->errorCode, 'message' => $e->getMessage()];
    if ($e->field !== null) {
        $body['field'] = $e->field;
    }
    $headers = [];
    if ($e->retryAfter !== null) {
        $body['retry_after'] = $e->retryAfter;
        $headers[] = 'Retry-After: ' . $e->retryAfter;
    }
    if ($e->status === 405) {
        $headers[] = 'Allow: GET, POST, OPTIONS';
    }
    ab_send($e->status, $body, $headers);
}

/** Log a private diagnostic line (data dir error.log). Never part of a response. */
function ab_log_error(string $line): void
{
    try {
        $dir = ab_data_dir_cached();
        if ($dir === null) {
            return;
        }
        $file = $dir . '/error.log';
        if (is_file($file) && filesize($file) > 262144) {
            @rename($file, $file . '.1');
        }
        $line = preg_replace('/[\x00-\x1F\x7F]/', ' ', $line) ?? $line;
        $isNew = !is_file($file);
        @file_put_contents($file, gmdate('c') . ' ' . $line . "\n", FILE_APPEND | LOCK_EX);
        if ($isNew) {
            @chmod($file, 0600);
        }
    } catch (Throwable $e) {
        // Logging must never break a response.
    }
}

function ab_boot(): void
{
    ini_set('display_errors', '0');
    ini_set('html_errors', '0');
    error_reporting(E_ALL);
    ob_start();
    set_error_handler(static function (int $no, string $str, string $file, int $line): bool {
        if ((error_reporting() & $no) === 0) {
            return false; // silenced with @
        }
        if ($no === E_DEPRECATED || $no === E_USER_DEPRECATED) {
            ab_log_error("deprecated: $str at " . basename($file) . ":$line");
            return true;
        }
        throw new ErrorException($str, 0, $no, $file, $line);
    });
    set_exception_handler(static function (Throwable $e): void {
        ab_handle_throwable($e);
    });
    register_shutdown_function(static function (): void {
        $err = error_get_last();
        if ($err !== null && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
            ab_log_error('fatal: ' . $err['message'] . ' at ' . basename($err['file']) . ':' . $err['line']);
            while (ob_get_level() > 0) {
                ob_end_clean();
            }
            if (!headers_sent()) {
                http_response_code(500);
                header('Content-Type: application/json; charset=utf-8');
                header('Cache-Control: no-store');
                header('X-Content-Type-Options: nosniff');
                header('X-Robots-Tag: noindex, nofollow');
            }
            echo '{"ok":false,"error":"server_error","message":"Something went wrong on the server."}';
        }
    });
}

function ab_handle_throwable(Throwable $e): void
{
    if ($e instanceof AbError) {
        ab_send_error($e);
    }
    if (function_exists('ab_is_busy') && ab_is_busy($e)) {
        ab_send_error(ab_busy_error());
    }
    ab_log_error(get_class($e) . ': ' . $e->getMessage() . ' at ' . basename($e->getFile()) . ':' . $e->getLine());
    ab_send(500, ['ok' => false, 'error' => 'server_error', 'message' => 'Something went wrong on the server.']);
}

function ab_header(string $name): string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    $v = $_SERVER[$key] ?? '';
    if ($v === '' && $name === 'Authorization') {
        $v = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if ($v === '' && function_exists('getallheaders')) {
            foreach (getallheaders() as $k => $val) {
                if (strtolower((string)$k) === 'authorization') {
                    $v = (string)$val;
                }
            }
        }
    }
    return is_string($v) ? trim($v) : '';
}

function ab_method(): string
{
    return strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
}

function ab_is_https(): bool
{
    $https = $_SERVER['HTTPS'] ?? '';
    if ($https !== '' && strtolower((string)$https) !== 'off') {
        return true;
    }
    if (strtolower(ab_header('X-Forwarded-Proto')) === 'https') {
        return true;
    }
    $cf = json_decode(ab_header('CF-Visitor'), true);
    return is_array($cf) && ($cf['scheme'] ?? '') === 'https';
}

/** Parsed JSON object body of a POST (cached). Empty body gives []. */
function ab_body(int $max = 16384): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $len = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($len > $max) {
        throw new AbError(413, 'bad_request', 'The request body is too large.');
    }
    $raw = (string)file_get_contents('php://input', false, null, 0, $max + 1);
    if (strlen($raw) > $max) {
        throw new AbError(413, 'bad_request', 'The request body is too large.');
    }
    if (trim($raw) === '') {
        return $cache = [];
    }
    $ct = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if (strpos($ct, 'application/json') === false) {
        throw new AbError(415, 'bad_request', 'Send the request body as application/json.');
    }
    try {
        $data = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        throw new AbError(400, 'bad_request', 'The request body is not valid JSON.');
    }
    if (!is_array($data) || (count($data) > 0 && array_keys($data) === range(0, count($data) - 1))) {
        throw new AbError(400, 'bad_request', 'The request body must be a JSON object.');
    }
    return $cache = $data;
}

/** Send a non-JSON body (feed, export) and stop. */
function ab_send_raw(int $status, string $contentType, string $body, array $headers = []): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: ' . $contentType);
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header('X-Robots-Tag: noindex, nofollow');
        foreach ($headers as $line) {
            header($line);
        }
    }
    echo $body;
    exit;
}
