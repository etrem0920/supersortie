// Name rules shared by accounts, the daily board and the arena.
// A "key" folds a name down to how it reads, so lookalikes (TremDog, tremd0g, trem_dog) collide.
const FOLD = [['_', ''], ['0', 'o'], ['1', 'i'], ['l', 'i'], ['3', 'e'], ['4', 'a'], ['5', 's'], ['7', 't'], ['8', 'b'], ['9', 'g']];
export const nameKey = s => FOLD.reduce((k, [a, b]) => k.split(a).join(b), String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, ''));
// The same fold in SQL, for the index on accounts (usernames only contain [A-Za-z0-9_]).
export const KEY_SQL = FOLD.reduce((e, [a, b]) => `replace(${e}, '${a}', '${b}')`, 'lower(username)');
// Names nobody can register, and guests can't fly under.
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'official', 'supersortie', 'support', 'staff', 'system', 'creator', 'developer', 'dev', 'owner', 'team', 'help', 'server', 'pilot', 'guest'];
const RESERVED_KEYS = new Set(RESERVED.map(nameKey));
export const reservedName = s => RESERVED_KEYS.has(nameKey(s)) || RESERVED_KEYS.has(nameKey(String(s || '').replace(/[\d_ .-]+$/, '')));
// Is this (callsign) name a registered pilot's, or reserved? Guests get turned away from these.
export async function nameTaken(env, name) {
  const k = nameKey(name);
  if (!k) return false;
  if (reservedName(name) && !/^pilot\b/i.test(String(name).trim())) return true;
  return !!(await env.DB.prepare(`SELECT 1 FROM accounts WHERE ${KEY_SQL} = ? LIMIT 1`).bind(k).first());
}
