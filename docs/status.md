# Shadow: build status and handover (Sun 25 Oct 2026, ~00:30)

Hacking ends **Sun 12:00**. Repo: github.com/jtbinith/shadow-oxhack26 (private). Board: github.com/users/jtbinith/projects/5 (update with `scripts/board.sh`).

## How to run (local dev)
- Backend: `backend/.venv/bin/uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 7860 --reload --reload-dir backend` (run from repo root so `.env` loads)
- Frontend: `cd frontend && npm run dev -- --port 5173` → **http://127.0.0.1:5173** (proxies /api to 7860)
- Tests: `cd frontend && npx vitest run` (42) · `backend/.venv/bin/python -m pytest -q backend/tests` (34, incl. Playwright browser tests). CI runs both on push.
- Docker build is broken on venue Wi-Fi (BuildKit DNS, issue #49); fix needs `/etc/docker/daemon.json` DNS (user runs with sudo). Docker container is stopped.
- Loopback API testing: start a second uvicorn on 127.0.0.1:7869 with `AUTH_TEST_BYPASS=true`; test data under `user_id='test-user'` — delete afterwards.

## Accounts / keys (all in `.env`, never committed)
Gemini (planning model `gemini-3.5-flash-lite`; 3.8-flash was ~55 s/call), Tiger Data (free, us-east-1, service `shadow`), Clerk (app "Shadow"), ElevenLabs (key `shadow-app`, TTS+voices+models only; Creator plan renews **24 Nov — cancel**), voices: calm = Laura `FGY2WhTYpPnrIDTdsKH5`, hype = Callum `N2lVS1w4EtoT3dr4eOWO`. Not done: Hugging Face token (deploy).

## Built ✅
- **Live tracking** (browser): BlazePose (fast/standard/high = lite/full/heavy) + Hands fused into one skeleton, up to 4 people, tracker (motion + clothing colour + OSNet re-ID in a worker), One Euro smoothing, phantom filter, **focus mode** (crop around the dancer, full scan every 10 frames), dancer lock ("YOU", click to choose), FPS meter.
- **Upload → course** (backend): ffmpeg 30 fps → librosa beats/downbeats/fingerprint → **audio deleted** → MediaPipe pose → **silent video kept** (private, for preview) → normalise (pixels, torso units) → 8-counts, repeats, hits/freezes/**turns**, difficulty → Gemini plan (validated; rules fallback). Style picked at upload.
- **Practice = continuous flow** (`frontend/src/pages/Practice.tsx`, `frontend/src/coach/live.ts`): the routine video is the clock; you dance straight through from the step to the end (or loop the step). A live detector compares every frame with the routine, allowing a little lag, and pauses only on a sustained mistake (sensitivity: way off / noticeably off / anything). The pause shows the body part, which way to move it, timing (late/early) and speed (too small/slow), plus a you-vs-target snapshot, and freezes the ghost on the target pose with an arrow. Matching the pose for 0.8 s redoes that 8-count automatically and carries on past it. Ask how (typed or spoken; the mistake goes to the coach), redo, or skip ahead. A second stop in the same place slows that 8-count down a notch, then it speeds back up. Every 8-count is recorded as a rep (pass or fail), feeding mastery and habits. Old per-rep drills are replaced.
- **Practice (older notes)**: count-in + click track, **3D ghost** (Three.js mannequin, depth from the reference's 3D world landmarks, lit and shaded; flat-ghost toggle; limbs green/amber/red) + **arrow** to the target, **original video beside the camera** (loops / syncs at speed), speeds **0.25–1×**, drills full/freeze/arms/legs/half, mid-rep "lost" stop, scoring = DTW shape + hit timing + dynamics, **6 style profiles** (weights, tau, watched limbs, vocab: dhol/snare/sollukattu), one spoken cue in **body directions** (higher / out wider / in closer — no degrees/ms), detailed notes, worst-count replay.
- **Learning engine** (`backend/app/coach/engine.py`): Elo per 8-count, sweet-spot speed (70–85%), 2 passes → next tier, 3 fails → same-move breakdown, 4 → half drill, spaced repetition.
- **Agents (Gemini tool loops)**: "Tell the coach" re-plan (get_progress / get_habits / get_lesson_plan / update_lesson_plan) and **Ask the coach** mid-practice (data prefetched, `suggest_drill` tool, ~5 s, spoken).
- **Voice**: ElevenLabs via `/api/tts`, cached per line in Tiger Data, rationed; browser voice fallback; persona toggle.
- **Progress page**: streak, XP, steps learnt, rep-by-rep bars, mastery/tiers/reviews, reps-to-learn, habits, "practise weakest step".
- **Move naming** (`backend/app/pipeline/moves.py`): each count named from pose rules (arms up/out, step left/right, kick, knee up, drop, turn, hit/hold); 8-count summary in the tree, move strip + live caller in practice, fed to the planner. `backend/scripts/backfill_moves.py` names older routines.
- **Mic sync** (`backend/app/pipeline/sync.py`, `POST /api/routines/{id}/sync`, `frontend/src/coach/micsync.ts`): learner plays their own copy of the song; 6 s mic snippet matched against the stored chroma+onset fingerprint (±0.1 s on tests, ~20 ms); count-in scheduled so count 1 lands on the step (or a later repeat). 1× only, no clicks while synced; snippet never stored.
- **Spoken questions**: 🎤 on Ask the coach (browser speech recognition).
- **Error clustering** (`backend/app/coach/clusters.py`): failing reps → k-means (k by silhouette) → labelled habits; drives drills, coach agents, progress, practice banner.
- **Rationing**: daily caps (Gemini 300, TTS 20k chars, uploads 40) in `usage` table.
- **AIST++ calibration study**: ran; expert vs wrong-choreo overlap ~29% → placeholders kept (`docs/aist-calibration.md`).

## Not built / honest gaps ❌
- Move names are rules, not a trained classifier; noisy on fast or side-on footage.
- Mic sync not yet tried with a real speaker + laptop mic (only synthetic tests).
- Group mode, sections, HF deploy.
- No trained correction model (no open dance-correction dataset available tonight; Ego-Exo4D needs ~2-day licence).

## Next (suggested order)
1. User runs the full flow with a real clip **with music** → fix what breaks.
3. UI polish. 4. Reference clips (follow `docs/datasets.yaml` own_data_spec), slides, rehearsal, backup video, Devpost.
5. Try mic sync with the real song on a speaker. 6. HF deploy if time (needs HF token).
