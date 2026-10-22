// Weekly leagues. Weeks run Monday to Sunday (UTC). The first daily a pilot flies in a week
// puts them in a group of up to 30 in their division; their league score is the sum of their
// daily scores that week. When the week ends, the top 5 of each group move up a division and
// the bottom 5 move down (worked out lazily, the next time the pilot flies).
//
//   GET /api/v1/league?deviceId=…   this week's group, plus how last week ended

import { serverDay } from './day.js';

export const DIVISIONS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ace'];
export const GROUP_SIZE = 30, MOVE = 5;
export const weekOf = day => Math.floor((day - 1) / 7) + 1;
const weekDays = w => [(w - 1) * 7 + 1, w * 7];

// Final standings of one group, best first.
async function standings(env, week, division, grp) {
  const [d0, d1] = weekDays(week);
  const rows = (await env.DB.prepare(
    `SELECT m.device_id AS device, m.account_id AS acct, COALESCE(SUM(s.score), 0) AS total, COUNT(s.score) AS days,
            (SELECT s2.name FROM scores s2 WHERE s2.device_id = m.device_id ORDER BY s2.day DESC LIMIT 1) AS name,
            a.username AS u
       FROM league_members m
       LEFT JOIN scores s ON s.device_id = m.device_id AND s.day BETWEEN ? AND ? AND s.hidden = 0
       LEFT JOIN accounts a ON a.id = m.account_id
      WHERE m.week = ? AND m.division = ? AND m.grp = ?
      GROUP BY m.device_id ORDER BY total DESC, m.joined_at ASC`
  ).bind(d0, d1, week, division, grp).all()).results || [];
  return rows;
}

// Where last week left this pilot: promoted, relegated or staying put.
export async function lastWeekResult(env, device, week) {
  const prev = await env.DB.prepare('SELECT division, grp FROM league_members WHERE week = ? AND device_id = ?').bind(week - 1, device).first();
  if (!prev) return null;
  const rows = await standings(env, week - 1, prev.division, prev.grp);
  const rank = rows.findIndex(r => r.device === device) + 1;
  let division = prev.division, moved = 'stay';
  if (rank > 0 && rank <= MOVE && rows.length > MOVE && division < DIVISIONS.length - 1) { division++; moved = 'up'; }
  else if (rank > 0 && rows.length >= MOVE * 3 && rank > rows.length - MOVE && division > 0) { division--; moved = 'down'; }
  return { week: week - 1, from: prev.division, division, moved, rank, size: rows.length };
}

// Called after every accepted daily score.
export async function joinLeague(env, device, accountId, day) {
  const week = weekOf(day);
  const have = await env.DB.prepare('SELECT 1 FROM league_members WHERE week = ? AND device_id = ?').bind(week, device).first();
  if (have) return;
  const last = await lastWeekResult(env, device, week);
  let division = last ? last.division : 0;
  if (!last) {
    const older = await env.DB.prepare('SELECT division FROM league_members WHERE device_id = ? ORDER BY week DESC LIMIT 1').bind(device).first();
    if (older) division = older.division;
  }
  const open = await env.DB.prepare('SELECT grp, COUNT(*) AS n FROM league_members WHERE week = ? AND division = ? GROUP BY grp HAVING n < ? ORDER BY grp LIMIT 1').bind(week, division, GROUP_SIZE).first();
  let grp = open ? open.grp : null;
  if (grp == null) { const mx = await env.DB.prepare('SELECT MAX(grp) AS g FROM league_members WHERE week = ? AND division = ?').bind(week, division).first(); grp = (mx && mx.g != null ? mx.g : 0) + 1; }
  await env.DB.prepare('INSERT INTO league_members (week, device_id, account_id, division, grp, joined_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(week, device, accountId || null, division, grp, Date.now()).run();
}

export async function leagueView(env, device) {
  const day = serverDay(), week = weekOf(day);
  const [, d1] = weekDays(week);
  const endsIn = (d1 - day + 1) * 86400000 - ((Date.now() - Date.UTC(2026, 3, 20)) % 86400000);
  const me = await env.DB.prepare('SELECT division, grp FROM league_members WHERE week = ? AND device_id = ?').bind(week, device).first();
  const last = await lastWeekResult(env, device, week);
  if (!me) return { week, endsIn, joined: false, divisions: DIVISIONS, last, division: last ? last.division : 0 };
  const rows = await standings(env, week, me.division, me.grp);
  return {
    week, endsIn, joined: true, divisions: DIVISIONS, division: me.division, last, move: MOVE,
    entries: rows.map((r, i) => ({ rank: i + 1, name: r.name || 'Pilot', u: r.u || undefined, total: r.total, days: r.days, me: r.device === device })),
  };
}
