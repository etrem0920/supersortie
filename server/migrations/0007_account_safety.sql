-- Recovery codes (the only way back in without email) and an index for lookalike-name checks.
ALTER TABLE accounts ADD COLUMN recovery_hash TEXT;
CREATE INDEX IF NOT EXISTS accounts_name_key ON accounts (replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(username), '_', ''), '0', 'o'), '1', 'i'), 'l', 'i'), '3', 'e'), '4', 'a'), '5', 's'), '7', 't'), '8', 'b'), '9', 'g'));
