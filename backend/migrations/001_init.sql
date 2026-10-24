-- Shadow initial schema. Run once: tiger db query -f backend/migrations/001_init.sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;

-- A routine modelled from one upload. No audio or video is stored:
-- only the beat grid, a coarse music fingerprint and normalised skeletons.
CREATE TABLE routines (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       text NOT NULL,
    title         text NOT NULL,
    style         text NOT NULL DEFAULT 'general',
    tempo_bpm     real,
    beats         real[] NOT NULL DEFAULT '{}',
    downbeats     real[] NOT NULL DEFAULT '{}',
    fingerprint   bytea,                 -- chroma + onset features for mic sync
    lesson_plan   jsonb NOT NULL DEFAULT '{}',
    status        text NOT NULL DEFAULT 'processing',
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON routines (user_id, created_at DESC);

CREATE TABLE eight_counts (
    routine_id    uuid NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    idx           int  NOT NULL,
    start_s       real NOT NULL,
    end_s         real NOT NULL,
    count_times   real[] NOT NULL,
    repeat_of     int,
    key_moments   jsonb NOT NULL DEFAULT '[]',
    difficulty    real,
    reference     bytea NOT NULL,        -- normalised per-frame features (npz)
    PRIMARY KEY (routine_id, idx)
);

-- Move library: segments from routines and from AIST++, for naming.
CREATE TABLE moves (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source        text NOT NULL,         -- 'aist' | 'routine'
    routine_id    uuid REFERENCES routines(id) ON DELETE CASCADE,
    eight_count   int,
    counts        int[] NOT NULL DEFAULT '{}',
    name          text,
    name_source   text,                  -- 'library' | 'gemini' | 'user'
    confidence    real,
    embedding     vector(256)
);
CREATE INDEX ON moves USING hnsw (embedding vector_cosine_ops);

-- Learning engine state.
CREATE TABLE mastery (
    user_id       text NOT NULL,
    move_id       uuid NOT NULL REFERENCES moves(id) ON DELETE CASCADE,
    rating        real NOT NULL DEFAULT 1000,
    reps          int  NOT NULL DEFAULT 0,
    best_speed    real NOT NULL DEFAULT 0,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, move_id)
);

CREATE TABLE reviews (
    user_id       text NOT NULL,
    move_id       uuid NOT NULL REFERENCES moves(id) ON DELETE CASCADE,
    stability     real NOT NULL,
    difficulty    real NOT NULL,
    due_at        timestamptz NOT NULL,
    last_review   timestamptz,
    PRIMARY KEY (user_id, move_id)
);
CREATE INDEX ON reviews (user_id, due_at);

CREATE TABLE error_clusters (
    user_id       text NOT NULL,
    cluster_id    int  NOT NULL,
    label         text NOT NULL,         -- e.g. "elbow drops on turns"
    body_part     text,
    count         int  NOT NULL,
    centroid      real[] NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, cluster_id)
);

CREATE TABLE sessions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       text NOT NULL,
    routine_id    uuid NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    mode          text NOT NULL DEFAULT 'learn',
    started_at    timestamptz NOT NULL DEFAULT now(),
    ended_at      timestamptz
);

-- One row per scored rep: the core time series.
CREATE TABLE rep_scores (
    time          timestamptz NOT NULL DEFAULT now(),
    user_id       text NOT NULL,
    session_id    uuid NOT NULL,
    routine_id    uuid NOT NULL,
    eight_counts  int[] NOT NULL,
    drill         text NOT NULL DEFAULT 'full',   -- full | freeze | legs | arms
    speed         real NOT NULL,
    similarity    real NOT NULL,
    shape         real,
    timing        real,
    dynamics      real,
    per_count     real[],
    timing_bias_ms   real,
    timing_jitter_ms real,
    passed        boolean NOT NULL,
    top_fault     jsonb
);
SELECT create_hypertable('rep_scores', 'time');
CREATE INDEX ON rep_scores (user_id, routine_id, time DESC);

-- Daily progress per user and routine, for the progress page.
CREATE MATERIALIZED VIEW daily_progress WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', time) AS day,
       user_id,
       routine_id,
       avg(similarity)              AS avg_score,
       max(similarity)              AS best_score,
       avg(timing_bias_ms)          AS avg_timing_bias_ms,
       count(*)                     AS reps,
       count(*) FILTER (WHERE passed) AS passed_reps
FROM rep_scores
GROUP BY day, user_id, routine_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('daily_progress',
    start_offset => INTERVAL '30 days',
    end_offset   => NULL,
    schedule_interval => INTERVAL '5 minutes');
