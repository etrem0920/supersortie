// Accounts that get the Creator badge. Matched on the account username (unique, case-insensitive),
// so a guest can't get it by typing the same callsign.
export const CREATORS = ['tremdog'];
export const isCreator = username => !!username && CREATORS.includes(String(username).toLowerCase());
