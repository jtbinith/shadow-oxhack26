-- Error clusters are per routine (habits on one routine aren't the same as on another).
ALTER TABLE error_clusters ADD COLUMN IF NOT EXISTS routine_id uuid REFERENCES routines(id) ON DELETE CASCADE;
ALTER TABLE error_clusters ADD COLUMN IF NOT EXISTS share real;
ALTER TABLE error_clusters ADD COLUMN IF NOT EXISTS fault jsonb;
ALTER TABLE error_clusters DROP CONSTRAINT IF EXISTS error_clusters_pkey;
DELETE FROM error_clusters;
ALTER TABLE error_clusters ADD PRIMARY KEY (user_id, routine_id, cluster_id);
