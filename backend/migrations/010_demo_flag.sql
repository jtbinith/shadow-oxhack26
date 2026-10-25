-- Seeded demo routines are flagged so they can be removed without touching real ones.
ALTER TABLE routines ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
UPDATE routines SET is_demo = true, title = substring(title FROM 8) WHERE title LIKE 'Demo · %';
