from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = ""
    gemini_api_key: str = ""
    gemini_model_fast: str = "gemini-3.8-flash"
    gemini_model_strong: str = "gemini-4-argon"
    # Coach voice: Kokoro-82M (open source, runs on CPU in the same container).
    tts_backend: str = "kokoro"
    tts_voice_calm: str = "af_heart"
    tts_voice_hype: str = "am_puck"
    clerk_publishable_key: str = ""
    clerk_secret_key: str = ""
    # Off unless explicitly set; lets local tests run without Clerk.
    auth_test_bypass: bool = False
    # "local" = temp files deleted after processing (Hugging Face); "s3" = Vultr Object Storage.
    storage_backend: str = "local"
    max_upload_mb: int = 200
    # Daily rationing of free-tier quotas (per user / whole app). Tune in .env.
    limit_gemini_per_user: int = 30
    limit_gemini_total: int = 300
    limit_tts_chars_per_user: int = 3000
    limit_tts_chars_total: int = 20000
    limit_uploads_per_user: int = 5
    limit_uploads_total: int = 40
    static_dir: str = "/app/static"


settings = Settings()
