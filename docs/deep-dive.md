# Shadow: how it works (deep dive)

This explains what each part of Shadow does and why, so anyone can answer questions at the demo.
**✅ Built** = working now. **🛠 Planned** = designed, not built yet. Updated as things land.

---

## 1. The big picture

```
 Browser (your laptop)                         Server (Docker image)                 Cloud services
 ─────────────────────                         ─────────────────────                 ──────────────
 Webcam ─► MediaPipe pose + hands  ✅          FastAPI backend  ✅                   Clerk (login)  ✅
          ─► tracker (who is who)   ✅          ├─ /api/health, /api/config  ✅      Tiger Data (database)  ✅
          ─► smoothing              ✅          ├─ login check on every route ✅     Gemini (agent)  🛠
          ─► hands fused into body  ✅          ├─ upload + processing  🛠           ElevenLabs (voice)  🛠
          ─► drawn on screen        ✅          ├─ scoring + learning engine  🛠
                                                └─ serves the React app  ✅
```

- **Everything heavy about the live camera runs in the browser.** Video never leaves your laptop during practice; only numbers (keypoints) would.
- **The server** handles login checks, uploads, scoring and the database.
- **One Docker image** runs the whole server. The same image runs on your laptop, on a Hugging Face Space, or on a Vultr server later.

---

## 2. Live tracking in the browser ✅

File: `frontend/src/pose/PoseCam.tsx`, with helpers `tracker.ts`, `smoothing.ts`, `appearance.ts`.

Every new camera frame goes through five steps.

### Step 1: Two AI models find the people and hands
| Model | What it finds | Points |
|---|---|---|
| **MediaPipe Pose Landmarker (full)** | Each person's body: face, shoulders, elbows, wrists, hips, knees, ankles, feet | 33 per person, up to **4 people** |
| **MediaPipe Hand Landmarker** | Each hand: wrist, palm knuckles and every finger joint | 21 per hand, up to 8 hands |

- Both are Google models that run **in the browser on the graphics card** (WebGL), so no video is sent anywhere.
- We use the **full** pose model (not "lite") for better accuracy on elbows, knees and feet.
- The models only run when the camera delivers a **new** frame. Running twice on the same frame made the points jitter.
- Points come back as x and y between 0 and 1 (fractions of the image), plus a depth estimate (z) and, for the body, a confidence score ("visibility").

### What kind of tracking is this? (not SIFT or SLAM)
- **SIFT** matches hand-crafted image features between pictures; **SLAM** works out where a *camera* is while building a map of the room. Shadow uses neither.
- Shadow uses **tracking-by-detection**: deep-learning models **detect** people and their keypoints in every frame, and our tracker **links** the detections over time into identities.
  - **Detection:** MediaPipe **BlazePose** (a CNN that finds people, then regresses 33 keypoints, re-using the last frame's pose to crop the next) and MediaPipe **Hands** (palm detector + 21-point hand model).
  - **Linking:** motion prediction + cost-based matching + **OSNet** deep re-ID fingerprints (+ clothing colour as a fallback). This is a simplified version of **DeepSORT/StrongSORT**, the standard multi-person trackers.
- Detections that aren't plausible people (no shoulders, a "person" found in a chair) are dropped before tracking.

### Focus mode (default on)
The pose model runs once per person, so three people made it ~3× slower. In focus mode:
- **Most frames:** a second, single-person pose model looks only at a **crop around the dancer** (a box 1.6× their size, scaled to 512 px). It's faster, and the dancer appears bigger to the model, so their points are more precise, including further from the camera.
- **Every 10th frame**, or whenever the dancer leaves the crop: a **full-frame scan** of everyone, which updates other people's identities. Between scans, others are drawn **dimmed** from the last scan.
- The FPS meter shows `focus` or `full` for each frame. Turn it off with **Focus: off**.

### Step 2: The tracker decides who is who
MediaPipe returns people in a random order each frame. Without tracking, colours jumped between people. The tracker (`tracker.ts`) gives each person a **stable ID**:

1. For every person it already knows, it **predicts** where they'll be now from their recent speed and direction.
2. It scores every pairing of "known person" and "newly detected body":
   - **distance** from the prediction, measured in *torso lengths* (so it works whether you're near or far from the camera);
   - **change in size** (someone stepping towards the camera gets bigger gradually, not suddenly);
   - **clothing colour difference** (see step 3).
3. It pairs them **cheapest first**. A detection with no good match is either a **returning** person or a **new** one.
4. A person keeps their ID for **1.5 seconds** after disappearing (brief occlusion, camera shake), and is **remembered for 15 seconds**. If they return and their clothing matches (similarity ≥ 0.7), or they reappear near where they left within 3 seconds, they get their ID and colour back.
5. New people take the lowest number that is neither in use nor reserved for someone who just left, so colours are predictable (**orange, pink, green, purple**) and a newcomer doesn't steal a returning person's colour.

**Prediction:** the tracker predicts each person's next position from their smoothed speed and direction (a constant-velocity guess, capped at half a second ahead). It's only used to match people between frames; it doesn't predict dance moves.

### Step 3: Clothing-colour fingerprint (appearance matching)
File: `appearance.ts`.

- Each frame, a small copy of the image (192×108 pixels) is taken.
- For each person, we sample the pixels inside their **torso** (shoulders to hips) and **upper legs** (hips to knees). If the hips are hidden (sitting behind a table, close to the camera), we sample a **chest box** below the shoulders instead.
- Each pixel is converted to **hue, saturation and brightness** and counted into a histogram of 108 colour "buckets". This is the person's colour fingerprint.
- Two fingerprints are compared with the **Bhattacharyya coefficient**: 1 = identical colours, 0 = nothing in common.
- A person's stored fingerprint is **blended slowly** (10% new each frame) so it adapts to lighting changes and turning around.
- Limit: two people in very similar clothes (e.g. both in black) are told apart by position only.

### Step 4: Smoothing (One Euro filter)
File: `smoothing.ts`.

Raw points shake slightly from frame to frame. We smooth **every point of every person** with a **One Euro filter**, the standard filter for this:
- When a point moves **slowly**, it smooths **heavily**, so jitter disappears.
- When a point moves **fast**, it smooths **lightly**, so it keeps up with the dance move with almost no lag.
- Settings: body `minCutoff 1.7, beta 0.3`; fingers `minCutoff 2.0, beta 0.6`. A higher beta means less lag on fast movement; fingers get the most responsive setting because they move fastest.

Also:
- If a body point's confidence drops below 0.5, its **last good position is held for 250 ms** instead of flickering. After that it is hidden rather than drawn in the wrong place.
- The hand model gives every point a confidence of 0 (it has no such score), so for hands the confidence check is skipped. *That was bug #39.*

### Step 5: Fuse hands into the body
- Each hand is attached to the person whose **wrist is closest** to it, but only if it's within **0.6 torso lengths** of that wrist. Hands whose body wasn't found (someone at the edge of the frame) are drawn in neutral grey instead of being given to the wrong person.
- The pose model's body only has 3 rough points per hand. When a real hand is detected, its **precise wrist replaces the body's wrist**, and its **21 points replace the 3 rough ones**.
- Result: one continuous skeleton per person, **33 body points + 21 per hand**, drawn in that person's colour.

What leaves this component for scoring later: per person, `{ id, body: 33 points, hands: [{ side, 21 points }] }`.

---

## 3. Login and security ✅

### How login works (Clerk)
1. The browser asks the server for `/api/config`, which returns **only the public Clerk key**. This lets one build of the app work on any host.
2. Clerk shows the sign-in screen (email or Google) and gives the browser a **session token**, a signed JWT that expires quickly.
3. Every API call sends that token: `Authorization: Bearer <token>`.
4. The server (`backend/app/auth.py`) **verifies the token's signature** against Clerk's public keys (downloaded from Clerk's JWKS address), and checks it hasn't expired and was issued by our Clerk app.
5. If valid, the request runs as that user. The top line "API: user_…" proves this whole chain works.

### Safety defaults
- **Fails closed:** if Clerk isn't configured, every protected route **refuses** requests. Nothing is ever open by accident. Anonymous calls get **401**.
- A test bypass exists for development only, and it is **off unless explicitly turned on** (`AUTH_TEST_BYPASS`).
- **Secret keys never reach the browser.** They live in `.env` (never committed to git, readable only by the owner) and later in Hugging Face's secret store.
- Locally, Docker publishes the app on **127.0.0.1 only**, so nobody on the venue Wi-Fi can reach it.

---

## 4. The server ✅ (partly)

File: `backend/app/main.py`.

| Route | What it does | Status |
|---|---|---|
| `GET /api/health` | Says the server is up and whether the database is connected | ✅ |
| `GET /api/config` | Public settings for the browser (just the Clerk public key) | ✅ |
| `GET /api/me` | Returns your user ID; proves login works | ✅ |
| `/` | Serves the built React app | ✅ |
| Upload, routines, sessions, live scoring | | 🛠 |

- **FastAPI** (Python) with a small connection pool to the database (`db.py`).
- Settings come from environment variables (`config.py`), so the same code runs everywhere.

---

## 5. The database (Tiger Data) ✅

Tiger Data is **PostgreSQL with TimescaleDB** (fast time-series) and **pgvector** (similarity search). Free plan, US East region.
Schema: `backend/migrations/001_init.sql`.

| Table | Holds |
|---|---|
| `routines` | One per uploaded video: tempo, beat times, music fingerprint, lesson plan. **No audio or video** |
| `eight_counts` | Each 8-count: timing, repeats, key moments, difficulty, the reference skeleton |
| `moves` | Named moves (from routines and AIST++), with a **vector** for similarity search |
| `mastery` | Your skill rating per move (Elo) |
| `reviews` | When each move is next due for review (spaced repetition) |
| `error_clusters` | Your recurring mistakes ("elbow drops on turns") |
| `sessions` | Each practice session |
| `rep_scores` | **Every rep you do**, stored as a time series (a TimescaleDB *hypertable*) |
| `daily_progress` | A **continuous aggregate**: daily average and best score, reps and passes, kept up to date automatically for the progress page |

---

## 6. Running and deploying

- **Locally:** `docker compose up -d --build`, then open http://127.0.0.1:7860.
- **The Docker image:** stage 1 builds the React app with Node; stage 2 is Python with ffmpeg (video) and espeak-ng (for the Kokoro voice fallback), and serves everything on port 7860.
- **Venue Wi-Fi gotcha:** eduroam blocks Docker's default DNS, so the container couldn't reach Clerk or the database (*bug #35*). A local, uncommitted `docker-compose.override.yml` points it at the Wi-Fi's own DNS servers.
- **Hugging Face Space** 🛠: the same image, with HTTPS provided by Hugging Face and keys stored as Space secrets.
- **Vultr** (optional later): `deploy/vultr/` puts the same image behind **Caddy**, which gets HTTPS certificates automatically, with only ports 80 and 443 open.

---

## 7. Upload → course and the practice loop ✅ (as built)

**Upload → course** (`backend/app/pipeline/`): ffmpeg → 30 fps silent video + mono audio → librosa beats, downbeats (the bar phase with the strongest onsets) and a chroma/onset fingerprint → **audio deleted** → MediaPipe pose (same model as the browser) → **silent video kept** (private, for the side-by-side preview) → skeletons normalised in pixels (centred on the hips, torso = 1) → 8-counts, repeats (bone-direction signatures compared), hits/freezes, difficulty → **Gemini 3.5 Flash-Lite** writes the lesson plan from the curriculum playbook (~3 s), validated; a fixed chaining plan if Gemini fails or the daily cap is reached.

**Practice** (`frontend/src/pages/Practice.tsx`, `coach/score.ts`): count-in "5, 6, 7, 8" + click track at the routine's tempo × speed → the **ghost** (reference pose for that moment, scaled to your torso and pinned to your hips; each limb green/amber/red by angle error) → at the end, **scoring**: DTW over limb directions (limbs weighted over torso) for shape, hit timing within ±250 ms, a score per count → the **top fault** becomes **one cue** ("Right arm higher on 6.") → replay of your worst count beside the reference.

**Learning engine** (`backend/app/coach/engine.py`): each rep updates an **Elo rating** per 8-count; the next drill is the speed with a 70–85% predicted pass chance; two passes in a row → next tier; three fails → **teach the same move** (arms only / legs only / key-pose freezes / slow down for timing); passes push the **review date** out (spaced repetition). Progress page: streak, XP, steps learnt, rep-by-rep scores, mastery and tiers, reps to learn, habits.

**Voice:** cues and coach answers use ElevenLabs (cached per line, rationed); the count-in uses the local voice so it lands on the beat.

**Corrections are body directions, not numbers:** the fault's direction comes from geometry — where your limb points vs where the routine's points, relative to *your* body (higher / lower, out wider / in closer) — so cues say "Right arm a touch higher on 6", never degrees or milliseconds.

**Agents:** "Tell the coach" (re-plan) and "Ask the coach" (mid-practice questions) are Gemini tool-use loops over your real reps and habits; the scoring itself stays deterministic.

**Error clustering:** each missed rep becomes a vector (fault type, limb, direction, where in the 8-count); k-means with the number of groups picked by silhouette score turns them into **habits** like "Left arm too low around counts 3–4". Habits pick the breakdown drill, feed both agents, and show on the progress page. *Move* clustering/naming is not built.

## 8. Still planned 🛠

### Upload → course
1. ffmpeg converts the video to 30 fps.
2. **Beat This!** finds beats and downbeats → counts grid (two bars of 4/4 = one 8-count). A coarse music fingerprint (chroma + onset) is saved. **Then the audio is deleted.**
3. **RTMW whole-body** pose (body + hands, like the live side) runs on each frame. **Then the frames are deleted.**
4. Skeletons are normalised: centred on the hips, scaled by torso length (fair for any body size), mirrored.
5. The routine is cut into 8-counts; repeats are found by comparing 8-counts with each other; key moments (hits, freezes, turns) are detected from speed.
6. The **Gemini agent** builds the lesson tree with **chaining** (A, B, A+B, C, A+B+C) and a speed ladder (0.5×, 0.75×, 1×).

### Scoring a rep
- **DTW (dynamic time warping)** lines up your movement with the reference even if you're slightly early or late, so being late isn't also counted as the wrong shape.
- Three scores: **shape** (angles of your limbs vs the reference), **timing** (do your hits land on the beat), **dynamics** (sharp vs smooth where it should be).
- The single biggest fault becomes **one spoken cue**.

### The learning engine
- **Elo rating** per move: predicts your chance of passing a drill.
- **Sweet spot:** the next drill is one you have a 70–85% chance of passing.
- **Spaced repetition:** moves come back for review before you forget them; your rep score acts as the "how well did I remember" grade.
- **Error clustering:** groups your mistakes into habits; if you keep failing a move, the coach **teaches that move** (key-pose freezes at 0.25×, legs only, arms only, then back up to speed).

### Voice
**ElevenLabs** voices (calm and hype), with every cue generated once and cached so it plays instantly; **Kokoro** (open source, runs on the server) as automatic fallback.

### P1 extras
- **Mic sync (built):** you play your own copy of the song; the app records 6 s through the mic, the server slides it along the stored fingerprint (12 chroma bins + onset strength, 10 per second; mean-centred chroma cosine 70% + onset correlation 30%) and returns where the song is. Confidence = how far the best match beats the next best one at least 1.5 s away. The count-in is then scheduled so count 1 lands on the step (or a later repeat). The snippet is never stored. Works at 1× only.
- **Move naming (built):** rules over the normalised skeleton on each count: wrist vs shoulder height → arms up / out; stance width change vs leg length → step left / right / feet together; knee above hip line → knee up, with the foot high too → kick; both feet near the hips → drop; plus turns/hits/freezes from segmentation. Shown per count and as a live caller during the rep.
- **AIST++ calibration:** the same choreography danced by different experts tells us what a "good" score looks like, so 80 means the same in every routine. A labelled move library names moves.

---

## 9. Glossary

| Term | Plain meaning |
|---|---|
| **Keypoint / landmark** | One tracked point on the body, like "left elbow" |
| **Skeleton** | All of one person's keypoints joined by lines |
| **MediaPipe** | Google's library of small AI models that run in the browser |
| **Tracker / re-identification** | Keeping the same ID on the same person over time / recognising them when they return |
| **Histogram** | A count of how many pixels fall into each colour bucket |
| **One Euro filter** | Smoothing that's strong when still and light when moving fast |
| **JWT** | A signed, expiring token that proves who you are |
| **JWKS** | The public keys used to check a JWT's signature |
| **Fail closed** | When something isn't set up, refuse access rather than allow it |
| **Hypertable / continuous aggregate** | TimescaleDB's fast time-series table / a summary table that updates itself |
| **pgvector** | Postgres extension for "find the most similar" searches |
| **DTW** | Lines up two movements that happen at slightly different speeds |
| **Elo** | The chess rating system, used here for move difficulty and your skill |
| **Spaced repetition** | Reviewing things just before you'd forget them (as in Duolingo or Anki) |

---

## 10. Likely questions at the demo

**"Is my video uploaded?"** During practice, never: tracking runs in your browser. For an uploaded routine, the audio is deleted after the beats are measured; a silent copy of the video is kept, private to you, only for the practice preview, and it's deleted with the routine.

**"How does it know who is who?"** A tracker predicts where each person will be, and checks position, size and clothing colour. It remembers people for 10 seconds if they leave.

**"Why not just use one model for everything?"** The body model only has 3 rough points per hand, so we run a dedicated hand model too and fuse the two into one skeleton.

**"Why is the skeleton smooth but not laggy?"** The One Euro filter smooths heavily only when you're still; when you move fast it barely smooths at all.

**"Is it secure?"** Login is required for every API call, tokens are verified against Clerk's public keys, secret keys never reach the browser, and anything not configured refuses access.

**"What about copyright?"** Uploaded audio is deleted after the beats are measured; Shadow never stores or plays the song. The preview video is silent. You play your own copy, or practise to a click track.

**"What happens with several dancers?"** It tracks up to 4 people now; scoring follows the main dancer. Group mode (who's early or late on each count) is next.


## 3D ghost
`frontend/src/coach/ghost3d.ts`. A Three.js mannequin (cylinders + joint balls, a tapered torso oriented by the shoulder and hip lines, head and feet) drawn on a transparent WebGL canvas over the camera. x/y come from the same 2D reference points as the flat ghost, so it sits on the learner exactly as before; depth comes from MediaPipe's 3D world landmarks for that frame, scaled so the 3D torso matches the 2D torso. An orthographic camera in canvas pixels keeps the projection identical, so the 3D adds shading, thickness and limbs passing in front of or behind the body. Limbs keep the green/amber/red closeness colours. Falls back to the flat ghost without WebGL; toggle in the practice header.

## Continuous flow (practice)
Practice is one continuous run, not separate 8-count reps. The uploaded (silent) video is the master clock (`video.currentTime`), so the video, ghost and scoring can't drift apart. Speed = the video's playback rate.

**Mistake detection** (`frontend/src/coach/live.ts`): for each camera frame, find the reference frame within 0.4 s behind to 0.15 s ahead with the lowest limb-direction error (people follow a beat behind, which shouldn't count as a mistake). Keep a rolling window of about 1.5 beats. The flow stops when, over the window, one limb is off by more than the threshold, or the limbs on average are. Normal = 50° for one limb or 36° average; relaxed and strict are looser and tighter. It also stops when the best match is consistently ≥ 0.28 s behind (late), ahead (early), or the hands and feet move at under 40% of the routine's speed (too small). No calls in the first count and a half after (re)starting. One bad frame never stops you.

**The pause**: says what to fix in plain words (body part, which way: higher / lower / out wider / in closer; late or early; bigger or smaller) with no degrees or ms. It shows you (orange) beside the target (blue) at that moment and freezes the ghost on the target pose with an arrow. When you hold the pose for 0.8 s it says "That's it!" and redoes that 8-count with a count-in, then flows on past it. You can also ask how (the mistake is sent to the coach agent), redo, or skip ahead. A second stop in the same 8-count drops the speed a notch for that 8-count only.

## Reactive voice coach
Two layers. (1) A local command parser (`frontend/src/coach/commands.ts`) handles clear commands instantly, with no network: speed, strictness, redo/skip/restart, go to an 8-count, slow demo of a count, freeze a pose to copy, pause/stop, repeat what was said. Real questions ("am I…", "why…") are left to the coach. (2) The coach agent (`backend/app/agent/coach.py: ask`) gets the question, the learner's recent reps and habits, the detected mistake (as background, not "answer this"), and the live practice state (phase, speed, current 8-count, move names per count). It replies with one structured Gemini call: `answer` plus up to three `actions`, validated server-side (`_actions`: known types, valid speeds/levels/counts, at most one movement action). The app applies settings at once and runs the movement after the answer has been spoken (capped at 6 s). Hands-free mode keeps speech recognition running during the flow and ignores anything heard while the coach is talking.
