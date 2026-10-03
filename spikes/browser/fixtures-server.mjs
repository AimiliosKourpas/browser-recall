// Local fixture server that also records every request it receives (used for the "no request leaves the extension" control).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const CSP = {
  'strict-csp': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; base-uri 'none'",
  'frame-src-none': "default-src 'self' 'unsafe-inline'; frame-src 'none'; child-src 'none'",
};

export function startServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, t: Date.now() });
    const m = /^\/f\/([\w-]+)\.html/.exec(req.url ?? '');
    if (!m) {
      res.writeHead(204).end();
      return;
    }
    try {
      const body = readFileSync(join(dir, `${m[1]}.html`));
      const headers = { 'content-type': 'text/html; charset=utf-8' };
      if (CSP[m[1]]) headers['content-security-policy'] = CSP[m[1]];
      res.writeHead(200, headers).end(body);
    } catch {
      res.writeHead(404).end('nope');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requests, base: `http://127.0.0.1:${server.address().port}` })));
}
