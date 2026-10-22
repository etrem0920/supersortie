// The in-game feedback form. Every message is stored in D1, and also emailed to FEEDBACK_TO when the worker has a
// send_email binding named FEEDBACK_MAIL (Cloudflare Email Routing). Read them with GET /api/v1/admin/feedback.
const KINDS = ['idea', 'bug', 'other'], PER_IP_PER_DAY = 8;

async function sha(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

export async function postFeedback(req, env, json, cors, username) {
  if (Number(req.headers.get('content-length') || 0) > 8000) return json({ error: 'too_large' }, 413, cors);
  let b;
  try { b = await req.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
  const message = clean(b && b.message, 4000), contact = clean(b && b.contact, 120), kind = KINDS.includes(b && b.kind) ? b.kind : 'other';
  if (message.length < 3) return json({ error: 'too_short' }, 422, cors);
  if (b && b.website) return json({ ok: true }, 201, cors); // honeypot field: bots fill it, people never see it
  const day = Math.floor(Date.now() / 86400000), ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const ipHash = (await sha(`${ip}|fb|${day}|${env.IP_SALT || 'dev-salt'}`)).slice(0, 24);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE ip_hash = ? AND created_at > ?').bind(ipHash, Date.now() - 86400000).first();
  if (n && n.n >= PER_IP_PER_DAY) return json({ error: 'rate_limited' }, 429, cors);
  const deviceId = /^[A-Za-z0-9-]{8,64}$/.test(String(b.deviceId || '')) ? b.deviceId : null, page = clean(b.page, 120);
  const res = await env.DB.prepare('INSERT INTO feedback (created_at, kind, message, contact, username, device_id, page, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(Date.now(), kind, message, contact || null, username || null, deviceId, page || null, ipHash).run();
  let emailed = false;
  if (env.FEEDBACK_MAIL && env.FEEDBACK_TO) {
    try {
      const { EmailMessage } = await import('cloudflare:email');
      const from = env.FEEDBACK_FROM || 'feedback@supersortie.io';
      const subject = `Super Sortie ${kind}: ${message.slice(0, 60).replace(/\s+/g, ' ')}`;
      const body = `${message}\n\n---\nFrom: ${username ? username + ' (account)' : 'guest'}${contact ? `\nContact: ${contact}` : ''}\nKind: ${kind}\nPage: ${page || '-'}\nId: ${res.meta.last_row_id}`;
      const raw = [`From: Super Sortie <${from}>`, `To: ${env.FEEDBACK_TO}`, `Subject: ${subject.replace(/[\r\n]/g, ' ')}`, contact && /^[^\s@]+@[^\s@]+$/.test(contact) ? `Reply-To: ${contact}` : null,
        `Message-ID: <fb-${res.meta.last_row_id}-${Date.now()}@supersortie.io>`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body].filter(x => x != null).join('\r\n');
      await env.FEEDBACK_MAIL.send(new EmailMessage(from, env.FEEDBACK_TO, raw));
      emailed = true;
      await env.DB.prepare('UPDATE feedback SET emailed = 1 WHERE id = ?').bind(res.meta.last_row_id).run();
    } catch (e) { /* stored anyway; email is a bonus */ }
  }
  return json({ ok: true, emailed }, 201, cors);
}

export async function listFeedback(url, req, env, json, cors) {
  const auth = req.headers.get('authorization') || '';
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: 'unauthorized' }, 401, cors);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50));
  const rows = (await env.DB.prepare('SELECT id, created_at, kind, message, contact, username, page, emailed FROM feedback ORDER BY created_at DESC LIMIT ?').bind(limit).all()).results || [];
  return json({ feedback: rows }, 200, cors);
}
