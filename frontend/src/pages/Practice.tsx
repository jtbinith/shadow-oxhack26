import { useCallback, useEffect, useRef, useState } from 'react'
import PoseCam, { type Frame as CamFrame, type Person } from '../pose/PoseCam'
import { useAuth } from '@clerk/clerk-react'
import { useApi, type Routine, type Step } from '../api'
import { BONES, angle, boneDirs, normaliseFrame, refFrame, scoreRep, type Frame, type RefData, type UserSample } from '../coach/score'
import { countInDelay, recordSnippet } from '../coach/micsync'
import { Ghost3D } from '../coach/ghost3d'
import { MistakeDetector, THRESHOLDS, describe, holding, howTo, type Mistake, type Sensitivity } from '../coach/live'
import { anchor, drawArrow, drawBodyGhost, drawPose } from '../coach/draw'
import { click, makeSpeak, speakFallback } from '../coach/voice'
import { parseCommand, type Action } from '../coach/commands'
import { styleCue, styleFor } from '../coach/styles'

// Practice is one continuous flow: the routine video plays (it is the clock), the ghost moves
// with it, and the learner dances straight through the 8-counts. When a noticeable mistake is
// sustained, everything pauses on it: what's wrong (body part, which way, timing, speed), the
// target pose to match, a chance to ask how — then that 8-count again, and on past it.

// The parts of the Web Speech API we use (not in TypeScript's DOM types everywhere).
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e?: { error?: string }) => void) | null
  continuous?: boolean
  start: () => void
  stop: () => void
}
type Phase = 'loading' | 'ready' | 'watching' | 'countin' | 'flowing' | 'paused' | 'done'
type Reference = { fps: number; start: number; end: number; counts: number[]; points: number[][][]; world?: number[][][] }
// One 8-count inside the flowing section.
type Seg = { idx: number; off: number; dur: number; ref: RefData; names: string[] }
type Pause = { m: Mistake | null; seg: number; count: number; headline: string; fixes: string[]; lost?: boolean; posing?: boolean; how?: { steps: string[]; spoken: string } }
type Answer = { answer: string; actions: Action[] }

const SPEEDS = [0.25, 0.5, 0.75, 1]
const describeAction = (a: Action): string =>
  a.type === 'speed' ? `${a.speed}×`
    : a.type === 'strictness' ? `${a.level} stops`
      : a.type === 'demo' ? `demo${a.eight_count ? ` 8-count ${a.eight_count}` : ''}${a.count ? ` count ${a.count}` : ''}`
        : a.type === 'show_pose' ? `match the pose${a.count ? ` on ${a.count}` : ''}`
          : a.type === 'goto' ? `go to 8-count ${a.eight_count}`
            : a.type === 'continue' ? 'carry on' : a.type === 'repeat_voice' ? 'say it again' : a.type
const LOST_AFTER_S = 2.5
const HOLD_S = 0.8
const ALL_BONES = Array(BONES.length).fill(true)

// mode 'step': flow through one lesson-tree step; a clean run (no stops) passes it.
// mode 'routine': the whole routine in one continuous run-through.
export default function Practice({ routine, stepIndex, step, onExit, onNextStep, mode = 'step' }: {
  routine: Routine
  stepIndex: number
  step: Step
  onExit: () => void
  onNextStep: () => void
  mode?: 'step' | 'routine'
}) {
  const api = useApi()
  const { getToken } = useAuth()
  const style = styleFor(routine.style)
  const [phase, setPhase] = useState<Phase>('loading')
  const [speed, setSpeed] = useState(step.start_speed)
  const [sensitivity, setSensitivity] = useState<Sensitivity>('normal')
  const [scope, setScope] = useState<'end' | 'step'>(mode === 'routine' ? 'end' : 'step')
  const [countLabel, setCountLabel] = useState('')
  const [calling, setCalling] = useState<{ seg: number; count: number; name: string } | null>(null)
  const [pause, setPause] = useState<Pause | null>(null)
  const [held, setHeld] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [habit, setHabit] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ clean: number; pauses: number; trickiest: number | null; passed: boolean | null; relaxed: boolean } | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [persona, setPersona] = useState<'calm' | 'hype'>('hype')
  const [ghostMode, setGhostMode] = useState<'3d' | 'flat'>('3d')
  const personaRef = useRef(persona)
  personaRef.current = persona
  const sensitivityRef = useRef(sensitivity)
  sensitivityRef.current = sensitivity
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const ghostModeRef = useRef(ghostMode)
  ghostModeRef.current = ghostMode
  const speak = useRef(makeSpeak(getToken, () => personaRef.current)).current
  // The last thing the coach said, so the learner can hear it again.
  const [lastSaid, setLastSaid] = useState<string | null>(null)
  const say = useCallback((text: string) => {
    setLastSaid(text)
    return speak(text)
  }, [speak])

  // Everything the per-frame callbacks need, kept in one mutable place.
  const S = useRef({
    phase: 'loading' as Phase,
    segs: [] as Seg[],
    all: null as RefData | null, // the whole section as one reference timeline
    world: [] as number[][][],
    secStart: 0, // song time where the section starts
    end: 0, // section length (s)
    baseSpeed: 1,
    speed: 1,
    perf: { running: false, base: 0, at: 0 }, // fallback clock when there's no video
    seg: 0, // 8-count being danced (index into segs)
    lastCount: -1,
    samples: [] as UserSample[], // this 8-count's frames, for its score
    detector: null as MistakeDetector | null,
    target: null as { frame: Frame; j: number; bone: number } | null, // frozen pose while paused
    heldSince: null as number | null,
    lostSince: null as number | null,
    lastErrs: [] as (number | null)[],
    pausesAt: new Map<number, number>(),
    slowed: false,
    stats: { clean: 0, pauses: 0 },
    segScores: [] as number[], // this run's clean 8-count scores
    session: null as string | null,
    timers: [] as number[],
    music: false,
  })
  S.current.phase = phase
  const video = useRef<HTMLVideoElement>(null)
  const ac = useRef<AudioContext | null>(null)
  const ghostCanvas = useRef<HTMLCanvasElement>(null)
  const ghost3d = useRef<Ghost3D | null>(null)
  const snapshot = useRef<HTMLCanvasElement>(null)

  // Which 8-counts flow: from this step's first one to the end of the routine (or just this step, on repeat).
  const startIdx = mode === 'routine' ? routine.eight_counts[0]?.idx ?? 0 : step.eight_counts[0]
  const idxs = scope === 'step' ? step.eight_counts : routine.eight_counts.map((e) => e.idx).filter((i) => i >= startIdx)
  const idxKey = idxs.join(',')

  // The original (silent) routine video: the clock for the whole flow.
  useEffect(() => {
    let url: string | null = null
    ;(async () => {
      try {
        const token = await getToken()
        const res = await fetch(`/api/routines/${routine.id}/video`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        url = URL.createObjectURL(await res.blob())
        setVideoUrl(url)
      } catch { /* no preview: a timer is the clock */ }
    })()
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [getToken, routine.id])

  // Load every 8-count's reference and join them into one timeline.
  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    ;(async () => {
      const list = idxKey.split(',').map(Number)
      const refs = await Promise.all(list.map((i) => api<Reference>(`/api/routines/${routine.id}/eight-counts/${i}/reference`)))
      const session = S.current.session ?? (await api<{ id: string }>(`/api/routines/${routine.id}/sessions`, { method: 'POST' })).id
      if (cancelled) return
      const segs: Seg[] = []
      const frames: Frame[] = []
      const world: number[][][] = []
      const counts: number[] = []
      const hits: number[] = []
      let off = 0
      refs.forEach((r, k) => {
        const ec = routine.eight_counts.find((e) => e.idx === list[k])
        const fr = r.points.map(refFrame)
        const cs = r.counts.map((c) => c - r.start)
        const hs = (ec?.key_moments ?? []).filter((m) => m.type === 'hit').map((m) => m.t - r.start)
        const dur = r.points.length / r.fps
        segs.push({ idx: list[k], off, dur, ref: { frames: fr, fps: r.fps, counts: cs, hits: hs }, names: cs.map((_, j) => ec?.moves?.[j]?.name ?? '') })
        frames.push(...fr)
        world.push(...r.points.map((_, j) => r.world?.[j] ?? []))
        counts.push(...cs.map((c) => c + off))
        hits.push(...hs.map((h) => h + off))
        off += dur
      })
      const all: RefData = { frames, fps: refs[0]?.fps ?? 30, counts, hits }
      const beat = (counts[1] - counts[0]) || 0.5
      Object.assign(S.current, {
        segs, all, world, end: off, session,
        secStart: routine.eight_counts.find((e) => e.idx === list[0])?.start_s ?? 0,
        perf: { running: false, base: 0, at: 0 },
        detector: new MistakeDetector(all, { sensitivity: sensitivityRef.current, mask: ALL_BONES, windowS: Math.max(0.8, 1.5 * beat) }),
      })
      setPhase('ready')
    })().catch(() => !cancelled && setPhase('ready'))
    return () => { cancelled = true }
  }, [api, routine, idxKey])

  useEffect(() => {
    if (S.current.detector) S.current.detector.sensitivity = sensitivity
  }, [sensitivity])

  useEffect(() => {
    if (!ghostCanvas.current) return
    try {
      ghost3d.current = new Ghost3D(ghostCanvas.current)
    } catch {
      setGhostMode('flat') // no WebGL
    }
    return () => {
      ghost3d.current?.dispose()
      ghost3d.current = null
    }
  }, [])

  // ---- the clock: the video's own time, or a timer if there's no video ----
  const now = useCallback((): number => {
    const v = video.current
    const st = S.current
    if (v && videoUrl) return v.currentTime - st.secStart
    return st.perf.running ? st.perf.base + ((performance.now() - st.perf.at) / 1000) * st.speed : st.perf.base
  }, [videoUrl])

  const halt = useCallback(() => {
    const st = S.current
    st.timers.forEach((t) => window.clearTimeout(t))
    st.timers = []
    st.perf = { running: false, base: now(), at: 0 }
    video.current?.pause()
  }, [now])

  useEffect(() => () => halt(), [halt])

  const seek = useCallback((t: number) => {
    const st = S.current
    st.perf = { running: false, base: t, at: 0 }
    if (video.current && videoUrl) video.current.currentTime = st.secStart + t
  }, [videoUrl])

  const play = useCallback(() => {
    const st = S.current
    st.perf = { running: true, base: st.perf.base, at: performance.now() }
    const v = video.current
    if (v && videoUrl) {
      v.playbackRate = st.speed
      void v.play()
    }
  }, [videoUrl])

  const segAt = (t: number) => {
    const segs = S.current.segs
    let k = 0
    while (k + 1 < segs.length && segs[k + 1].off <= t + 1e-6) k++
    return k
  }

  // ---- start (or restart) the flow at section time `from`, after a 4-count count-in ----
  const flowFrom = useCallback((from: number, lead = 0.3, music = false) => {
    const st = S.current
    const all = st.all
    if (!all || !all.frames.length) return
    halt()
    const audio = (ac.current ??= new AudioContext())
    st.music = music
    st.seg = segAt(from)
    st.samples = []
    st.target = null
    st.heldSince = null
    st.lostSince = null
    st.lastCount = -1
    seek(from)
    setPause(null)
    setHeld(false)
    setSummary(null)
    const beat = ((all.counts[1] - all.counts[0]) || 0.5) / st.speed
    const t0 = audio.currentTime + lead
    ;['5', '6', '7', '8'].forEach((n, k) => {
      if (!music) click(audio, t0 + k * beat, k === 0)
      st.timers.push(window.setTimeout(() => {
        setCountLabel(n)
        speakFallback(n, 1.3) // counts must land on the beat; no network in the loop
      }, (lead + k * beat) * 1000))
    })
    setPhase('countin')
    st.timers.push(window.setTimeout(() => {
      setCountLabel('')
      // No mistakes are called in the first count and a half after (re)starting: find the groove.
      st.detector?.reset(from + ((all.counts[1] - all.counts[0]) || 0.5) * 1.5)
      play()
      setPhase('flowing')
    }, (lead + 4 * beat) * 1000))
  }, [halt, play, seek])

  // ---- record an 8-count as a rep (feeds mastery, habits and the coach) ----
  // asStep: record the whole lesson-tree step at the end of a run (clean run = pass).
  const recordSeg = useCallback(async (k: number, failed: Mistake | null, count = 1, asStep?: { clean: boolean }): Promise<boolean | null> => {
    const st = S.current
    const seg = st.segs[k]
    if (!seg || !st.session) return null
    const score = scoreRep(st.samples, seg.ref, 'full', { weights: style.weights, tauMs: style.tauMs, watched: style.watched, vocabulary: (f) => styleCue(style, f) })
    const plan = routine.lesson_plan.steps ?? []
    const owner = plan.findIndex((s) => s.type === 'learn' && s.eight_counts[0] === seg.idx)
    const topFault = failed
      ? failed.kind === 'shape'
        ? { type: 'shape', count, body_part: failed.part.replace(' ', '_'), direction: failed.direction }
        : { type: failed.kind === 'early' ? 'early' : failed.kind === 'late' ? 'late' : 'soft', count }
      : score.topFault
    if (!failed) st.segScores.push(score.similarity)
    const mean = st.segScores.length ? st.segScores.reduce((a, b) => a + b, 0) / st.segScores.length : score.similarity
    // In the flow, the stop detector is the judge: a run with no stops (not on relaxed) passes the step.
    const similarity = asStep ? (asStep.clean ? Math.max(mean, 80) : Math.min(mean, 60)) : failed ? Math.min(score.similarity, 60) : score.similarity
    try {
      const res = await api<{ passed: boolean; habit: string | null }>(`/api/routines/${routine.id}/sessions/${st.session}/reps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step_index: asStep ? stepIndex : owner >= 0 ? owner : stepIndex,
          eight_counts: asStep ? step.eight_counts : [seg.idx],
          speed: st.speed,
          drill: 'full',
          similarity: Math.round(similarity),
          shape: score.shape,
          timing: score.timing,
          per_count: score.perCount,
          timing_bias_ms: score.timingBiasMs,
          top_fault: topFault,
        }),
      })
      setHabit(res.habit)
      return res.passed
    } catch {
      return null // offline: keep flowing
    }
  }, [api, routine.id, routine.lesson_plan.steps, step.eight_counts, stepIndex, style])

  // ---- pause: on a mistake, on losing the dancer, or by hand ----
  const stopFor = useCallback((m: Mistake | null, why: 'mistake' | 'lost' | 'manual' = 'mistake') => {
    const st = S.current
    halt()
    const k = st.seg
    const seg = st.segs[k]
    const local = (m?.t ?? now()) - (seg?.off ?? 0)
    const count = Math.min(8, Math.max(1, seg?.ref.counts.filter((c) => c <= local + 0.05).length ?? 1))
    if (why === 'lost') {
      st.target = null
      setPause({ m: null, seg: k, count, headline: 'I lost you', fixes: ["Step back so your whole body is in the frame, then we'll go again."], lost: true })
      void say("I lost you. Step back into the frame and we'll go again.")
    } else if (why === 'manual' || !m) {
      st.target = null
      setPause({ m: null, seg: k, count, headline: 'Paused', fixes: ['Take a breath. Redo this 8-count or skip ahead when you are ready.'] })
    } else {
      st.stats.pauses++
      st.pausesAt.set(k, (st.pausesAt.get(k) ?? 0) + 1)
      if (st.all) st.target = { frame: st.all.frames[m.j], j: m.j, bone: m.bone }
      const d = describe(m, count)
      const how = howTo(m, count)
      speak.prefetch(how.spoken) // so "How do I fix it?" answers instantly
      setPause({ m, seg: k, count, headline: d.headline, fixes: d.fixes, how, posing: true })
      void say(d.spoken)
      void recordSeg(k, m, count)
    }
    setPhase('paused')
  }, [halt, now, recordSeg, say, speak])

  // ---- redo the 8-count where the mistake was, then carry on past it ----
  const redo = useCallback(() => {
    const st = S.current
    const k = pause?.seg ?? st.seg
    if ((st.pausesAt.get(k) ?? 0) >= 2 && st.speed > 0.5) {
      // Second stop in the same place: take this 8-count slower, then back up to speed after it.
      const slower = SPEEDS[Math.max(0, SPEEDS.indexOf(st.speed) - 1)] ?? 0.5
      st.speed = slower
      st.slowed = true
      setSpeed(slower)
      setNote(`Second stop here, so this 8-count goes at ${slower}×. Back up to speed after it.`)
    }
    setCoachAnswer(null)
    setMore(null)
    flowFrom(st.segs[k]?.off ?? 0)
  }, [flowFrom, pause])

  // Once the learner matches the target pose: say so and go again automatically.
  useEffect(() => {
    if (!held || phase !== 'paused') return
    void say("That's it! Again from the top of this 8-count.")
    const id = window.setTimeout(redo, 1800)
    return () => window.clearTimeout(id)
  }, [held, phase, redo, say])

  const finishSection = useCallback((passed: boolean | null = null) => {
    const st = S.current
    halt()
    const tricky = [...st.pausesAt.entries()].sort((a, b) => b[1] - a[1])[0]
    const relaxed = sensitivityRef.current === 'relaxed'
    setSummary({ clean: st.stats.clean, pauses: st.stats.pauses, trickiest: tricky ? st.segs[tricky[0]]?.idx ?? null : null, passed, relaxed })
    setPhase('done')
    void say(passed ? 'Step passed! The next one is unlocked.'
      : scopeRef.current === 'step' && st.stats.pauses > 0 ? 'You made it through. One clean run without a stop passes the step. Go again!'
        : st.stats.pauses === 0 ? 'Flawless. You flowed straight through!' : 'Nice work. You made it to the end.')
  }, [halt, say])

  // ---- every camera frame ----
  const onFrame = useCallback((f: CamFrame) => {
    const st = S.current
    const me = f.people.find((p) => p.id === f.dancerId)
    const cam = document.querySelector<HTMLVideoElement>('.posecam video')
    const frame = me && cam ? normaliseFrame(me.body, cam.videoWidth, cam.videoHeight) : null

    if (st.phase === 'paused' && st.target) {
      // "Now you try": hold the target pose for a moment.
      if (holding(frame, st.target.frame, st.target.bone, ALL_BONES, THRESHOLDS[sensitivityRef.current])) {
        st.heldSince ??= performance.now()
        if (performance.now() - st.heldSince > HOLD_S * 1000) setHeld(true)
      } else st.heldSince = null
      return
    }
    if (st.phase !== 'flowing' || !st.all) return
    const t = now()
    if (t >= st.end - 0.02) {
      // End of the run. In a step: record the step (a run with no stops passes it).
      st.stats.clean++
      if (scopeRef.current === 'step') {
        const clean = st.stats.pauses === 0 && sensitivityRef.current !== 'relaxed'
        halt()
        setPhase('done')
        void recordSeg(st.seg, null, 1, { clean }).then((passed) => finishSection(passed))
      } else {
        void recordSeg(st.seg, null)
        finishSection()
      }
      return
    }
    // Into the next 8-count: the one before went cleanly.
    const k = segAt(t)
    if (k !== st.seg) {
      st.stats.clean++
      void recordSeg(st.seg, null)
      if (st.slowed) {
        st.slowed = false
        st.speed = st.baseSpeed
        setSpeed(st.baseSpeed)
        if (video.current) video.current.playbackRate = st.baseSpeed
        setNote('Nailed it. Back up to speed.')
        void say('Nailed it. Back up to speed.')
      }
      st.seg = k
      st.samples = []
    }
    // A click on every count (unless their own music is playing), accent on each "1"; call the move.
    const c = st.all.counts.filter((x) => x <= t).length - 1
    if (c !== st.lastCount && c >= 0) {
      st.lastCount = c
      if (!st.music && ac.current) click(ac.current, ac.current.currentTime, c % 8 === 0)
      const seg = st.segs[k]
      const local = seg ? seg.ref.counts.filter((x) => x <= t - seg.off + 1e-6).length - 1 : 0
      setCalling({ seg: k, count: local + 1, name: seg?.names[local] ?? '' })
    }
    if (!frame) {
      st.lostSince ??= t
      if (t - st.lostSince > LOST_AFTER_S) stopFor(null, 'lost')
      return
    }
    st.lostSince = null
    st.samples.push({ t: t - (st.segs[k]?.off ?? 0), frame })
    const s = st.detector?.push(t, frame)
    if (s) st.lastErrs = s.errs
    const m = st.detector?.check(t)
    if (m) stopFor(m)
  }, [finishSection, flowFrom, now, recordSeg, say, stopFor])

  // ---- the ghost: the routine's pose for "now" (the frozen target while paused) ----
  const overlay = useCallback((ctx: CanvasRenderingContext2D, people: Person[], dancerId: number | null) => {
    const st = S.current
    const all = st.all
    if (!all || st.phase === 'loading' || st.phase === 'done' || (st.phase === 'paused' && !st.target)) {
      ghost3d.current?.clear()
      return
    }
    const paused = st.phase === 'paused' && st.target
    const j = paused ? st.target!.j : Math.min(all.frames.length - 1, Math.max(0, Math.round(now() * all.fps)))
    const rf = all.frames[j]
    const me = people.find((p) => p.id === dancerId)
    const w = ctx.canvas.width
    const h = ctx.canvas.height
    const at = anchor(me, w, h)
    const mine = me ? normaliseFrame(me.body, w, h) : null
    // Limb colours: how close you are right now (while paused, to the frozen target).
    const md = mine ? boneDirs(mine) : null
    const rd = boneDirs(rf)
    const colours = BONES.map((_, i) => {
      if (i >= 8) return 'rgba(127,216,255,0.55)'
      let err: number | null = null
      if (paused || st.phase === 'watching') err = md?.[i] && rd[i] ? angle(md[i]!, rd[i]!) : null
      else if (st.phase === 'flowing') err = st.lastErrs[i] ?? null
      if (err === null) return 'rgba(127,216,255,0.6)'
      return err < 18 ? 'rgba(120,255,140,0.75)' : err < 32 ? 'rgba(255,200,60,0.75)' : 'rgba(255,90,90,0.85)'
    })
    if (ghostModeRef.current === '3d' && ghost3d.current) ghost3d.current.render(rf, st.world[j] ?? null, at, colours, w, h)
    else {
      ghost3d.current?.clear()
      drawBodyGhost(ctx, rf, at, colours)
    }
    // While paused: an arrow from your limb to where it should be.
    const bone = paused ? st.target!.bone : -1
    if (bone >= 0 && mine) {
      const [a, b] = BONES[bone]
      const myTip = mine[b]
      const myRoot = mine[a]
      const refA = rf[a]
      const refB = rf[b]
      if (myTip && myRoot && refA && refB) {
        const tx = at.x + (myRoot[0] + (refB[0] - refA[0])) * at.torso
        const ty = at.y + (myRoot[1] + (refB[1] - refA[1])) * at.torso
        const fx = at.x + myTip[0] * at.torso
        const fy = at.y + myTip[1] * at.torso
        if (Math.hypot(tx - fx, ty - fy) > at.torso * 0.15) drawArrow(ctx, fx, fy, tx, ty)
      }
    }
  }, [now])

  // The mistake snapshot: you (orange) beside the target (blue), at the moment it went wrong.
  useEffect(() => {
    const c = snapshot.current
    const all = S.current.all
    const m = pause?.m
    if (!c || !m || !all) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    const torso = c.height * 0.2
    drawPose(ctx, m.frame, { x: c.width * 0.27, y: c.height * 0.55, torso }, BONES.map((_, i) => (i === m.bone ? '#ff5a5a' : 'rgba(255,170,90,0.95)')), 6)
    drawPose(ctx, all.frames[m.j], { x: c.width * 0.73, y: c.height * 0.55, torso }, BONES.map((_, i) => (i === m.bone ? '#78ff8c' : 'rgba(127,216,255,0.95)')), 6)
    ctx.fillStyle = '#fff'
    ctx.font = '600 15px system-ui'
    ctx.fillText('You', c.width * 0.27 - 14, 20)
    ctx.fillText('Target', c.width * 0.73 - 22, 20)
  }, [pause])

  // Before starting, the video panel shows the start of the section.
  useEffect(() => {
    if (phase === 'ready') seek(0)
  }, [phase, seek, videoUrl])

  const begin = (from = 0, lead = 0.3, music = false, sp = speed) => {
    const st = S.current
    st.baseSpeed = sp
    st.speed = sp
    st.slowed = false
    st.stats = { clean: 0, pauses: 0 }
    st.segScores = []
    st.pausesAt = new Map()
    setNote(null)
    setCoachAnswer(null)
    flowFrom(from, lead, music)
  }

  const stop = () => {
    halt()
    setPhase('ready')
  }

  // "Watch it first": this step's 8-counts once, ghost and video together, no judging.
  const watch = () => {
    const st = S.current
    halt()
    st.speed = speed
    seek(0)
    play()
    setPhase('watching')
    const stepEnd = st.segs.filter((s) => step.eight_counts.includes(s.idx)).reduce((a, s) => Math.max(a, s.off + s.dur), 0) || st.end
    const id = window.setInterval(() => {
      if (S.current.phase !== 'watching' || now() >= stepEnd - 0.05) {
        window.clearInterval(id)
        if (S.current.phase === 'watching') stop()
      }
    }, 100)
  }

  // ---- mic sync: their own copy of the song starts the flow on the beat ----
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const syncToMusic = async () => {
    const all = S.current.all
    if (!all) return
    setSyncMsg('Listening… play the song out loud')
    try {
      const { pcm, endedAt } = await recordSnippet(6)
      setSyncMsg('Finding your place in the song…')
      const res = await api<{ position: number | null; confidence: number }>(`/api/routines/${routine.id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: pcm.buffer as ArrayBuffer,
      })
      if (res.position === null || res.confidence < 0.3) {
        setSyncMsg("Couldn't hear the song clearly. Turn it up, move closer, and try again.")
        return
      }
      const songNow = res.position + (performance.now() - endedAt) / 1000
      const delay = countInDelay(songNow, [S.current.secStart], (all.counts[1] - all.counts[0]) || 0.5)
      if (delay === null) {
        setSyncMsg('This part of the song has passed. Restart the song and press Sync again.')
        return
      }
      setSyncMsg(`Synced. Count-in in ${Math.round(delay)} s.`)
      begin(0, delay, true)
      window.setTimeout(() => setSyncMsg(null), delay * 1000 + 2000)
    } catch (e) {
      setSyncMsg(e instanceof Error && e.name === 'NotAllowedError' ? 'Microphone blocked: allow it in the browser to sync.' : "Sync didn't work this time. Use Start instead.")
    }
  }

  // ---- acting on what the learner says ----
  const skipAhead = () => {
    const st = S.current
    const seg = st.segs[pause?.seg ?? st.seg]
    const resumeAt = seg ? seg.off + (seg.ref.counts[pause?.count ?? 1] ?? seg.dur) : 0
    flowFrom(Math.min(resumeAt, Math.max(0, st.end - 0.5)))
  }
  // 1-based 8-count number → index into this section (current one if not given), -1 if not here.
  const segFor = (eightCount?: number) => {
    const st = S.current
    return eightCount === undefined ? pause?.seg ?? st.seg : st.segs.findIndex((x) => x.idx === eightCount - 1)
  }
  // Demo: play part of the routine slowly (video + ghost), then come back to where we were.
  const demo = (k: number, count?: number) => {
    const st = S.current
    const seg = st.segs[k]
    if (!seg) return
    const cs = seg.ref.counts
    const from = seg.off + (count ? cs[Math.max(0, count - 2)] ?? 0 : 0)
    const to = seg.off + (count ? cs[count + 1] ?? seg.dur : seg.dur)
    const back: Phase = st.phase === 'paused' ? 'paused' : 'ready'
    halt()
    const keep = st.speed
    st.speed = Math.min(keep, 0.5)
    seek(from)
    play()
    setPhase('watching')
    const id = window.setInterval(() => {
      if (S.current.phase !== 'watching' || now() >= to - 0.05) {
        window.clearInterval(id)
        const still = S.current.phase === 'watching'
        halt()
        st.speed = keep
        if (still) {
          seek(from)
          setPhase(back)
        }
      }
    }, 100)
  }
  // Freeze the ghost on one count's pose for the learner to copy; matching it redoes that 8-count.
  const showPose = (k: number, count = 1) => {
    const st = S.current
    const seg = st.segs[k]
    if (!seg || !st.all) return
    halt()
    const at = seg.off + (seg.ref.counts[count - 1] ?? 0)
    const j = Math.min(st.all.frames.length - 1, Math.round(at * st.all.fps))
    st.target = { frame: st.all.frames[j], j, bone: -1 }
    st.heldSince = null
    setHeld(false)
    seek(at)
    const name = seg.names[count - 1]
    setPause({ m: null, seg: k, count, headline: `Match count ${count}${name ? `: ${name}` : ''}`, fixes: ['Copy the ghost on the camera. Limbs go green as they match. Hold it and we go again.'], posing: true })
    setPhase('paused')
  }

  // Run what the coach (or a command) decided: settings at once; the move after it has spoken.
  const runActions = async (actions: Action[], spoken: Promise<void> | null) => {
    const st = S.current
    for (const a of actions) {
      if (a.type === 'speed') {
        st.speed = a.speed
        st.baseSpeed = a.speed
        st.slowed = false
        setSpeed(a.speed)
        if (video.current) video.current.playbackRate = a.speed
      } else if (a.type === 'strictness') setSensitivity(a.level)
    }
    const move = actions.find((a) => a.type !== 'speed' && a.type !== 'strictness')
    if (!move) return
    if (move.type === 'repeat_voice') {
      if (lastSaid) void speak(lastSaid)
      return
    }
    if (move.type === 'pause') {
      if (st.phase === 'flowing') stopFor(null, 'manual')
      return
    }
    if (move.type === 'stop') return stop()
    // Let the coach finish its sentence before the count-in starts (at most 6 s).
    if (spoken) await Promise.race([spoken, new Promise((r) => window.setTimeout(r, 6000))])
    const ph = S.current.phase
    if (move.type === 'redo') {
      if (ph === 'ready' || ph === 'done') begin(0, 0.3, false, st.speed)
      else if (ph === 'paused') redo()
      else flowFrom(st.segs[st.seg]?.off ?? 0)
    } else if (move.type === 'continue') {
      if (ph === 'paused') skipAhead()
      else if (ph === 'ready' || ph === 'done') begin(0, 0.3, false, st.speed)
    } else if (move.type === 'restart') begin(0, 0.3, false, st.speed)
    else if (move.type === 'goto' || move.type === 'demo' || move.type === 'show_pose') {
      const k = segFor(move.eight_count)
      if (k < 0) {
        void say(`8-count ${move.eight_count} isn't in this practice. Pick it on the lesson tree.`)
        return
      }
      if (move.type === 'goto') flowFrom(st.segs[k].off)
      else if (move.type === 'demo') demo(k, move.count)
      else showPose(k, move.count ?? pause?.count ?? 1)
    }
  }

  // Where the learner is, so the coach can answer about (and act on) the right thing.
  const practiceState = () => {
    const st = S.current
    const seg = st.segs[pause?.seg ?? st.seg]
    return {
      phase: st.phase,
      speed: st.speed,
      strictness: sensitivityRef.current,
      current_eight_count: seg ? seg.idx + 1 : null,
      section_eight_counts: st.segs.map((x) => x.idx + 1),
      moves_in_current_eight_count: seg?.names.map((n, i) => `${i + 1}: ${n || '-'}`) ?? [],
      paused_on: pause?.headline ?? null,
    }
  }

  // ---- ask the coach (typed or spoken) ----
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [listening, setListening] = useState(false)
  const [handsFree, setHandsFree] = useState(false)
  const recogniser = useRef<SpeechRecognitionLike | null>(null)
  const [coachAnswer, setCoachAnswer] = useState<(Answer & { instant?: boolean }) | null>(null)
  const [more, setMore] = useState<Answer | null>(null) // the coach agent's extra tips after an instant answer
  // "How do I fix it?": the instant steps straight away (audio already fetched), and the coach
  // agent's tips underneath when they arrive, without talking over the first answer.
  const fixIt = () => {
    if (!pause?.how) return
    setCoachAnswer({ answer: pause.how.steps.join(' '), actions: [], instant: true })
    void say(pause.how.spoken)
    void askCoach(`How do I fix this? ${pause.headline}. ${pause.fixes.join(' ')}`, true)
  }

  const askCoach = async (q: string, extra = false) => {
    q = q.trim()
    if (q.length < 2) return
    setMore(null)
    if (!extra) {
      // Clear commands ("slower", "again", "show me count 3") happen instantly, no network.
      const cmd = parseCommand(q, { speed: S.current.speed })
      if (cmd) {
        setQuestion('')
        setCoachAnswer(cmd.reply ? { answer: cmd.reply, actions: cmd.actions } : null)
        void runActions(cmd.actions, cmd.reply ? say(cmd.reply) : null)
        return
      }
      // A real question mid-flow: pause so they can listen.
      if (S.current.phase === 'flowing') stopFor(null, 'manual')
      setCoachAnswer(null)
    }
    setAsking(true)
    try {
      const m = pause?.m
      const ctx = pause?.m
        ? {
            paused_on: pause.headline,
            fixes: pause.fixes,
            eight_count: (S.current.segs[pause.seg]?.idx ?? 0) + 1,
            count: pause.count,
            ...(m ? {
              body_part: m.part,
              move_it: m.direction,
              timing: m.lag < -0.28 ? 'late' : m.lag > 0.12 ? 'early' : 'on time',
              speed_vs_routine: m.speedRatio === null ? null : m.speedRatio < 0.6 ? 'too small/slow' : m.speedRatio > 1.8 ? 'too fast' : 'fine',
            } : {}),
          }
        : null
      const r = await api<Answer>(`/api/routines/${routine.id}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, step_index: stepIndex, rep_context: ctx, state: practiceState() }),
      })
      r.actions = r.actions ?? []
      if (extra) {
        setMore(r)
        speak.prefetch(r.answer) // ready for 🔊
      } else {
        setCoachAnswer(r)
        setQuestion('')
        void runActions(r.actions, say(r.answer))
      }
    } catch {
      if (!extra) setCoachAnswer({ answer: "I didn't catch that. Try again in a moment.", actions: [] })
    } finally {
      setAsking(false)
    }
  }
  const askRef = useRef(askCoach)
  askRef.current = askCoach
  const Recognition = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition
  const listen = () => {
    if (!Recognition) return
    if (listening) {
      recogniser.current?.stop()
      return
    }
    const r = new Recognition()
    r.lang = 'en-GB'
    r.interimResults = true
    r.maxAlternatives = 1
    let finalText = ''
    r.onresult = (e) => {
      const text = Array.from(e.results).map((res) => res[0].transcript).join(' ')
      setQuestion(text)
      if (e.results[e.results.length - 1].isFinal) finalText = text
    }
    r.onend = () => {
      setListening(false)
      recogniser.current = null
      if (finalText.trim().length >= 2) void askCoach(finalText)
    }
    r.onerror = () => setListening(false)
    recogniser.current = r
    setListening(true)
    r.start()
  }

  // Hands-free: always listening, so "pause", "slower" or a question work mid-dance.
  // What the coach itself says is ignored (the mic would hear the speaker).
  const [heard, setHeard] = useState<string | null>(null)
  useEffect(() => {
    if (!handsFree || !Recognition) return
    let alive = true
    let r: SpeechRecognitionLike | null = null
    const startRec = () => {
      if (!alive) return
      r = new Recognition()
      r.lang = 'en-GB'
      r.interimResults = false
      r.maxAlternatives = 1
      r.continuous = true
      r.onresult = (e) => {
        const res = e.results[e.results.length - 1]
        if (!res.isFinal || speak.busy()) return
        const text = res[0].transcript.trim()
        if (text.length < 2) return
        setHeard(text)
        void askRef.current(text)
      }
      r.onerror = (e) => {
        if (e?.error === 'not-allowed') {
          alive = false
          setHandsFree(false)
        }
      }
      r.onend = () => { if (alive) window.setTimeout(startRec, 250) }
      r.start()
    }
    startRec()
    return () => {
      alive = false
      r?.stop()
    }
  }, [handsFree, Recognition, speak])

  const title = mode === 'routine' ? 'The whole routine'
    : scope === 'step' ? (step.type === 'chain' ? `Checkpoint: 8-counts ${step.eight_counts.map((i) => i + 1).join('+')}` : `8-count ${startIdx + 1}`)
      : `From 8-count ${startIdx + 1} to the end`
  const firstMoves = routine.eight_counts.find((e) => e.idx === startIdx)?.moves
  const segNo = (k: number) => (S.current.segs[k]?.idx ?? 0) + 1

  return (
    <section className="practice">
      <header className="practice-head">
        <button className="link" onClick={() => { halt(); onExit() }}>← Lesson tree</button>
        <h2>{title}</h2>
        <span className="chip">{speed}×</span>
        <button className="chip" onClick={() => setGhostMode((m) => (m === '3d' ? 'flat' : '3d'))} title="Switch the ghost between 3D and flat">
          👻 {ghostMode === '3d' ? '3D ghost' : 'Flat ghost'}
        </button>
        {Recognition && (
          <button className={`chip ${handsFree ? 'live' : ''}`} onClick={() => setHandsFree((h) => !h)} title='Talk to the coach while you dance: "pause", "slower", "show me count 3", or ask anything'>
            🎙 {handsFree ? 'Hands-free on' : 'Hands-free off'}
          </button>
        )}
        <button className="chip persona" onClick={() => setPersona((p) => (p === 'hype' ? 'calm' : 'hype'))} title="Switch coach voice">
          🎤 {persona === 'hype' ? 'Callum (cheeky)' : 'Laura (sassy)'}
        </button>
      </header>
      <div className="stage-row">
        <div className="stage">
          <PoseCam onFrame={onFrame} overlay={overlay} />
          <canvas ref={ghostCanvas} className="ghost3d" aria-hidden="true" />
          {countLabel && <div className="countin">{countLabel}</div>}
          {phase === 'flowing' && <div className="recording">● flowing · 8-count {segNo(calling?.seg ?? S.current.seg)}</div>}
          {phase === 'paused' && <div className="recording paused">❚❚ paused</div>}
          {phase === 'flowing' && calling && (
            <div className="caller">
              <b>{calling.count}</b> {calling.name}
            </div>
          )}
        </div>
        <div className="refpanel">
          {videoUrl ? <video ref={video} src={videoUrl} muted playsInline /> : <p className="notice">Loading the routine video…</p>}
          <span className="notice">The routine, in sync with you{speed < 1 ? ` (${speed}×)` : ''}</span>
        </div>
      </div>

      {note && <p className="notice flow-note">{note}</p>}
      {handsFree && heard && <p className="notice heard">🎙 heard: “{heard}”</p>}
      {syncMsg && <p className="notice sync-msg">{syncMsg}</p>}
      {phase === 'loading' && <p className="notice">Loading the routine…</p>}

      {phase === 'ready' && (
        <>
          {firstMoves?.length ? (
            <ol className="movelist" aria-label="The moves">
              {firstMoves.map((m) => <li key={m.count}><b>{m.count}</b>{m.name}</li>)}
            </ol>
          ) : null}
          <div className="controls">
            <button className="primary" onClick={() => begin()}>▶ Start flowing ({speed}×)</button>
            <button onClick={watch}>👀 Watch it first</button>
            {routine.beat_source === 'music' && (
              <button onClick={() => void syncToMusic()} disabled={speed !== 1 || (syncMsg?.startsWith('Listening') ?? false)} title={speed !== 1 ? 'Mic sync needs 1× (the song plays at normal speed)' : 'Play your own copy of the song; Shadow listens and starts on the beat'}>
                🎵 Sync to my music
              </button>
            )}
            <label>
              Speed{' '}
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
              </select>
            </label>
            <label>
              Stop me when{' '}
              <select value={sensitivity} onChange={(e) => setSensitivity(e.target.value as Sensitivity)}>
                <option value="relaxed">it's way off</option>
                <option value="normal">it's noticeably off</option>
                <option value="strict">anything's off</option>
              </select>
            </label>
            <label>
              Flow{' '}
              <select value={scope} onChange={(e) => setScope(e.target.value as 'end' | 'step')}>
                <option value="step">{mode === 'routine' ? 'just the first 8-count' : 'just this step'}</option>
                <option value="end">{mode === 'routine' ? 'the whole routine' : 'from here to the end'}</option>
              </select>
            </label>
          </div>
          <span className="notice">{scope === 'step'
            ? 'Dance this step with the video. I stop you only when something is noticeably off, show the fix, let you try it, then go again. One clean run with no stops passes the step.'
            : 'One continuous run with the video. I stop you only when something is noticeably off, show the fix, then we go again from that 8-count and on past it.'}</span>
        </>
      )}

      {(phase === 'flowing' || phase === 'countin' || phase === 'watching') && (
        <div className="controls">
          <button onClick={stop}>■ Stop</button>
          {phase === 'flowing' && <button onClick={() => stopFor(null, 'manual')}>❚❚ Pause</button>}
        </div>
      )}

      {phase === 'paused' && pause && (
        <div className="mistake">
          <h3>{pause.headline}{!pause.lost && <span className="notice"> · 8-count {segNo(pause.seg)}</span>}</h3>
          <ul className="fixes">
            {pause.fixes.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          {pause.posing && (
            <div className="mistake-row">
              {pause.m && <canvas ref={snapshot} width={420} height={260} className="snapshot" />}
              <div className={`try ${held ? 'ok' : ''}`}>
                {held ? <b>✓ That's it! Going again from count 1…</b> : <><b>Now you try:</b> get into the ghost's pose on the camera. Limbs go green when they match, and we'll go again.</>}
              </div>
            </div>
          )}
          {habit && <p className="habit">Pattern across your reps: <b>{habit}</b></p>}
          <div className="controls">
            <button className="primary" onClick={redo}>↻ Redo this 8-count</button>
            {pause.how && <button onClick={fixIt}>❓ How do I fix it?</button>}
            {lastSaid && <button onClick={() => void speak(lastSaid)} title="Hear the coach again">🔊 Hear it again</button>}
            <button onClick={() => demo(pause.seg, pause.count)}>👀 Show me slowly</button>
            <button onClick={skipAhead}>Skip ahead →</button>
            <button onClick={stop}>■ Stop</button>
          </div>
        </div>
      )}

      {phase === 'done' && summary && (
        <div className="feedback">
          <p className="cue">
            {summary.passed ? `✓ Step passed at ${speed}×! The next step is unlocked.`
              : scope === 'step' && summary.pauses > 0 ? `Made it through with ${summary.pauses} stop${summary.pauses === 1 ? '' : 's'}. One clean run without a stop passes the step.`
                : scope === 'step' && summary.relaxed ? 'Clean run! On "way off" it doesn\'t count as a pass. Switch to "noticeably off" to pass the step.'
                  : summary.pauses === 0 ? 'Flawless: straight through without a stop!' : `Made it to the end: ${summary.clean} clean 8-count${summary.clean === 1 ? '' : 's'}, ${summary.pauses} stop${summary.pauses === 1 ? '' : 's'}.`}
          </p>
          {summary.trickiest !== null && <p className="notice">Trickiest: 8-count {summary.trickiest + 1}.</p>}
          {habit && <p className="habit">Pattern across your reps: <b>{habit}</b></p>}
          <div className="controls">
            <button className="primary" onClick={() => begin()}>↻ Flow again</button>
            {lastSaid && <button onClick={() => void speak(lastSaid)} title="Hear the coach again">🔊 Hear it again</button>}
            {mode === 'step' && <button className={summary.passed ? 'primary' : ''} onClick={onNextStep}>Next step →</button>}
            <button onClick={() => { halt(); onExit() }}>Lesson tree</button>
          </div>
        </div>
      )}

      {(phase === 'paused' || phase === 'ready' || phase === 'done') && (
        <div className="ask">
          <form onSubmit={(e) => { e.preventDefault(); void askCoach(question) }}>
            <input placeholder={phase === 'paused' ? 'Ask what to change, e.g. "how high should my arm go?"' : 'Ask the coach, e.g. "am I lifting my arm high enough?"'} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} />
            {Recognition && (
              <button type="button" className={listening ? 'mic on' : 'mic'} onClick={listen} disabled={asking} title="Ask out loud">
                {listening ? '● Listening…' : '🎤 Speak'}
              </button>
            )}
            <button className="primary" disabled={asking || question.trim().length < 2}>{asking ? 'Thinking…' : 'Ask'}</button>
          </form>
          {coachAnswer && (
            <div className="coach-says">
              <p>
                🗣️ {coachAnswer.answer}{' '}
                <button className="link" onClick={() => void speak(coachAnswer.instant && pause?.how ? pause.how.spoken : coachAnswer.answer)} title="Hear it again">🔊</button>
              </p>
              {coachAnswer.instant && asking && <span className="notice">The coach is adding tips for you…</span>}
              {more && (
                <p className="more">
                  <b>More from the coach:</b> {more.answer}{' '}
                  <button className="link" onClick={() => say(more.answer)} title="Hear it">🔊</button>
                </p>
              )}
              {coachAnswer.actions.length > 0 && <span className="notice">Doing it: {coachAnswer.actions.map(describeAction).join(' → ')}</span>}
              {more && more.actions.length > 0 && (
                <button className="primary" onClick={() => void runActions(more.actions, null)}>Do it: {more.actions.map(describeAction).join(' → ')}</button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
