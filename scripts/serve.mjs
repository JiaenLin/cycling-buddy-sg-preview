import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || process.argv[2] || 4173);
const mime = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.geojson', 'application/geo+json; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8']
]);

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  let relative;
  try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'; }
  catch { response.writeHead(400).end('Bad request'); return; }
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Forbidden'); return;
  }
  let stat;
  try { stat = fs.statSync(target); }
  catch { response.writeHead(404).end('Not found'); return; }
  const file = stat.isDirectory() ? path.join(target, 'index.html') : target;
  response.writeHead(200, {
    'Content-Type': mime.get(path.extname(file).toLowerCase()) || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Service-Worker-Allowed': '/'
  });
  fs.createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', () => console.log(`release artifact: http://127.0.0.1:${port}`));
