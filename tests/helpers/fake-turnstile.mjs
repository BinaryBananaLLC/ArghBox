// A fake Cloudflare Turnstile siteverify endpoint. Success for any token unless it
// starts with "fail". It is a separate Node server: php -S on Windows is single-threaded,
// so PHP must never call back into itself.
import http from 'node:http';

/**
 * @returns {Promise<{url: string, port: number, requests: Array<Record<string,string>>, stop(): Promise<void>}>}
 */
export function startFakeTurnstile({ port = 0 } = {}) {
  const requests = [];
  let forced = null; // when set, every answer is this object (tests use it for odd hostnames)
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/_requests') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(requests));
      return;
    }
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const fields = Object.fromEntries(new URLSearchParams(raw));
      requests.push(fields);
      const token = fields.response || '';
      if (forced) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(forced));
        return;
      }
      const ok = token !== '' && !token.startsWith('fail');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Tokens can steer the answer: "host-<name>-..." reports another hostname, "act-<name>-..." an action.
      const host = (token.match(/^host-([A-Za-z0-9.]+?)(?:--|$)/) || [])[1] || 'localhost';
      const action = (token.match(/^act-([A-Za-z0-9]+?)(?:--|$)/) || [])[1];
      res.end(JSON.stringify(ok
        ? { success: true, challenge_ts: new Date().toISOString(), hostname: host, ...(action ? { action } : {}), 'error-codes': [] }
        : { success: false, 'error-codes': ['invalid-input-response'] }));
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({
        url: `http://127.0.0.1:${p}/siteverify`,
        port: p,
        requests,
        forceResponse: (obj) => { forced = obj; },
        stop: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('fake-turnstile.mjs')) {
  const i = process.argv.indexOf('--port');
  const t = await startFakeTurnstile({ port: i > 0 ? Number(process.argv[i + 1]) : 0 });
  console.log(`Fake Turnstile verify endpoint: ${t.url}`);
}
