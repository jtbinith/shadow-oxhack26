# Shadow: learn any dance from your coach's video

**Just Dance × Duolingo.** A coach uploads one video. Every student gets their own adaptive course, live feedback on every rep, and a coach voice they choose.

**Styles:** any dance style. The move library is pre-loaded from AIST++ (break, pop, lock, house, waack, krump, middle hip-hop, LA hip-hop, street jazz, ballet jazz), and coaches' uploads extend it to styles like contemporary and K-pop.

---

## Problem

- People learn choreography from videos, which means endless pausing, rewinding, mirroring and slowing down, and nobody tells them what's wrong on *this* rep.
- Coaches can't build a personal course for every student or watch their practice at home.
- Just Dance scores you but doesn't teach you. Duolingo teaches in small steps but has no movement. Dance class apps (e.g. STEEZY) give video lessons without feedback on your reps.

## What it does

1. **The coach uploads a clip** (any phone or camera, any frame rate).
2. **The agent builds a course:** it splits the routine into 8-counts, matches each to known moves, rates difficulty, and lays out a lesson tree.
3. **The student practises:** live webcam scoring like Just Dance, with one spoken correction per rep in the voice they picked.
4. **It adapts:** the agent picks the next drill from your error patterns, heart rate and review schedule. Type "I keep messing up the turn" or "I have 2 weeks", and it re-plans.
5. **Progress:** streaks, XP, unlocks, and a final "perform it" level at full speed.

---

## Architecture

```
INGEST  (heavy, once per video, cached by file hash; Vultr GPU worker, local fallback)
  ffprobe real frame timestamps (handles variable frame rate)
  → extract beat grid (tempo, beats, downbeat) → DELETE AUDIO
  → pose at native fps → DELETE VIDEO FRAMES (keep skeletons only)
  → normalise skeleton (centre on hips, scale by torso length, mirror option)
  → resample to 30 Hz (smooth before downsampling high fps; interpolate + smooth low fps;
     fill low-confidence joints from neighbouring frames)
  → time in BEATS, not seconds (tempo-invariant: 0.5× practice just works)
  → split into 8-counts → embed (joint angles + speeds) → store in pgvector

KNOWLEDGE  (Tiger Data: Postgres + pgvector + time series, one database)
  move clusters · skill graph · cue library · rep logs · error clusters · review schedule

CURRICULUM + TUTOR  (Claude Opus 5.5 agent + Agent Skills)
  plans and adapts lessons; calls deterministic tools for all measurement

PRACTICE  (live, in the browser, no AI calls in the loop)
  MediaPipe pose → online DTW vs reference → score → cached cue clip → ElevenLabs voice
```

**Design rule: the agent decides, the tools measure.** Pose, beats, DTW and scoring are deterministic code. Claude never guesses an angle.

### Agent tools

`segment_clip` · `score_rep` · `find_similar_moves` · `find_easier_variant` · `make_drill(segment, speed, mirror)` · `get_user_history` · `get_error_clusters` · `schedule_review`

### Agent Skills (coaching knowledge, separate from code)

- `curriculum-design`: how to build a lesson tree, unlock thresholds (80%+), drill progression (0.5× mirrored → 0.75× → full speed)
- `dance-cues`: one external-focus cue at a time (on the movement's effect, not your body), cues fade as you improve, and cues are ranked by how much the fault matters
- `persona`: coach catchphrases, tone (hype or calm), language mix (e.g. Hindi-English)

### The learning engine (why it isn't an AI wrapper)

| Component | How | What it gives the user |
|---|---|---|
| **Move clustering** | HDBSCAN on segment embeddings across all uploaded videos; Claude names each cluster once from keyframes (cached) | New uploads break into known moves instantly |
| **Skill graph** | Prerequisite links: a move whose segments contain move A comes after A | Duolingo tree generated automatically |
| **Easier-variant retrieval** | Nearest moves in the vector store that you've already mastered | Fail a move and you get a stepping-stone drill, not the same clip again |
| **Past-session retrieval** | Your own previous reps of similar moves | "Last week you nailed this at 0.75×, try that first" |
| **Own-error clustering** | Cluster your faults across all reps | Targets habits ("elbow drops on 70% of your turns"), not one-off slips |
| **Spaced repetition** | FSRS schedule per move | Weak moves come back at the right time |
| **Difficulty model** | Predicts difficulty from speed, direction changes and balance demand; checked against AIST++ basic vs advanced | Sensible lesson order from day one |

---

## Personalised coach voice

| Voice | Setup |
|---|---|
| Preset | ElevenLabs voice library |
| Your coach | Records ~1–2 min once (Instant Voice Cloning) |
| Someone familiar | Parent, friend or sibling records the same way |
| Future you | A clone of your own voice |

- Voice (ElevenLabs) and personality (`persona` skill) are separate layers.
- When a voice is set up, the whole cue library is pre-generated and cached, so per-rep cues play instantly. Only one-off replies use live streaming speech.

## Data, copyright and consent

- **Audio is deleted right after the beat grid is extracted.** We keep timing data, not the recording. For practice, the user plays their own copy of the song, or uses an ElevenLabs count-in or click track at the same BPM.
- **Video frames are deleted after pose extraction.** We store stick figures only.
- **Voice clones come only from a consent recording** in which the owner reads a consent line. Never from the uploaded dance video. Consent is stored and can be revoked, which deletes the voice through the ElevenLabs API. No celebrity or public-figure voices. Under-18s need a parent's consent. Labelled as an AI voice in the app.
- **Main demo path uses clips the coach uploads.** YouTube's terms restrict downloading.

---

## Prize tracks

- **ElevenLabs (core):** personalised coach voice, cached cue library, conversational tutor, count-ins
- **Tiger Data (core):** one Postgres database for rep time series, pgvector embeddings, error clusters and the review schedule
- **Presage:** heart rate between drills; the agent slows down or adds rest when you're overworked
- **Vultr:** GPU ingest worker (3D pose, embeddings, clustering)
- **DEV Writing Challenge:** write up the build afterwards

## Stack

Electron/web frontend · MediaPipe Pose (browser) · Python ingest (ffmpeg/ffprobe, librosa, NumPy, scikit-learn/HDBSCAN) · Claude API with the Tool Runner + Agent Skills · ElevenLabs API · Presage SDK · Tiger Data (Postgres + pgvector) · Vultr GPU · AIST++ (move library seed data)

---

## 24-hour plan

| Hours | Ingest / CV | Agent / backend | Frontend / voice |
|---|---|---|---|
| 0–4 | ffprobe timestamps, MediaPipe pose, skeleton normalisation | Tiger Data schema (reps, segments, vectors) | Webcam view + skeleton overlay |
| 4–8 | Beat grid → delete audio, resample, split into 8-counts | Agent tools: `segment_clip`, `score_rep`, `make_drill` | Practice screen, live score |
| 8–12 | Online DTW scoring, fault ranking | Claude agent + `curriculum-design` skill → lesson tree | ElevenLabs preset voice, cue cache |
| 12–16 | Embeddings, move clustering, skill graph | Easier-variant + past-session retrieval | Lesson tree UI, unlocks, XP, streaks |
| 16–20 | Own-error clustering, difficulty model | Spaced repetition, text re-planning | Voice cloning + consent flow, Presage |
| 20–24 | Vultr ingest worker (if time) | Hardening, cached fallbacks | Demo polish, pre-recorded backup session |

## Demo script (3 minutes)

1. **Upload:** the coach's 30-second clip goes in. On screen: "audio removed, video frames removed, 4 eight-counts found, 3 moves recognised from the move library."
2. **Course appears:** a lesson tree generated from the skill graph.
3. **A judge practises** counts 1–8 at 0.5×, mirrored. A live score shows, and the coach's cloned voice says one cue: "sharp arms on 3!"
4. **The judge fails the turn** → the agent pulls an easier variant → a stepping-stone drill appears.
5. **The judge types** "I have a wedding in 2 weeks" → the plan reshapes on screen.
6. **Pre-recorded session:** error clusters ("elbow drops on 70% of turns"), the review schedule, and the progress curve.

## Risks and fallbacks

- **2D depth ambiguity:** film the reference and practice from the same angle (front-on); 3D pose on Vultr is a stretch goal.
- **Live latency:** no model calls in the rep loop; cues are cached clips.
- **Clustering needs data:** pre-load AIST++ segments (free download, 10 genres) so the move library isn't empty on day one.
- **Contemporary isn't in AIST++:** it still works, because the coach's clip is always the reference, but instant move recognition needs clusters. Add a few contemporary clips (filmed with consent) before the demo.
- **Wi-Fi at the venue:** a local fallback for ingest and a pre-recorded backup session.

## Stretch goals

- Crew mode: duets and groups
- A marketplace where coaches publish courses
