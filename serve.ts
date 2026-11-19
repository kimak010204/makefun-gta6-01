// SOLMAR CITY — tiny static server for local play.
// Serves game/ at the root: open http://localhost:8080
// v3 rebuild: unchanged server, visuals upgraded in game/src/main.js.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8080);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  // Map the root to game/index.html; everything else resolves under game/ first,
  // then under the repo root (README, screenshots).
  const candidates = [
    join(root, 'game', urlPath === '/' ? 'index.html' : urlPath),
    join(root, normalize(urlPath).replace(/^(\.\.[/\\])+/, '')),
  ];
  for (const file of candidates) {
    const abs = resolve(file);
    const base = resolve(root);
    if (!abs.startsWith(base)) continue;
    if (existsSync(abs) && statSync(abs).isFile()) {
      res.writeHead(200, { 'content-type': MIME[extname(abs)] ?? 'application/octet-stream' });
      res.end(readFileSync(abs));
      return;
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`SOLMAR CITY at http://localhost:${PORT}`);
});
