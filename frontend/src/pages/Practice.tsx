import { useCallback, useEffect, useRef, useState } from 'react'
import PoseCam, { type Frame as CamFrame, type Person } from '../pose/PoseCam'
import { useAuth } from '@clerk/clerk-react'
import { useApi, type Routine, type Step } from '../api'
import { BONES, angle, boneDirs, boneMask, normaliseFrame, refFrame, scoreRep, type Drill, type Frame, type RefData, type RepScore, type UserSample } from '../coach/score'
import { styleCue, styleFor } from '../coach/styles'

// The parts of the Web Speech API we use (not in TypeScript's DOM types everywhere).
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

type Phase = 'loading' | 'ready' | 'countin' | 'dancing' | 'feedback'
type Next = { action: 'practise' | 'next_step'; speed?: number; drill?: Drill; reason: string }
type Reference = { fps: number; start: number; end: number; counts: number[]; points: number[][][] }

const DRILL_LABEL: Record<Drill, string> = { full: 'Full move', freeze: 'Key-pose freezes', arms: 'Arms only', legs: 'Legs only', half: 'Toughest half' }

// Mid-rep rescue: if the learner is far off the routine for this long, stop and restart.
const LOST_AFTER_S = 2.5
const LOST_COST = 0.55

// The coach's voice: ElevenLabs audio (cached twice — server-side per line, and as object
// URLs here), falling back to the browser's built-in speech when it's unavailable.
const clipCache = new Map<string, string>()

function speakFallback(text: string, rate = 1.05) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = rate
  window.speechSynthesis.speak(u)
}

function makeSpeak(getToken: () => Promise<string | null>, persona: () => string) {
  return async (text: string, rate = 1.05) => {
    const key = `${persona()}|${text}`
    try {
      let url = clipCache.get(key)
      if (!url) {
        const token = await getToken()
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text, persona: persona() }),
        })
        if (!res.ok) throw new Error(String(res.status))
        url = URL.createObjectURL(await res.blob())
        clipCache.set(key, url)
      }
      await new Audio(url).play()
    } catch {
      speakFallback(text, rate)
    }
  }
}

function click(ac: AudioContext, at: number, accent: boolean) {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.frequency.value = accent ? 1320 : 880
  gain.gain.setValueAtTime(accent ? 0.5 : 0.3, at)
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.08)
  osc.connect(gain).connect(ac.destination)
  osc.start(at)
  osc.stop(at + 0.1)
}

// Where to draw a reference pose: anchored at the learner's mid-hip, scaled to their torso.
function anchor(person: Person | undefined, w: number, h: number) {
  const b = person?.body
  const seen = (i: number) => b && (b[i]?.visibility ?? 0) > 0
  if (!b || ![11, 12, 23, 24].every(seen)) return { x: w / 2, y: h * 0.55, torso: h * 0.22 }
  const hx = ((b[23].x + b[24].x) / 2) * w
  const hy = ((b[23].y + b[24].y) / 2) * h
  const sx = ((b[11].x + b[12].x) / 2) * w
  const sy = ((b[11].y + b[12].y) / 2) * h
  return { x: hx, y: hy, torso: Math.hypot(sx - hx, sy - hy) }
}

function drawPose(ctx: CanvasRenderingContext2D, f: Frame, at: { x: number; y: number; torso: number }, colours: (string | null)[], width: number) {
  ctx.lineCap = 'round'
  BONES.forEach(([a, b], i) => {
    const pa = f[a]
    const pb = f[b]
    const c = colours[i]
    if (!pa || !pb || !c) return
    ctx.strokeStyle = c
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(at.x + pa[0] * at.torso, at.y + pa[1] * at.torso)
    ctx.lineTo(at.x + pb[0] * at.torso, at.y + pb[1] * at.torso)
    ctx.stroke()
  })
}

// A solid, translucent body (torso, head, tapered limbs) — reads as a dancer, not a stick figure.
function drawBodyGhost(ctx: CanvasRenderingContext2D, f: Frame, at: { x: number; y: number; torso: number }, colours: (string | null)[]) {
  const P = (p: [number, number]) => [at.x + p[0] * at.torso, at.y + p[1] * at.torso] as const
  ctx.save()
  // torso
  const [ls, rs, rh, lh] = [f[11], f[12], f[24], f[23]]
  if (ls && rs && rh && lh) {
    ctx.beginPath()
    const pts = [ls, rs, rh, lh].map(P)
    ctx.moveTo(pts[0][0], pts[0][1])
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y)
    ctx.closePath()
    ctx.fillStyle = 'rgba(127,216,255,0.28)'
    ctx.strokeStyle = 'rgba(127,216,255,0.8)'
    ctx.lineWidth = at.torso * 0.05
    ctx.lineJoin = 'round'
    ctx.fill()
    ctx.stroke()
    // head
    if (f[0]) {
      const mid = P([(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2])
      const nose = P(f[0])
      const r = Math.max(8, Math.hypot(nose[0] - mid[0], nose[1] - mid[1]) * 0.55)
      ctx.beginPath()
      ctx.arc(nose[0], nose[1] + r * 0.35, r, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
    }
  }
  // limbs: thick near the body, slimmer at the tip
  BONES.forEach(([a, b], i) => {
    if (i >= 8) return
    const pa = f[a]
    const pb = f[b]
    const c = colours[i]
    if (!pa || !pb || !c) return
    const [x1, y1] = P(pa)
    const [x2, y2] = P(pb)
    ctx.strokeStyle = c
    ctx.lineCap = 'round'
    ctx.lineWidth = at.torso * (i % 2 === 0 ? 0.17 : 0.12) // upper limb thicker than fore-limb
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  })
  ctx.restore()
}

function drawArrow(ctx: CanvasRenderingContext2D, fx: number, fy: number, tx: number, ty: number) {
  const head = 14
  const ang = Math.atan2(ty - fy, tx - fx)
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.setLineDash([2, 8])
  ctx.beginPath()
  ctx.moveTo(fx, fy)
  ctx.lineTo(tx, ty)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(tx, ty)
  ctx.lineTo(tx - head * Math.cos(ang - 0.45), ty - head * Math.sin(ang - 0.45))
  ctx.lineTo(tx - head * Math.cos(ang + 0.45), ty - head * Math.sin(ang + 0.45))
  ctx.closePath()
  ctx.fill()
}

export default function Practice({ routine, stepIndex, step, onExit, onNextStep }: {
  routine: Routine
  stepIndex: number
  step: Step
  onExit: () => void
  onNextStep: () => void
}) {
  const api = useApi()
  const [phase, setPhase] = useState<Phase>('loading')
  const [speed, setSpeed] = useState(step.start_speed)
  const [drill, setDrill] = useState<Drill>('full')
  const [result, setResult] = useState<RepScore | null>(null)
  const [next, setNext] = useState<Next | null>(null)
  const [habit, setHabit] = useState<string | null>(null)
  const [countLabel, setCountLabel] = useState('')
  const ref = useRef<RefData | null>(null)
  const session = useRef<string | null>(null)
  const clock = useRef({ start: 0, speed: 1, phase: 'loading' as Phase, drill: 'full' as Drill })
  // Which half the 'half' drill uses (1 or 2), set from the last result's worst count.
  const half = useRef<1 | 2 | null>(null)
  const samples = useRef<UserSample[]>([])
  const dancerRef = useRef<Person | undefined>(undefined)
  const audio = useRef<AudioContext | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const refVideo = useRef<HTMLVideoElement>(null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [listening, setListening] = useState(false)
  const recogniser = useRef<SpeechRecognitionLike | null>(null)
  const [coachAnswer, setCoachAnswer] = useState<{ answer: string; drill: { drill: Drill; speed: number; reason: string } | null } | null>(null)
  const lostSince = useRef<number | null>(null)
  const style = styleFor(routine.style)
  const { getToken } = useAuth()
  const [persona, setPersona] = useState<'calm' | 'hype'>('hype')
  const personaRef = useRef(persona)
  personaRef.current = persona
  const speak = useRef(makeSpeak(getToken, () => personaRef.current)).current
  const replay = useRef<HTMLCanvasElement>(null)
  clock.current.phase = phase

  // The original (silent) routine video, for the side-by-side preview.
  useEffect(() => {
    let url: string | null = null
    api<Response>(`/api/routines/${routine.id}/video`, {}).catch(() => null) // warm auth; real fetch below
    ;(async () => {
      try {
        const token = await getToken()
        const res = await fetch(`/api/routines/${routine.id}/video`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        url = URL.createObjectURL(await res.blob())
        setVideoUrl(url)
      } catch { /* no preview */ }
    })()
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [api, getToken, routine.id])

  // Segment of the original video this step covers (for preview looping / sync).
  const seg = (() => {
    const ecs = routine.eight_counts.filter((e) => step.eight_counts.includes(e.idx))
    return { start: Math.min(...ecs.map((e) => e.start_s)), end: Math.max(...ecs.map((e) => e.end_s)) }
  })()

  // Load the reference for every 8-count in this step and join them into one timeline.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const refs = await Promise.all(step.eight_counts.map((i) => api<Reference>(`/api/routines/${routine.id}/eight-counts/${i}/reference`)))
      const s = await api<{ id: string }>(`/api/routines/${routine.id}/sessions`, { method: 'POST' })
      if (cancelled) return
      const frames: Frame[] = []
      const counts: number[] = []
      const hits: number[] = []
      let offset = 0
      refs.forEach((r, k) => {
        frames.push(...r.points.map(refFrame))
        counts.push(...r.counts.map((c) => c - r.start + offset))
        const ec = routine.eight_counts.find((e) => e.idx === step.eight_counts[k])
        hits.push(...(ec?.key_moments ?? []).filter((m) => m.type === 'hit').map((m) => m.t - r.start + offset))
        offset += r.points.length / r.fps
      })
      let data = { frames, fps: refs[0]?.fps ?? 30, counts, hits }
      // The "toughest half" drill: only the first or second half of the step's counts.
      if (drill === 'half') {
        const mid = counts[Math.floor(counts.length / 2)] ?? 0
        const useFirst = (half.current ?? 1) === 1
        const from = useFirst ? 0 : Math.round(mid * data.fps)
        const to = useFirst ? Math.round(mid * data.fps) : frames.length
        data = {
          fps: data.fps,
          frames: frames.slice(from, to),
          counts: counts.filter((c) => (useFirst ? c < mid : c >= mid)).map((c) => c - (useFirst ? 0 : mid)),
          hits: hits.filter((h) => (useFirst ? h < mid : h >= mid)).map((h) => h - (useFirst ? 0 : mid)),
        }
      }
      ref.current = data
      session.current = s.id
      setPhase('ready')
    })().catch(() => !cancelled && setPhase('ready'))
    return () => {
      cancelled = true
    }
  }, [api, routine, step, drill])

  // Preview video behaviour: loop the step while getting ready; play in sync during the rep.
  useEffect(() => {
    const v = refVideo.current
    if (!v || !videoUrl) return
    v.playbackRate = Math.min(Math.max(speed, 0.25), 1)
    if (phase === 'ready' || phase === 'feedback') {
      v.currentTime = seg.start
      void v.play()
      const loop = window.setInterval(() => { if (v.currentTime >= seg.end - 0.05) v.currentTime = seg.start }, 120)
      return () => window.clearInterval(loop)
    }
    if (phase === 'dancing') {
      v.currentTime = seg.start
      void v.play()
      const stop = window.setInterval(() => { if (v.currentTime >= seg.end - 0.05) v.pause() }, 120)
      return () => window.clearInterval(stop)
    }
    v.pause()
  }, [phase, videoUrl, speed, seg.start, seg.end])

  const askCoach = async (spoken?: string) => {
    const q = (spoken ?? question).trim()
    if (q.length < 2 || !session.current) return
    setAsking(true)
    setCoachAnswer(null)
    try {
      const repCtx = result ? { similarity: result.similarity, shape: result.shape, timing: result.timing, dynamics: result.dynamics, top_fault: result.topFault, notes: result.notes, per_count: result.perCount } : null
      const r = await api<{ answer: string; drill: { drill: Drill; speed: number; reason: string } | null }>(`/api/routines/${routine.id}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, step_index: stepIndex, rep_context: repCtx }),
      })
      setCoachAnswer(r)
      setQuestion('')
      void speak(r.answer)
    } catch {
      setCoachAnswer({ answer: "I didn't catch that — try again in a moment.", drill: null })
    } finally {
      setAsking(false)
    }
  }

  // Spoken questions: the browser's own speech recognition (Chrome/Edge/Safari), so no extra service.
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

  const start = useCallback(() => {
    const r = ref.current
    if (!r || !r.frames.length) return
    const ac = (audio.current ??= new AudioContext())
    const beat = (r.counts[1] - r.counts[0] || 0.5) / speed // real seconds per count
    const t0 = ac.currentTime + 0.3
    // Count-in: "5, 6, 7, 8" on the beat, then the rep starts on "1".
    ;['5', '6', '7', '8'].forEach((n, k) => {
      click(ac, t0 + k * beat, k === 0)
      window.setTimeout(() => {
        setCountLabel(n)
        speakFallback(n, 1.3) // counts must land on the beat; no network in the loop
      }, (0.3 + k * beat) * 1000)
    })
    const repStartIn = 0.3 + 4 * beat
    // Click track for the rep, accented on each "1".
    r.counts.forEach((c, k) => click(ac, t0 + 4 * beat + c / speed, k % 8 === 0))
    samples.current = []
    setResult(null)
    setNext(null)
    setPhase('countin')
    window.setTimeout(() => {
      clock.current = { ...clock.current, start: performance.now(), speed, drill }
      setCountLabel('')
      setPhase('dancing')
    }, repStartIn * 1000)
  }, [speed, drill])

  const finish = useCallback(async (lost = false) => {
    const r = ref.current!
    const score = scoreRep(samples.current, r, drill, {
      weights: style.weights,
      tauMs: style.tauMs,
      watched: style.watched,
      vocabulary: (f) => styleCue(style, f),
    })
    score.lost = lost
    if (lost) score.cue = "You got lost — no stress. Let's take it from the top."
    half.current = score.worstCount <= Math.ceil(score.perCount.length / 2) ? 1 : 2
    setResult(score)
    setPhase('feedback')
    void speak(score.cue)
    if (!session.current) return
    try {
      const res = await api<{ passed: boolean; next: Next; habit: string | null }>(`/api/routines/${routine.id}/sessions/${session.current}/reps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step_index: stepIndex,
          eight_counts: step.eight_counts,
          speed,
          drill,
          similarity: score.similarity,
          shape: score.shape,
          timing: score.timing,
          per_count: score.perCount,
          timing_bias_ms: score.timingBiasMs,
          top_fault: score.topFault,
        }),
      })
      setNext(res.next)
      setHabit(res.habit)
    } catch {
      /* offline: still show the score */
    }
  }, [api, drill, routine.id, speed, step.eight_counts, stepIndex])

  // Record the dancer each frame during a rep; end the rep when the reference runs out.
  const onFrame = useCallback(
    (f: CamFrame) => {
      const me = f.people.find((p) => p.id === f.dancerId)
      dancerRef.current = me
      const c = clock.current
      if (c.phase !== 'dancing' || !ref.current) return
      const t = ((performance.now() - c.start) / 1000) * c.speed
      const dur = ref.current.frames.length / ref.current.fps
      if (t >= dur) {
        clock.current.phase = 'feedback'
        void finish()
        return
      }
      const v = document.querySelector<HTMLVideoElement>('.posecam video')
      if (me && v) {
        const frame = normaliseFrame(me.body, v.videoWidth, v.videoHeight) as Frame
        samples.current.push({ t, frame })
        // Completely lost? (way off the routine for a sustained stretch, past the first count)
        const r = ref.current
        const j = Math.min(r.frames.length - 1, Math.round(t * r.fps))
        const ud = frame ? boneDirs(frame) : null
        const rd = boneDirs(r.frames[j])
        let cost = 0
        let n = 0
        if (ud) ud.forEach((u, b) => { const rb = rd[b]; if (u && rb && b < 8) { cost += 1 - (u[0] * rb[0] + u[1] * rb[1]); n++ } })
        const off = n >= 4 ? cost / n : 0
        const firstCount = r.counts[1] ?? 0.5
        if (t > firstCount && off > LOST_COST) {
          lostSince.current ??= t
          if (t - lostSince.current > LOST_AFTER_S) {
            clock.current.phase = 'feedback'
            lostSince.current = null
            void finish(true)
            return
          }
        } else lostSince.current = null
      }
    },
    [finish],
  )

  // The ghost: the reference pose for "now", drawn on the learner, each limb coloured by how close they are.
  const overlay = useCallback((ctx: CanvasRenderingContext2D, people: Person[], dancerId: number | null) => {
    const r = ref.current
    const c = clock.current
    if (!r || !(c.phase === 'dancing' || c.phase === 'countin' || c.phase === 'ready')) return
    let t = c.phase === 'dancing' ? ((performance.now() - c.start) / 1000) * c.speed : 0
    if (c.drill === 'freeze') {
      // Hold each count's key shape instead of flowing between them.
      const k = Math.max(0, r.counts.findIndex((x) => x > t) - 1)
      t = r.counts[k === -1 ? r.counts.length - 1 : k] ?? 0
    }
    const j = Math.min(r.frames.length - 1, Math.max(0, Math.round(t * r.fps)))
    const rf = r.frames[j]
    const me = people.find((p) => p.id === dancerId)
    const w = ctx.canvas.width
    const h = ctx.canvas.height
    const at = anchor(me, w, h)
    const mask = boneMask(c.drill)
    const mine = me ? normaliseFrame(me.body, w, h) : null
    const md = mine ? boneDirs(mine) : null
    const rd = boneDirs(rf)
    let worstBone = -1
    let worstErr = 25 // only point an arrow at genuinely wrong limbs
    const colours = BONES.map((_, i) => {
      if (!mask[i]) return 'rgba(127,216,255,0.12)'
      const a = md?.[i]
      const b = rd[i]
      if (!a || !b || i >= 8) return 'rgba(127,216,255,0.55)'
      const err = angle(a, b)
      if (err > worstErr && c.phase === 'dancing') { worstErr = err; worstBone = i }
      return err < 15 ? 'rgba(120,255,140,0.75)' : err < 30 ? 'rgba(255,200,60,0.75)' : 'rgba(255,90,90,0.8)'
    })
    drawBodyGhost(ctx, rf, at, colours)
    // The arrow: from where your limb's tip is to where the routine wants it.
    if (worstBone >= 0 && mine) {
      const [a, b] = BONES[worstBone]
      const myTip = mine[b]
      const refA = rf[a]
      const refB = rf[b]
      const myRoot = mine[a]
      if (myTip && myRoot && refA && refB) {
        // Target: the reference bone re-rooted at YOUR joint, so the arrow shows pure direction change.
        const tx = at.x + (myRoot[0] + (refB[0] - refA[0])) * at.torso
        const ty = at.y + (myRoot[1] + (refB[1] - refA[1])) * at.torso
        const fx = at.x + myTip[0] * at.torso
        const fy = at.y + myTip[1] * at.torso
        const len = Math.hypot(tx - fx, ty - fy)
        if (len > at.torso * 0.18) drawArrow(ctx, fx, fy, tx, ty)
      }
    }
  }, [])

  // Replay of the worst count: the learner (orange) beside the reference (blue), looping at half speed.
  useEffect(() => {
    if (phase !== 'feedback' || !result || !replay.current || !ref.current) return
    const r = ref.current
    const canvas = replay.current
    const ctx = canvas.getContext('2d')!
    const from = r.counts[result.worstCount - 1] ?? 0
    const to = r.counts[result.worstCount] ?? r.frames.length / r.fps
    const mine = samples.current.filter((s) => s.t >= from && s.t <= to && s.frame)
    let raf = 0
    const t0 = performance.now()
    const draw = () => {
      const t = from + ((((performance.now() - t0) / 1000) * 0.5) % Math.max(0.1, to - from))
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const rf = r.frames[Math.min(r.frames.length - 1, Math.round(t * r.fps))]
      const all = BONES.map(() => '#7fd8ff')
      drawPose(ctx, rf, { x: canvas.width * 0.72, y: canvas.height * 0.55, torso: canvas.height * 0.2 }, all, 5)
      const u = mine.reduce<UserSample | null>((best, s) => (!best || Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best), null)
      if (u?.frame) drawPose(ctx, u.frame, { x: canvas.width * 0.28, y: canvas.height * 0.55, torso: canvas.height * 0.2 }, BONES.map(() => '#ffb347'), 5)
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [phase, result])

  const applyNext = () => {
    if (!next) return
    if (next.action === 'next_step') return onNextStep()
    if (next.speed) setSpeed(next.speed)
    if (next.drill) setDrill(next.drill)
    setPhase('ready')
  }

  const title = step.type === 'chain' ? `Checkpoint ${step.eight_counts.map((i) => i + 1).join('+')}` : `8-count ${step.eight_counts[0] + 1}`
  return (
    <section className="practice">
      <header className="practice-head">
        <button className="link" onClick={onExit}>← Lesson tree</button>
        <h2>{title}</h2>
        <span className="chip">{speed}× · {DRILL_LABEL[drill]}</span>
        <button className="chip persona" onClick={() => setPersona((p) => (p === 'hype' ? 'calm' : 'hype'))} title="Switch coach voice">
          🎤 {persona === 'hype' ? 'Callum (cheeky)' : 'Laura (sassy)'}
        </button>
      </header>
      <div className="stage-row">
        <div className="stage">
          <PoseCam onFrame={onFrame} overlay={overlay} />
          {countLabel && <div className="countin">{countLabel}</div>}
          {phase === 'dancing' && <div className="recording">● dancing</div>}
        </div>
        {videoUrl && (
          <div className="refpanel">
            <video ref={refVideo} src={videoUrl} muted playsInline loop={false} />
            <span className="notice">The routine (your upload, muted{speed < 1 ? `, at ${Math.min(Math.max(speed, 0.25), 1)}×` : ''})</span>
          </div>
        )}
      </div>

      {phase === 'loading' && <p className="notice">Loading the routine…</p>}
      {phase === 'ready' && (
        <div className="controls">
          <button className="primary" onClick={start}>Start ({speed}×)</button>
          <label>
            Speed{' '}
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {[0.25, 0.5, 0.75, 1].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
          <span className="notice">Stand back so your whole body is in frame. The blue ghost shows the move; limbs turn green when you match.</span>
        </div>
      )}
      {phase === 'feedback' && result && (
        <div className="feedback">
          <div className="score">
            <span className={`big ${result.similarity >= 80 ? 'pass' : ''}`}>{result.similarity}</span>
            <span className="notice">shape {result.shape}{result.timing !== null ? ` · timing ${result.timing}` : ''}{result.dynamics !== null ? ` · energy ${result.dynamics}` : ''}{result.timingBiasMs && Math.abs(result.timingBiasMs) > 60 ? ` · ${result.timingBiasMs > 0 ? 'a little late' : 'a little early'}` : ''}</span>
          </div>
          <p className="cue">“{result.cue}”</p>
          {habit && <p className="habit">Pattern spotted across your reps: <b>{habit}</b></p>}
          {result.notes.length > 0 && (
            <ul className="rep-notes">
              {result.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
          <div className="counts">
            {result.perCount.map((s, k) => (
              <span key={k} className={`count ${s >= 80 ? 'good' : s >= 60 ? 'ok' : 'bad'} ${k + 1 === result.worstCount ? 'worst' : ''}`} title={`count ${k + 1}: ${s}`}>
                {(k % 8) + 1}
              </span>
            ))}
          </div>
          <div className="replay">
            <canvas ref={replay} width={560} height={300} />
            <span className="notice">Count {result.worstCount}, half speed: you (orange) vs the routine (blue)</span>
          </div>
          <div className="controls">
            {next && <button className="primary" onClick={applyNext}>{next.action === 'next_step' ? 'Next step →' : `Next: ${next.speed}× · ${DRILL_LABEL[next.drill ?? 'full']}`}</button>}
            <button onClick={() => setPhase('ready')}>Again</button>
            {next && <span className="notice">{next.reason}</span>}
          </div>
        </div>
      )}
      {(phase === 'feedback' || phase === 'ready') && (
        <div className="ask">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void askCoach()
            }}
          >
            <input placeholder='Ask the coach — "am I lifting my arm high enough?", "I can&apos;t get the spin"' value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} />
            {Recognition && (
              <button type="button" className={listening ? 'mic on' : 'mic'} onClick={listen} disabled={asking} title="Ask out loud">
                {listening ? '● Listening…' : '🎤 Speak'}
              </button>
            )}
            <button className="primary" disabled={asking || question.trim().length < 2}>{asking ? 'Thinking…' : 'Ask'}</button>
          </form>
          {coachAnswer && (
            <div className="coach-says">
              <p>🗣️ {coachAnswer.answer}</p>
              {coachAnswer.drill && (
                <button
                  className="primary"
                  onClick={() => {
                    setSpeed(coachAnswer.drill!.speed)
                    setDrill(coachAnswer.drill!.drill)
                    setCoachAnswer(null)
                    setPhase('ready')
                  }}
                >
                  Try it: {coachAnswer.drill.speed}× · {DRILL_LABEL[coachAnswer.drill.drill]} — {coachAnswer.drill.reason}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
