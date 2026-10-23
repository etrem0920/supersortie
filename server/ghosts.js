// Ghost replays: a daily run's flight path, sampled every 200 ms.
// Only the day's top GHOSTS_PER_DAY runs are kept, and the score always comes from the scores table.
export const GHOSTS_PER_DAY = 20, SAMPLE_S = 0.2, MAX_SAMPLES = 3000, BYTES_PER_SAMPLE = 8;
const MAX_B64 = Math.ceil(MAX_SAMPLES * BYTES_PER_SAMPLE / 3) * 4;

// Returns the sample count, or 0 if the payload is malformed or doesn't match the scored run.
export function checkGhost(data, timeS, score) {
  if (typeof data !== 'string' || data.length > MAX_B64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return 0;
  let bin;
  try { bin = atob(data); } catch (e) { return 0; }
  if (bin.length % BYTES_PER_SAMPLE) return 0;
  const n = bin.length / BYTES_PER_SAMPLE;
  if (n < 20 || n > MAX_SAMPLES) return 0;
  // The recording has to cover the run it claims to be: within 15% (plus a little slack) of the flight time.
  const dur = n * SAMPLE_S;
  if (Math.abs(dur - timeS) > timeS * 0.15 + 3) return 0;
  // Score samples (uint16, in fives) may never go down or end above the posted score.
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const o = i * BYTES_PER_SAMPLE + 6, s = (bin.charCodeAt(o) | (bin.charCodeAt(o + 1) << 8)) * 5;
    if (s < prev || s > score + 5) return 0;
    prev = s;
  }
  return n;
}

export async function postGhost(req, env, json, cors) {
  if (Number(req.headers.get('content-length') || 0) > MAX_B64 + 400) return json({ error: 'too_large' }, 413, cors);
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
  const day = Math.floor(Number(body && body.day)), deviceId = String((body && body.deviceId) || '');
  if (!Number.isFinite(day) || !/^[A-Za-z0-9-]{8,64}$/.test(deviceId)) return json({ error: 'bad_request' }, 400, cors);
  const row = await env.DB.prepare('SELECT score, time_s FROM scores WHERE day = ? AND device_id = ? AND hidden = 0').bind(day, deviceId).first();
  if (!row) return json({ error: 'no_score' }, 404, cors);
  if (!checkGhost(body.data, row.time_s, row.score)) return json({ error: 'bad_ghost' }, 422, cors);
  const above = await env.DB.prepare('SELECT COUNT(*) AS n FROM ghosts WHERE day = ? AND score >= ?').bind(day, row.score).first();
  if (above.n >= GHOSTS_PER_DAY) return json({ ok: true, kept: false }, 200, cors);
  await env.DB.prepare('INSERT INTO ghosts (day, device_id, score, data, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day, device_id) DO NOTHING')
    .bind(day, deviceId, row.score, body.data, Date.now()).run();
  await env.DB.prepare('DELETE FROM ghosts WHERE day = ? AND id NOT IN (SELECT id FROM ghosts WHERE day = ? ORDER BY score DESC, created_at ASC LIMIT ?)').bind(day, day, GHOSTS_PER_DAY).run();
  return json({ ok: true, kept: true }, 201, cors);
}

export async function listGhosts(url, env, json, cors) {
  const day = Math.floor(Number(url.searchParams.get('day')));
  if (!Number.isFinite(day)) return json({ error: 'bad_day' }, 400, cors);
  const rows = (await env.DB.prepare(
    `SELECT g.id, g.score, s.name, s.plane, s.livery, s.theme, a.username FROM ghosts g
     JOIN scores s ON s.day = g.day AND s.device_id = g.device_id AND s.hidden = 0
     LEFT JOIN accounts a ON a.id = s.account_id
     WHERE g.day = ? ORDER BY g.score DESC LIMIT ?`
  ).bind(day, GHOSTS_PER_DAY).all()).results || [];
  return json({ day, ghosts: rows.map(r => ({ id: r.id, score: r.score, name: r.name, plane: r.plane, livery: r.livery, theme: r.theme, u: r.username || undefined })) }, 200, cors, { 'cache-control': 'max-age=60' });
}

export async function getGhost(url, env, json, cors) {
  const day = Math.floor(Number(url.searchParams.get('day'))), id = Math.floor(Number(url.searchParams.get('id')));
  if (!Number.isFinite(day) || !Number.isFinite(id)) return json({ error: 'bad_request' }, 400, cors);
  const r = await env.DB.prepare(
    'SELECT g.id, g.score, g.data, s.name, s.plane, s.livery FROM ghosts g JOIN scores s ON s.day = g.day AND s.device_id = g.device_id AND s.hidden = 0 WHERE g.day = ? AND g.id = ?'
  ).bind(day, id).first();
  if (!r) return json({ error: 'not_found' }, 404, cors);
  return json({ id: r.id, score: r.score, name: r.name, plane: r.plane, livery: r.livery, data: r.data }, 200, cors, { 'cache-control': 'max-age=3600' });
}
