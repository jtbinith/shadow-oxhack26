-- Named moves per count ("Step right", "Arms up (hit)") and a short summary per 8-count.
ALTER TABLE eight_counts ADD COLUMN IF NOT EXISTS moves jsonb;
ALTER TABLE eight_counts ADD COLUMN IF NOT EXISTS name text;
