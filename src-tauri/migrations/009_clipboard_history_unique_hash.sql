DELETE FROM clipboard_history
WHERE rowid NOT IN (
  SELECT MAX(rowid) FROM clipboard_history GROUP BY content_hash
);

DROP INDEX IF EXISTS idx_clipboard_history_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clipboard_history_hash_unique
  ON clipboard_history (content_hash);
