import os

# Tests never touch the real database or Clerk: blank them before the app imports its settings.
for key in ("DATABASE_URL", "CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"):
    os.environ[key] = ""
os.environ.pop("AUTH_TEST_BYPASS", None)
os.environ["STATIC_DIR"] = "/nonexistent"
