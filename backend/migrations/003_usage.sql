-- Daily usage counters, so free-tier quotas (Gemini calls, ElevenLabs characters, processing) are rationed.
CREATE TABLE IF NOT EXISTS usage (
    day      date NOT NULL DEFAULT current_date,
    user_id  text NOT NULL,          -- '*' = whole app
    kind     text NOT NULL,          -- 'gemini' | 'tts_chars' | 'upload'
    amount   integer NOT NULL DEFAULT 0,
    PRIMARY KEY (day, user_id, kind)
);
