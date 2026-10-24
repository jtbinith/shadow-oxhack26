# Shadow: MVP, deployment, schedule, UI, pitch and demo plan

Hacking runs **Sat 24 Oct 14:00 → Sun 25 Oct 12:00** (22 h). This plan starts at **15:45 Sat**, which leaves about 20 h.

---

## 1. The MVP: two features, done properly

### Feature 1: "Any dance video becomes your course"
Upload a clip → beats measured and **audio deleted** → 30 fps pose → **video frames deleted** → 8-counts → the Gemini agent builds a Duolingo-style lesson tree with **chaining** (A, B, A+B, …) and a speed ladder (0.5× → 0.75× → 1×).

The finished bar: it works on any front-facing clip, the processing screen shows each stage, and the lesson tree is clear and good-looking.

### Feature 2: "A coach that adapts to every rep"
Practise along with the ghost overlay → live joint colours → score at the end of each 8-count → replay of your worst count → **one spoken cue** (ElevenLabs preset voice) → the agent chooses your next drill using the learning engine:
- an **Elo mastery** rating for each move, plus **"sweet spot" drill choice** (the drill you have a 70–85% predicted chance of passing)
- **spaced repetition** driven by your scores
- **error clustering** → the coach **teaches the move you're failing**, never swaps it for an easier one: breakdown drills of the *same* move (key-pose freezes at 0.25×, body-part isolation such as legs first, then arms, then together, then back up the speed ladder)
- XP, streaks and unlocks on the tree; a progress chart from Tiger Data

The finished bar: a first-time user's score visibly climbs over 5 reps, and the next drill visibly responds to their mistakes.

### Not in the MVP
| Out | Why |
|---|---|
| Voice cloning | Scope creep. Use 2–3 ElevenLabs preset voices (calm / hype) |
| Group mode, formations | After the MVP |
| Presage | Its SDKs are on-device only: Android, iOS, C++, Node/Electron. **No browser SDK.** In the deployed web app it needs a desktop (Electron) version, so it's post-MVP (see §2) |
| Mic sync to the user's own copy of the song | **P1, if time allows.** The MVP uses an app-generated click track + count-in at the routine's BPM, which is copyright-safe and always works |
| AIST++ for score calibration + move naming | **P1.** Calibrates what a score of "80" means, and names moves ("body roll"). No easier-variant swaps: the user learns the move they chose |
| "Why?" voice agent, voice commands, 3D pose, skill graph | After the MVP |

**Never cut:** upload → lesson tree → practise with ghost, score and cue → adaptive next drill.

---

## 2. Deployment: a real, usable web app

| Piece | Where | Notes |
|---|---|---|
| Frontend (React + Vite build) | **Vultr Cloud Compute VM**, static files served by **Caddy** | Caddy gets HTTPS certificates automatically. HTTPS is required for webcam and mic access |
| Backend (FastAPI) | Same VM, Docker Compose | **Not published.** Only Caddy publishes ports 80 and 443; it proxies `/api` and `/ws` over the internal compose network |
| Ingest worker | **Vultr GPU instance** (Docker) | **No public port.** Reached from the API VM over a **Vultr VPC** (private network). Local CPU fallback |
| Upload storage | **Vultr Object Storage**, private bucket | Direct browser upload through short-lived presigned URLs. **Lifecycle rule deletes objects after 1 day**; the worker deletes the source as soon as pose + beats are extracted |
| Database | **Tiger Data cloud** (TimescaleDB + pgvector) | TLS required; **IP allow-list = the API VM + GPU VM only**. Never open to the internet |
| Login | **A managed auth provider** (e.g. Clerk or Auth0 free tier) | Users have private practice data, so every `/api` and `/ws` route checks the provider's JWT (verified against its JWKS). Only the landing page is public. **Don't write our own login** |
| Gemini / ElevenLabs keys | Server-side only, in a `.env` that is never committed | Compose uses `${VAR:?}` so a missing key fails fast. The browser never sees an API key |
| Domain | A cheap domain, or `sslip.io` for the hackathon | Needed for HTTPS certificates |

**Firewall (Vultr firewall groups):**
- API VM: 443 and 80 open (80 redirects to 443); SSH from team IPs only
- GPU VM: no internet inbound except SSH from team IPs
- No database or worker port is ever open to `0.0.0.0/0`

**Cost and abuse limits:** upload size cap (e.g. 200 MB, max 3 min); per-user rate limits on uploads and agent calls; a per-request agent step and token cap.

**Path to Presage after the MVP:** wrap the same React app in **Electron** as a desktop client and use Presage's Node/Electron SDK there. The web version stays vitals-free.

**Deploy early:** have the "walking skeleton" (login → upload → webcam page) live on the real URL by **Checkpoint 1 (20:00)**, then deploy continuously. Keep a local run as the demo fallback.

---

## 3. Skills in `.claude/skills/` (build time, for Claude Code)

All were reviewed: no unexpected network calls or credential access in their scripts.

| Skill | Source / licence | Used for |
|---|---|---|
| `skill-creator` | Anthropic, Apache-2.0 | Writing project skills for the coding agent (e.g. our repo conventions) |
| `frontend-design` | Anthropic, Apache-2.0 | A distinctive UI, not template defaults |
| `webapp-testing` | Anthropic, Apache-2.0 | Playwright run of the demo path before judging |
| `gemini-api-dev` | Google, Apache-2.0 | Current Gemini models, function calling, structured output (the app's agent) |
| `vercel-react-best-practices` | Vercel, MIT | Re-render and performance rules for the webcam/overlay loop (ignore its Next.js server rules) |
| `text-to-speech` | ElevenLabs, MIT | Coach voice, streaming, cue cache |
| `agents` | ElevenLabs, MIT | Post-MVP "Why?" voice agent |
| `speech-to-text` | ElevenLabs, MIT | Post-MVP voice commands |
| `setup-timescaledb-hypertables` | Tiger Data, Apache-2.0 | Rep hypertables, continuous aggregates for progress |
| `timescaledb-hyperfunctions` | Tiger Data, Apache-2.0 | Progress statistics |
| `pgvector-semantic-search` | Tiger Data, Apache-2.0 | P1 move naming (nearest labelled AIST++ move) |
| `design-postgres-tables` | Tiger Data, Apache-2.0 | Schema design |

These are for the team's coding agent only. **At runtime the app uses Gemini**, with these **coaching playbooks** (markdown, loaded into the agent's instructions per task):
- `curriculum-design`: lesson tree, chaining, speed ladder, unlock rules
- `dance-cues`: cue library by fault type, one cue at a time, external focus, fading
- `coach-persona`: tone for each preset voice
- `practice-review`: reads mastery, spaced-repetition state and error clusters to choose the next drill
- `dance-safety`: detailed safety policy

The hard safety rules also live in code and the system prompt, not only in a playbook.

---

## 4. Schedule (Sat 15:45 → Sun 12:00)

**A = ingest/CV · B = frontend · C = agent/backend/deploy.** With 2 people, merge A and C.

| Time | A: ingest / CV | B: frontend | C: agent / backend / deploy |
|---|---|---|---|
| **15:45–16:30** | Setup, all together: repo + compose, API keys (Gemini, ElevenLabs, Tiger Data, Vultr credits, auth provider), commit `.claude/skills`. **Record 2 reference clips of our own choreography.** Start the AIST++ keypoint download (for P1) | | |
| 16:30–20:00 | ffmpeg 30 fps, beats → delete audio, pose, normalise, 8-counts | Vite app, login, webcam + MediaPipe, ghost overlay | Vultr VM + Caddy + compose, Object Storage + presigned upload, Tiger Data schema, Claude Tool Runner with stub tools |
| **20:00 ✅ Checkpoint 1** | **Walking skeleton live on the real URL:** log in → upload → 8-counts listed; webcam ghost works | | |
| 20:00–00:00 | DTW shape + timing scoring, fault ranking; move to the GPU worker over the VPC | Lesson tree + practise screens, click track + count-in | `curriculum-design` + `dance-cues` skills; agent builds the tree and picks the next drill; rep logging; ElevenLabs cue cache |
| **00:00 ✅ Checkpoint 2** | **Feature 1 complete; Feature 2 works end to end (ugly is fine)** | | |
| 00:00–04:00 | Error clustering → breakdown drills of the same move (key-pose freezes, body-part isolation) | Score card, worst-count replay, XP/streak/unlock | Elo + sweet spot + spaced repetition; guardrails, rate limits |
| 04:00–07:00 | **Sleep in shifts** (2 h each). Whoever is awake: polish with `frontend-design`; P1 mic sync or AIST++ calibration only if P0 is solid | | |
| **07:00 ✅ Checkpoint 3** | **Both features complete.** Progress chart | | |
| 07:00–09:00 | Hardening on real clips; P1 only if everything else is finished | | |
| **09:00 🧊 Feature freeze** | | | |
| 09:00–10:30 | Bug fixes; `webapp-testing` on the deployed URL; security check (only 80/443 open, anonymous `/api` call gets 401, DB unreachable from outside); **record the backup demo video** | | |
| 10:30–11:30 | Slides, Devpost write-up with the live URL, **rehearse the demo 3 times** with a timer | | |
| 11:30–12:00 | **Submit** (buffer for upload problems) | | |

---

## 5. UI

**Design direction** (refine with `frontend-design`): *the rehearsal studio at night*. A dark stage, one warm spotlight colour for "you", a cool luminous colour for the ghost, and big numbers. Built for being read from 3 m away while dancing.

| Screen | Contents |
|---|---|
| **1. Upload** | Drop zone, rights agreement checkbox, camera tips (full body, chest height, ~3 m, front-on) |
| **2. Processing** | Stage list ticking off: beats found → **audio deleted** → skeletons → **video frames deleted** → 8-counts → course built |
| **3. Lesson tree** | A Duolingo-style path: one node per 8-count, chain checkpoints (A+B) as larger nodes, bronze/silver/gold for the speed tiers, locked nodes greyed |
| **4. Practise** | Centre: mirrored webcam + ghost, watched joints coloured. Left: counts strip with beat flash. Right: live score meter, speed, XP. After each rep: score card, worst-count replay, cue caption |
| **5. Next drill** | The agent's choice with a one-line reason ("arms only: your elbow drops on 3 of the last 4 reps") |
| **6. Progress** | Score per day, mastery per move, the next review due, the error habit |
| Settings | Coach voice (preset list), mirror on/off, delete my data |

Build screens 3 and 4 first (the demo lives there), then 1–2, then 5–6.

---

## 6. Presentation (3 min + Q&A)

| Slide | Content |
|---|---|
| 1. Hook | "We learn dance from shaky phone videos. Nobody tells us what's wrong on *this* rep." |
| 2. Live demo | (most of the time, see below), **on the live URL** |
| 3. How it works | Pipeline diagram: ingest on a Vultr GPU → Gemini agent + coaching playbooks → live loop in the browser → Tiger Data. "The agent decides; the tools measure." |
| 4. The adaptive engine | Elo mastery, sweet-spot drills, spaced repetition, error clusters |
| 5. Responsible by design | Audio and video deleted after processing, a click track instead of the song, login + private data, safety guardrails |
| 6. Tracks + next | ElevenLabs, Tiger Data, Vultr; next: the Presage desktop app, mic sync, group mode |

Have ready answers for: "Isn't this just Just Dance?" (any video, it teaches, it adapts), "Copyright?" (slide 5), "Does it actually help?" (show a tester's score climbing over 5 reps).

## 7. Demo plan

**Script (≈2 min of the 3):**
1. On the live URL, upload our own 30-second clip. The processing screen shows "audio deleted", "frames deleted", 4 eight-counts.
2. The lesson tree appears. A judge picks node 1 at 0.5×.
3. The judge dances. The ghost and joint colours show; the score is about 60; the coach voice gives one cue; next rep about 75.
4. The judge fails the turn → the coach teaches that turn: freezes on its 3 key poses at 0.25×, then legs only, then the full turn, and says why ("your shoulders open early on 6").
5. Switch to a pre-seeded account's progress screen: mastery, review schedule, the error habit.

**Setup checklist:**
- Laptop + external webcam on a stand at chest height, 3 m of clear floor, a lamp for light
- A speaker for the click track and cues
- A pre-seeded demo account with a few days of practice history
- **Backup demo video** on the desktop, plus the local run as fallback if venue Wi-Fi fails
- Test at the actual judging spot by 10:00 Sun if possible
