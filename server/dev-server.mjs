// Local dev: serves the site and the real leaderboard Worker on one port, backed by SQLite.
//   node server/dev-server.mjs            → http://localhost:8787
// Data lives in server/dev.sqlite so it survives restarts. Delete the file to reset.
import http from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './worker.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const siteRoot = join(here, '..', 'public');
const db = new DatabaseSync(process.env.DD_DB || join(here, 'dev.sqlite'));
db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
for (const f of readdirSync(join(here, 'migrations')).filter(n => n.endsWith('.sql')).sort()) {
  try { db.exec(readFileSync(join(here, 'migrations', f), 'utf8')); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
}
const DB = {
  prepare(sql) {
    const stmt = db.prepare(sql);
    const bound = args => ({
      first: async () => stmt.get(...args) ?? null,
      all: async () => ({ results: stmt.all(...args) }),
      run: async () => { const r = stmt.run(...args); return { meta: { changes: Number(r.changes) } }; },
    });
    return { bind: (...args) => bound(args.map(a => (a === undefined ? null : a))), ...bound([]) };
  },
};
const env = { DB, ADMIN_TOKEN: process.env.ADMIN_TOKEN || 'dev-admin', IP_SALT: 'dev', ALLOWED_ORIGIN: '*' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 8787);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers(Object.entries(req.headers).filter(([, v]) => typeof v === 'string'));
    headers.set('cf-connecting-ip', req.socket.remoteAddress || '127.0.0.1');
    const out = await worker.fetch(new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, { waitUntil() {} });
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(`window.DD_CONFIG = { apiBase: 'http://localhost:${port}', siteUrl: 'http://localhost:${port}/' };`);
    return;
  }
  let path = normalize(join(siteRoot, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!path.startsWith(siteRoot) || !existsSync(path) || statSync(path).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
  res.end(readFileSync(path));
}).listen(port, () => console.log(`Super Sortie dev server: http://localhost:${port}`));
