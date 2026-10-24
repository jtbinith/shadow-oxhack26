-- Keep the processed (silent, 30 fps) video for practice previews. Audio is still deleted.
ALTER TABLE routines ADD COLUMN IF NOT EXISTS video bytea;
