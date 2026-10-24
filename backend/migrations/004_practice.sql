-- Practice: per-8-count mastery (Elo) and spaced-repetition schedule for each learner.
CREATE TABLE IF NOT EXISTS ec_mastery (
    user_id     text NOT NULL,
    routine_id  uuid NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    idx         int  NOT NULL,
    rating      real NOT NULL DEFAULT 1000,
    reps        int  NOT NULL DEFAULT 0,
    passes      int  NOT NULL DEFAULT 0,
    best_speed  real NOT NULL DEFAULT 0,
    stability   real NOT NULL DEFAULT 0.5,   -- days until the next review
    due_at      timestamptz,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, routine_id, idx)
);
ALTER TABLE rep_scores ADD COLUMN IF NOT EXISTS step_index int;
