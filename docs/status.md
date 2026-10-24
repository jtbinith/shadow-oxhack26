# Shadow: build status and handover (Sun 25 Oct 2026, ~00:30)

Hacking ends **Sun 12:00**. Repo: github.com/jtbinith/shadow-oxhack26 (private). Board: github.com/users/jtbinith/projects/5 (update with `scripts/board.sh`).

## How to run (local dev)
- Backend: `backend/.venv/bin/uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 7860 --reload --reload-dir backend` (run from repo root so `.env` loads)
- Frontend: `cd frontend && npm run dev -- --port 5173` → **http://127.0.0.1:5173** (proxies /api to 7860)
- Tests: `cd frontend && npx vitest run` (39) · `backend/.venv/bin/python -m pytest -q backend/tests` (23, incl. Playwright browser tests). CI runs both on push.
- Docker build is broken on venue Wi-Fi (BuildKit DNS, issue #49); fix needs `/etc/docker/daemon.json` DNS (user runs with sudo). Docker container is stopped.
- Loopback API testing: start a second uvicorn on 127.0.0.1:7869 with `AUTH_TEST_BYPASS=true`; test data under `user_id='test-user'` — delete afterwards.

## Accounts / keys (all in `.env`, never committed)
Gemini (planning model `gemini-3.5-flash-lite`; 3.8-flash was ~55 s/call), Tiger Data (free, us-east-1, service `shadow`), Clerk (app "Shadow"), ElevenLabs (key `shadow-app`, TTS+voices+models only; Creator plan renews **24 Nov — cancel**), voices: calm = Laura `FGY2WhTYpPnrIDTdsKH5`, hype = Callum `N2lVS1w4EtoT3dr4eOWO`. Not done: Hugging Face token (deploy).

## Built ✅
- **Live tracking** (browser): BlazePose (fast/standard/high = lite/full/heavy) + Hands fused into one skeleton, up to 4 people, tracker (motion + clothing colour + OSNet re-ID in a worker), One Euro smoothing, phantom filter, **focus mode** (crop around the dancer, full scan every 10 frames), dancer lock ("YOU", click to choose), FPS meter.
- **Upload → course** (backend): ffmpeg 30 fps → librosa beats/downbeats/fingerprint → **audio deleted** → MediaPipe pose → **silent video kept** (private, for preview) → normalise (pixels, torso units) → 8-counts, repeats, hits/freezes/**turns**, difficulty → Gemini plan (validated; rules fallback). Style picked at upload.
- **Practice**: count-in + click track, **body-silhouette ghost** (limbs green/amber/red) + **arrow** to the target, **original video beside the camera** (loops / syncs at speed), speeds **0.25–1×**, drills full/freeze/arms/legs/half, mid-rep "lost" stop, scoring = DTW shape + hit timing + dynamics, **6 style profiles** (weights, tau, watched limbs, vocab: dhol/snare/sollukattu), one spoken cue in **body directions** (higher / out wider / in closer — no degrees/ms), detailed notes, worst-count replay.
- **Learning engine** (`backend/app/coach/engine.py`): Elo per 8-count, sweet-spot speed (70–85%), 2 passes → next tier, 3 fails → same-move breakdown, 4 → half drill, spaced repetition.
- **Agents (Gemini tool loops)**: "Tell the coach" re-plan (get_progress / get_habits / get_lesson_plan / update_lesson_plan) and **Ask the coach** mid-practice (data prefetched, `suggest_drill` tool, ~5 s, spoken).
- **Voice**: ElevenLabs via `/api/tts`, cached per line in Tiger Data, rationed; browser voice fallback; persona toggle.
- **Progress page**: streak, XP, steps learnt, rep-by-rep bars, mastery/tiers/reviews, reps-to-learn, habits, "practise weakest step".
- **Rationing**: daily caps (Gemini 300, TTS 20k chars, uploads 40) in `usage` table.
- **AIST++ calibration study**: ran; expert vs wrong-choreo overlap ~29% → placeholders kept (`docs/aist-calibration.md`).

## Not built / honest gaps ❌
- **Error clustering**: "habits" are a SQL group-by of top faults, not clustering; `error_clusters` table unused. **Move clustering / naming**: not built.
- Mic sync to the user's own song (P1), spoken questions (STT), group mode, true 3D mesh ghost, sections, HF deploy.
- No trained correction model (no open dance-correction dataset available tonight; Ego-Exo4D needs ~2-day licence).

## Next (suggested order)
1. User runs the full flow with a real clip **with music** → fix what breaks.
2. Real error clustering (~45 min) → feeds next drill, coach, progress.
3. UI polish. 4. Reference clips (follow `docs/datasets.yaml` own_data_spec), slides, rehearsal, backup video, Devpost.
5. HF deploy if time (needs HF token). 6. Mic sync (riskiest).
