-- Generated coach audio, cached once per (voice, line).
CREATE TABLE IF NOT EXISTS tts_cache (
    key        text PRIMARY KEY,
    voice_id   text NOT NULL,
    text       text NOT NULL,
    audio      bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
