// Server days count from Sortie #1 (Apr 20, 2026) in UTC.
export const EPOCH_UTC = Date.UTC(2026, 3, 20);
export const serverDay = (now = Date.now()) => Math.floor((now - EPOCH_UTC) / 86400000) + 1;
