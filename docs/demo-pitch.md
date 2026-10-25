# Shadow: demo pitch

## One line
**Shadow turns any dance video into a personal lesson plan, then coaches you live through your webcam, like a dance teacher watching every rep.**

## The problem
People learn choreography from videos: pause, rewind, slow down, guess. Nobody tells you what's wrong on *this* attempt. Dance games only score their own routines; video players loop but don't watch you; teachers can't watch every rep at home.

## What Shadow does
1. **Upload any dance video** (up to 10 minutes). Shadow finds the beat, cuts the routine into 8-counts (or 4-counts for short clips) and names the moves. If there's no music, it finds the rhythm from the movement itself.
2. **It builds you a lesson plan.** You learn each 8-count on its own, then checkpoints join them up (1–2, then 1–3…) until you can do the whole routine. Each step has bronze, silver and gold medals for passing at 0.5×, 0.75× and full speed.
3. **You practise in one continuous flow.** The original video plays beside your camera, a 3D ghost dancer is laid over you, and your limbs turn green, amber or red as you go.
4. **It only stops you when it matters.** A small slip is ignored; a sustained mistake pauses the flow and shows exactly what to fix ("Right arm, a touch higher. Match the ghost."), freezes the ghost on the target pose, and restarts that 8-count as soon as you hit the pose. Stop twice in the same place and it slows that part down for you.
5. **You can talk to it, hands-free.** "Slower", "again", "show me count 5", "how do I fix my arms?" Simple commands happen instantly; questions go to an AI coach that answers out loud and acts on them.
6. **It learns how you learn.** Every 8-count is a rep. Shadow tracks mastery per phrase, brings moves back for review before you forget them, and spots your habits across all your routines ("your right arm drops on count 3").

## The crows (the brand)
A group of crows is called a **murder**. As your dancing drifts off, crows land one by one above your camera: *"Just a crow…"*, *"An attempted murder…"*, and at the third, **"It's a murder!"**, and the flow stops to show you the fix. Dance well and you'll never see one.

## Demo script (about 3 minutes)
1. **Home:** "Hello. Learn any dance." Upload a clip (or open a ready routine). Show the hopping-crow loading screen while it processes.
2. **Lesson plan:** the 8-count cards with video stills, the checkpoint bar, the medals (ⓘ explains them). Type to the coach: *"I've got two weeks before my show"*, and the plan rewrites itself.
3. **Practice:** press Start. The coach counts you in on the beat ("5, 6, 7, 8"). Dance; the ghost and limb colours follow you.
4. **Make a mistake on purpose:** crows gather: "Just a crow…", "An attempted murder…", "It's a murder!". It pauses, shows the fix, you match the pose, it carries on.
5. **Voice:** say *"slower"* (instant), then *"how do I fix my arms?"* (the coach answers out loud).
6. **My progress:** streak, steps passed, practice over 30 days, habits across routines.

## How it works
- **Upload pipeline (backend, Python/FastAPI):** ffmpeg → beat and downbeat analysis (librosa) → **audio deleted** → pose extraction (MediaPipe) on every frame → skeletons normalised to body size → 8-counts, repeats (learnt once), hits, freezes and turns, difficulty → move names from pose rules → **Gemini** writes the lesson plan (validated, with a rule-based fallback). Only a silent copy of the video is kept, privately, for your side-by-side view.
- **Live coaching (in the browser):** MediaPipe pose runs locally on your webcam, so **video never leaves your device**. A lag-tolerant mistake detector compares each frame with the routine and decides when to stop you. The 3D ghost is Three.js.
- **The AI coach (Gemini):** tool-using agents that read your progress, habits and lesson plan. One re-plans your course; one answers questions mid-practice and returns actions the app runs straight away (change speed, show the pose, redo, skip).
- **Voice (ElevenLabs v4):** one coach voice at a time, with the count-in spoken in the coach's voice and scheduled on the beat. Speech recognition for hands-free commands and live captions.
- **Learning engine:** an Elo-style rating per phrase, the next drill chosen in the "sweet spot" (about 70–85% chance of passing), spaced repetition for reviews, and k-means clustering of missed reps into habits.
- **Data (Tiger Data: TimescaleDB + pgvector on Postgres):** every rep is a time-series row, so progress, streaks and habits are fast queries. Logins via Clerk.

## Sponsors we used, and how
| Sponsor | What it does in Shadow |
|---|---|
| **Google Gemini** (Interactions API) | The coach's brain. **Lesson planning:** reads the routine (counts, repeats, difficulty, move names) and writes the lesson plan as validated structured JSON. **Re-plan agent:** "I have two weeks" → a tool loop (get_progress, get_habits, get_lesson_plan, update_lesson_plan) that rewrites the course and explains why. **Ask the coach:** mid-practice questions get a spoken answer plus *actions* the app runs straight away (speed, strictness, demo, show pose, redo, skip, go to count). Runs with `store=False`, so conversations aren't kept by Google. |
| **ElevenLabs** (Eleven v4) | The coach's voice: two personas (calm Laura, hype Callum), the "5, 6, 7, 8" count-in in the coach's own voice, scheduled with Web Audio so count 1 lands on the beat, and every spoken correction and answer. Each line is cached in the database, so repeats play instantly and cost nothing. |
| **Tiger Data** (TimescaleDB on Postgres) | The one database for everything: users' routines, lesson plans, skeletons, mastery and the TTS cache. Every rep is a row in a **hypertable**, so streaks, practice-per-day, progress and habits are `time_bucket` queries that stay fast as reps pile up. A continuous aggregate (daily progress) and pgvector (a move-library table with an HNSW index) are set up, ready for the trained move library. |
| **Clerk** | Login and per-user data: every API call verifies a Clerk JWT, and all data is scoped to the signed-in user. |

## Architecturally cool bits
- **Video never leaves your device.** Live pose tracking runs in the browser (MediaPipe BlazePose fused with MediaPipe Hands into one skeleton); only scores and rep results go to the server. Uploads keep a silent copy for your preview and **delete the audio** after beat analysis.
- **Multi-person tracking in the browser:** up to 4 people, tracked by motion, clothing colour and an **OSNet re-identification model in a Web Worker**, so Shadow keeps coaching *you* when someone walks past. One Euro filtering smooths jitter; a focus mode crops around you for speed, with a full scan every 10 frames.
- **The video is the clock.** Practice is clocked by the routine video itself, so the ghost, counts, detector and coach all agree on where you are, at any speed from 0.25× to 1×.
- **A lag-tolerant mistake detector.** It compares every frame with the routine but allows you to be slightly behind (like a real dancer following a teacher), and only stops on a *sustained* mistake. Its "pressure" drives the murder meter, so the crows are an honest early warning.
- **Fast path before the AI.** Spoken commands ("slower", "again", "show me count 5") are parsed in the browser and run instantly; only real questions go to Gemini. Bias for action: the coach's reply comes with validated actions, not just words.
- **One voice at a time.** A single voice channel: the count-in waits for the coach to finish, hands-free listening ignores the coach's own voice (echo-safe), and live captions show what you said.
- **The agent decides, the tools measure.** Pose, beats, alignment and scoring are deterministic, tested code; Gemini plans and explains using their results. If Gemini is slow or wrong, a rule-based plan takes over, so the app never breaks.
- **Counts are automatic.** 8-counts, or 4-counts for short clips; with no music, the beat grid comes from the dancer's movement instead.
- **A real learning engine:** Elo-style mastery per phrase, a "sweet spot" difficulty (about 70–85% chance of passing), spaced repetition, and **k-means clustering** (k chosen by silhouette score) to find your habits across routines.
- **Cheap to run:** daily caps on Gemini calls, TTS characters and uploads, plus the voice cache.
- **Tested:** 57 frontend tests and backend tests including Playwright browser tests, run in CI on every push.

## Why it's different
- **Any video**, not a fixed library.
- **A coach, not a scoreboard:** one specific correction at a time, in plain body directions, only when it matters.
- **Adaptive:** it slows down where you struggle and brings back what you're forgetting.
- **Private by design:** live video stays in your browser; the song's audio is deleted after processing.

## Honest limits
- Move names come from pose rules, not a trained model, so they're rough on fast or side-on footage.
- Works best with one dancer, full body in frame, front-on, good light.
- Score thresholds are hand-tuned (our calibration study on AIST++ wasn't conclusive yet).
