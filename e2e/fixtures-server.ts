// Local HTTP fixture server that records every request it receives. Used both to serve fixture pages and as the
// "no request may leave the extension" recorder (privacy tests).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FixtureServer {
  origin: string;
  requests: string[];
  close(): Promise<void>;
}

export async function startFixtureServer(dir = join(import.meta.dirname, 'fixtures')): Promise<FixtureServer> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    requests.push(url);
    const match = /^\/f\/([\w-]+)\.html$/.exec(url);
    if (!match) return void res.writeHead(204).end();
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(join(dir, `${match[1]}.html`)));
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections(); // keep-alive connections would otherwise hold close() open
      }),
  };
}
