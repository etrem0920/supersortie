// Server days count from Sortie #1 (Apr 20, 2026) in UTC.
export const EPOCH_UTC = Date.UTC(2026, 3, 20);
export const serverDay = (now = Date.now()) => Math.floor((now - EPOCH_UTC) / 86400000) + 1;
// A pilot's local calendar day, from their timezone offset in minutes (Date#getTimezoneOffset: positive west of UTC).
// Matches the client's day numbers, so "today" on the arena board means the same as it does for the daily.
export const localDay = (now, tz) => (Number.isFinite(tz) && Math.abs(tz) <= 840 ? Math.floor((now - tz * 60000 - EPOCH_UTC) / 86400000) + 1 : serverDay(now));
// A day number a client asked for, if it's one some timezone could be on right now.
export const clientDay = (d, now = Date.now()) => { const sd = serverDay(now), n = Math.floor(Number(d)); return Number.isFinite(n) && Math.abs(n - sd) <= 1 ? n : sd; };
