-- Routine names are required and unique per user (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS routines_user_title ON routines (user_id, lower(title));
