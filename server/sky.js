// The Whole Sky: fly alongside ghosts of the day's top runs. Built from the raceable ghosts (see ghosts.js),
// thinned to one sample every 0.4 s: int16 x, int16 y, int8 heading (×127/π), uint8 flags (1 rolling, 2 shot down).
// Served as one small binary bundle: uint32 meta length, the meta JSON, then each path back to back.
import { GHOSTS_PER_DAY } from './ghosts.js';
export const SKY_DT = 0.4, SKY_BYTES = 6;

// The 0.2 s, 8-byte ghost recording -> every other sample, without the score.
export function thinGhost(b64) {
  const bin = atob(b64), n = Math.floor(bin.length / 8), out = new Uint8Array(Math.ceil(n / 2) * SKY_BYTES);
  let o = 0;
  for (let i = 0; i < n; i += 2) for (let k = 0; k < SKY_BYTES; k++) out[o++] = bin.charCodeAt(i * 8 + k);
  return out;
}

// GET /api/v1/sky?day=N[&d=deviceId]: the day's top ghosts. Names only for accounts.
export async function getSky(url, env, cors) {
  const day = Math.floor(Number(url.searchParams.get('day')));
  if (!Number.isFinite(day)) return new Response(JSON.stringify({ error: 'bad_day' }), { status: 400, headers: Object.assign({ 'content-type': 'application/json' }, cors) });
  const me = String(url.searchParams.get('d') || '').slice(0, 64);
  const rows = (await env.DB.prepare(
    `SELECT g.device_id AS d, g.data, s.score, s.plane, s.livery, s.theme, a.username AS u FROM ghosts g
     JOIN scores s ON s.day = g.day AND s.device_id = g.device_id AND s.hidden = 0
     LEFT JOIN accounts a ON a.id = s.account_id
     WHERE g.day = ? ORDER BY g.score DESC LIMIT ?`
  ).bind(day, GHOSTS_PER_DAY).all()).results || [];
  const paths = rows.map(r => thinGhost(r.data));
  const meta = JSON.stringify({ day, dt: SKY_DT, ghosts: rows.map((r, i) => {
    const g = { p: r.plane || '', l: r.livery || 0, t: r.theme || '', n: paths[i].length / SKY_BYTES, r: i + 1 };
    if (r.u) g.u = r.u;
    if (me && r.d === me) g.me = 1;
    return g;
  }) });
  const mb = new TextEncoder().encode(meta), out = new Uint8Array(4 + mb.length + paths.reduce((s, b) => s + b.length, 0));
  new DataView(out.buffer).setUint32(0, mb.length, true); out.set(mb, 4);
  let o = 4 + mb.length; for (const b of paths) { out.set(b, o); o += b.length; }
  return new Response(out, { headers: Object.assign({ 'content-type': 'application/octet-stream', 'cache-control': me ? 'private, max-age=60' : 'public, max-age=60' }, cors) });
}
