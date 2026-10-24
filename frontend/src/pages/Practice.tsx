import { useCallback, useEffect, useRef, useState } from 'react'
import PoseCam, { type Frame as CamFrame, type Person } from '../pose/PoseCam'
import { useApi, type Routine, type Step } from '../api'
import { BONES, angle, boneDirs, boneMask, normaliseFrame, refFrame, scoreRep, type Drill, type Frame, type RefData, type RepScore, type UserSample } from '../coach/score'
import { styleCue, styleFor } from '../coach/styles'

type Phase = 'loading' | 'ready' | 'countin' | 'dancing' | 'feedback'
type Next = { action: 'practise' | 'next_step'; speed?: number; drill?: Drill; reason: string }
type Reference = { fps: number; start: number; end: number; counts: number[]; points: number[][][] }

const DRILL_LABEL: Record<Drill, string> = { full: 'Full move', freeze: 'Key-pose freezes', arms: 'Arms only', legs: 'Legs only', half: 'Toughest half' }

// Mid-rep rescue: if the learner is far off the routine for this long, stop and restart.
const LOST_AFTER_S = 2.5
const LOST_COST = 0.55

// Temporary voice: the browser's built-in speech. ElevenLabs/Kokoro cached clips replace this.
function speak(text: string, rate = 1.05) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = rate
  window.speechSynthesis.speak(u)
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
  const [countLabel, setCountLabel] = useState('')
  const ref = useRef<RefData | null>(null)
  const session = useRef<string | null>(null)
  const clock = useRef({ start: 0, speed: 1, phase: 'loading' as Phase, drill: 'full' as Drill })
  // Which half the 'half' drill uses (1 or 2), set from the last result's worst count.
  const half = useRef<1 | 2 | null>(null)
  const samples = useRef<UserSample[]>([])
  const dancerRef = useRef<Person | undefined>(undefined)
  const audio = useRef<AudioContext | null>(null)
  const lostSince = useRef<number | null>(null)
  const style = styleFor(routine.style)
  const replay = useRef<HTMLCanvasElement>(null)
  clock.current.phase = phase

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
        speak(n, 1.3)
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
    speak(score.cue)
    if (!session.current) return
    try {
      const res = await api<{ passed: boolean; next: Next }>(`/api/routines/${routine.id}/sessions/${session.current}/reps`, {
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
      if (!mask[i]) return 'rgba(127,216,255,0.15)'
      const a = md?.[i]
      const b = rd[i]
      if (!a || !b || i >= 8) return 'rgba(127,216,255,0.75)'
      const err = angle(a, b)
      if (err > worstErr && c.phase === 'dancing') { worstErr = err; worstBone = i }
      return err < 15 ? 'rgba(120,255,140,0.9)' : err < 30 ? 'rgba(255,200,60,0.9)' : 'rgba(255,90,90,0.9)'
    })
    drawPose(ctx, rf, at, colours, Math.max(6, at.torso * 0.09))
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
      </header>
      <div className="stage">
        <PoseCam onFrame={onFrame} overlay={overlay} />
        {countLabel && <div className="countin">{countLabel}</div>}
        {phase === 'dancing' && <div className="recording">● dancing</div>}
      </div>

      {phase === 'loading' && <p className="notice">Loading the routine…</p>}
      {phase === 'ready' && (
        <div className="controls">
          <button className="primary" onClick={start}>Start ({speed}×)</button>
          <label>
            Speed{' '}
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {[0.5, 0.75, 1].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
          <span className="notice">Stand back so your whole body is in frame. The blue ghost shows the move; limbs turn green when you match.</span>
        </div>
      )}
      {phase === 'feedback' && result && (
        <div className="feedback">
          <div className="score">
            <span className={`big ${result.similarity >= 80 ? 'pass' : ''}`}>{result.similarity}</span>
            <span className="notice">shape {result.shape}{result.timing !== null ? ` · timing ${result.timing}` : ''}{result.dynamics !== null ? ` · energy ${result.dynamics}` : ''}{result.timingBiasMs ? ` · ${Math.abs(result.timingBiasMs)} ms ${result.timingBiasMs > 0 ? 'late' : 'early'}` : ''}</span>
          </div>
          <p className="cue">“{result.cue}”</p>
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
    </section>
  )
}
