-- Processing progress and errors for uploads.
ALTER TABLE routines ADD COLUMN IF NOT EXISTS stages jsonb NOT NULL DEFAULT '[]';
ALTER TABLE routines ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE routines ADD COLUMN IF NOT EXISTS duration_s real;
ALTER TABLE routines ADD COLUMN IF NOT EXISTS beat_source text;
