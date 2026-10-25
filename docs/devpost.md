# Devpost submission: Shadow

## Project name
Shadow

## Elevator pitch (≤200 characters)
Learn any dance from any video. Shadow cuts it into counts, builds a lesson plan, and coaches you live through your webcam. Slip up and the crows gather.

## Thumbnail
`~/Pictures/shadow-devpost-thumb.png` (1500×1000, 3:2)

## Video
`~/Videos/shadow-demo.mp4` (1:59). Upload to YouTube (unlisted is fine) and paste the link.

---

## About the project (paste into "Project story")

## Inspiration
Learning choreography from a video means pause, rewind, squint, guess, repeat. Nobody tells you what's wrong on *this* attempt. Dance games only score their own routines, practice players can loop and slow down but never watch you, and teachers can't watch every rep at home. We wanted the routine *you* care about, from any video, with a coach that actually watches.

## What it does
- **Upload any dance video** (up to 10 minutes). Shadow finds the beat, deletes the audio, extracts the dancer's skeleton, and cuts the routine into 8-counts (or 4-counts for short clips). With no music, it finds the rhythm in the movement itself. It names the moves and learns repeats once.
- **It builds a lesson plan** with Gemini: learn each 8-count on its own, join them up at checkpoints (1–2, 1–3 … the whole routine), and earn bronze, silver and gold as you reach 0.5×, 0.75× and full speed. Tell the coach "I have two weeks before my show" and it re-plans.
- **You practise in one continuous flow.** Press Start and it goes full screen: the coach counts you in on the beat in its own voice, the original video plays beside your camera, and a 3D ghost dancer is laid over you, your limbs turning green, amber or red.
- **The murder meter.** A group of crows is a *murder*. Every slip sends a crow to a perch above your camera: *"Just a crow…"*, *"An attempted murder…"*, and at three, **"It's a murder!"**. A 2-second cooldown means one slip is one crow. Then Shadow stops, shows exactly what to fix ("Right arm, a touch higher. Match the ghost."), freezes the ghost on the target pose, and carries on the moment you match it.
- **Hands-free voice coach.** Say "slower", "again", "show me count 5" and it happens instantly; ask "how do I fix my arms?" and the coach answers out loud and acts on it.
- **It tracks you in a crowd.** Several people can be in frame; Shadow keeps coaching *you*, even if someone walks past or you step out and back.
- **Progress across routines:** streaks, steps passed, practice per day, and habits that follow you between routines ("right arm too low on count 3").

## How we built it
- **Frontend:** React + Vite + TypeScript. Live pose runs **in the browser** with MediaPipe (BlazePose + Hands fused into one skeleton), so **webcam video never leaves the device**: only rep results go to the server.
- **Tracking & fingerprints:** every person gets a re-identification fingerprint: a **512-number embedding from an OSNet model we pulled from Hugging Face** (`osnet_x0_25_msmt17`, converted to ONNX and run with onnxruntime-web in a Web Worker), combined with clothing colour and position. That's how IDs survive people crossing, leaving and coming back. One Euro filtering smooths jitter, and a focus mode crops around the dancer for speed.
- **Mistake detector:** compares every frame with the routine while tolerating a little lag (people follow a beat behind), and only calls a mistake when it's sustained. It drives the crows, the fix card and the "match the pose" check.
- **3D ghost:** Three.js mannequin built from the reference's 3D world landmarks.
- **Backend:** FastAPI (Python). Upload pipeline: ffmpeg → librosa beats/downbeats → audio deleted → pose on every frame → normalised skeletons → counts, repeats, hits/freezes/turns, difficulty → move names → Gemini lesson plan (validated, with a rule-based fallback).
- **Learning engine:** Elo-style mastery per phrase, a "sweet spot" difficulty (70–85% chance of passing), spaced repetition, and k-means clustering of missed reps into habits.
- **Data:** we tested our scoring against **AIST++** (1,408 professional dance sequences; same choreography by different dancers vs. wrong choreography), and keep a registry of dance datasets for the move library and evaluation.
- **Brand:** a hand-drawn SVG crow (no wings) with frame-driven hop animations; the loading GIF is that crow filmed frame by frame.
- The demo video itself is built with **Remotion**, with real Playwright recordings of the app, our own screencasts, a Mermaid architecture diagram, and ElevenLabs narration.

## Sponsor tech we used
- **Google Gemini (Best Use of Gemini API):** the coach's brain, through the Interactions API with structured output. It writes each lesson plan, runs a tool-using re-plan agent (`get_progress`, `get_habits`, `get_lesson_plan`, `update_lesson_plan`), and answers mid-practice questions with **validated actions** the app runs straight away (change speed, strictness, show the pose, demo, redo, skip, go to a count). Conversations run with `store=False`.
- **ElevenLabs (Best Use of ElevenLabs):** the coach's voice with Eleven v4: two personas (calm Laura, cheeky Callum), every correction and answer spoken, and the "5, 6, 7, 8" count-in spoken in the coach's own voice and **scheduled with Web Audio so count 1 lands on the beat**. One voice at a time: the count-in waits for the coach to finish, and hands-free listening ignores the coach's own voice. Every line is cached in the database, so repeats are instant and free. ElevenLabs also narrates our demo video.
- **Tiger Data (Best Use of Tiger Data):** one Postgres for everything: users' routines, skeletons, lesson plans, mastery and the voice cache. Every rep is a row in a **TimescaleDB hypertable**, so streaks, practice per day, progress and cross-routine habits are `time_bucket` queries that stay fast as reps pile up. A continuous aggregate and a pgvector move-library table are set up for the next step.
- **Clerk:** login; every API call verifies the Clerk JWT and all data is scoped per user.

## Challenges we ran into
- **Timing.** Learners follow a little behind the music, so a naive frame-by-frame comparison flags everyone. We built a lag-tolerant matcher that searches a window around "now" and prefers being on time.
- **One voice at a time.** Coach, count-in and hands-free mic kept talking over each other (and the mic heard the coach). We built a single voice channel, scheduled the count-in on the beat, and made the listener ignore the coach.
- **Tracking the right person** in a busy hackathon hall: colour alone swaps people; position alone loses them. Adding OSNet fingerprints in a worker fixed swaps without slowing the camera loop.
- **Counts without music.** Short clips and silent videos broke beat tracking, so the beat grid falls back to the dancer's own movement.
- **Feedback that helps.** Stopping on every bad frame was exhausting; the crows plus a 2-second cooldown make one slip one crow, and only three stop you.

## Accomplishments that we're proud of
- It works end to end on real footage: upload → lesson plan → live coaching → progress.
- The murder meter: a playful, honest early warning that turned out to be the most fun part of using it.
- Privacy by design: video stays in the browser, audio is deleted after processing.
- A coach that *acts*, not just talks: ask a question and it changes speed, shows the pose or redoes the count.

## What we learned
- Motor-learning research is right: one specific cue at a time beats a wall of feedback.
- Let the AI decide and the tools measure: deterministic, tested code for pose, beats and scoring; Gemini for planning and explanations.
- Browser ML is fast enough for real-time multi-person tracking if you keep heavy models off the main thread.

## What's next for Shadow
- A trained move classifier (move names are rules today) and the pgvector move library.
- Score calibration on more data (AIST++ alone wasn't conclusive).
- Hand and foot directions in the fixes, group mode for crews, and deployment (Docker image ready).

## Built with
react, typescript, vite, three.js, mediapipe, onnxruntime-web, osnet, hugging-face, python, fastapi, ffmpeg, librosa, numpy, scikit-learn, google-gemini, elevenlabs, tiger-data, timescaledb, postgresql, pgvector, clerk, web-audio-api, web-speech-api, remotion, playwright, mermaid

## Prize categories to opt into
- First Place / Runner Up (general)
- [MLH] Best Use of Gemini API
- [MLH] Best Use of ElevenLabs
- [MLH] Best Use of Tiger Data
- [Hackathons UK] Hackiest Hack (optional: a murder of crows judging your dancing qualifies as over-the-top)

Not entered: Vultr (not deployed), Presage, Solana, Snowflake, Zed Delta, HRT, Best Handmade.

## Links
- Repo: github.com/jtbinith/shadow-oxhack26 (currently **private**: make it public, or add the judges, before submitting if you want to link it)
