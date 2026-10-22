// The Daily Elite livery belongs to pilots in the top 10% of a recent daily leaderboard.
// Arena and co-op check it here before showing it to anyone else.
import { serverDay } from './day.js';

export const ELITE_LIVERY = 12;

export async function eliteOk(env, device, account) {
  if (!env || !env.DB || (!device && !account)) return false;
  const sd = serverDay();
  for (const day of [sd + 1, sd, sd - 1]) {
    const mine = await env.DB.prepare('SELECT MAX(score) AS score FROM scores WHERE day = ? AND hidden = 0 AND (device_id = ? OR account_id = ?)')
      .bind(day, device || '', account || -1).first();
    if (!mine || mine.score == null) continue;
    const above = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ? AND hidden = 0 AND score > ?').bind(day, mine.score).first();
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ? AND hidden = 0').bind(day).first();
    return above.n + 1 <= Math.max(1, Math.ceil(total.n * 0.1));
  }
  return false;
}
