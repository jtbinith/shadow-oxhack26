// Live mistake detection for the continuous flow: every camera frame is compared with the
// routine, allowing a little lag (people follow a beat behind), and a mistake is called only
// when it is sustained over a window — a noticeable, repeated error, not one bad frame.
//
// A mistake says what to fix in plain words: which body part, which way to move it
// (position), and whether the learner is late / early or moving too small / slow (speed).
import { BONE_PART, angle, boneDirs, directionWords, type Frame, type RefData } from './score'

export type Sensitivity = 'relaxed' | 'normal' | 'strict'
// Degrees of limb-direction error, averaged over the window: one limb this far off, or the
// limbs on average this far off, stops the flow.
export const THRESHOLDS: Record<Sensitivity, { bone: number; mean: number }> = {
  relaxed: { bone: 50, mean: 36 },
  normal: { bone: 40, mean: 28 },
  strict: { bone: 32, mean: 22 },
}
// Matching the frozen target pose while paused: fixed, so a stricter stop setting doesn't make it harder.
const HOLD = { bone: 22, mean: 25 }
const LAG_BACK_S = 0.4 // how far behind the routine we still look for a match
const LAG_FWD_S = 0.15
const LATE_S = 0.28 // consistently this far behind = "late"
const EARLY_S = 0.12
const TIPS = [15, 16, 27, 28]
const LIMBS = 8

export type LiveSample = {
  t: number // seconds into the section
  j: number // best-matching reference frame
  lag: number // reference time minus now (negative = learner behind)
  errs: (number | null)[] // per limb, degrees, at the best match
  frame: Frame
  speed: number | null // learner's hand/foot speed, torso lengths per second
  refSpeed: number
}

export type Mistake = {
  kind: 'shape' | 'late' | 'early' | 'small'
  t: number
  j: number // reference frame to freeze on (the target pose)
  bone: number // worst limb (BONES index), -1 for pure timing
  part: string // "right arm"
  direction: string // "higher and out wider"
  err: number // degrees (not shown to the learner)
  lag: number // seconds (negative = late)
  speedRatio: number | null // learner speed / routine speed
  frame: Frame // the learner's pose at that moment
}

function tipSpeed(a: Frame, b: Frame, dt: number): number | null {
  let s = 0
  let n = 0
  for (const k of TIPS) {
    const p = a[k]
    const q = b[k]
    if (p && q) {
      s += Math.hypot(q[0] - p[0], q[1] - p[1])
      n++
    }
  }
  return n >= 2 && dt > 0 ? s / n / dt : null
}

export class MistakeDetector {
  private samples: LiveSample[] = []
  private refDirs: ReturnType<typeof boneDirs>[]
  private refSpeed: number[]
  private graceUntil = 0

  private ref: RefData
  private opts: { sensitivity: Sensitivity; mask: boolean[]; windowS: number }

  constructor(ref: RefData, opts: { sensitivity: Sensitivity; mask: boolean[]; windowS: number }) {
    this.ref = ref
    this.opts = { ...opts }
    this.refDirs = ref.frames.map(boneDirs)
    this.refSpeed = ref.frames.map((f, i) => (i ? tipSpeed(ref.frames[i - 1], f, 1 / ref.fps) ?? 0 : 0))
  }

  set sensitivity(s: Sensitivity) {
    this.opts.sensitivity = s
  }

  /** Forget the window (after a pause / restart); no mistakes are called before `graceUntil`. */
  reset(graceUntil: number) {
    this.samples = []
    this.graceUntil = graceUntil
  }

  /** Best-matching reference frame near time t, with per-limb errors. */
  match(frame: Frame, t: number): { j: number; errs: (number | null)[]; cost: number } | null {
    const ud = boneDirs(frame)
    const fps = this.ref.fps
    const from = Math.max(0, Math.round((t - LAG_BACK_S) * fps))
    const to = Math.min(this.ref.frames.length - 1, Math.round((t + LAG_FWD_S) * fps))
    let best: { j: number; errs: (number | null)[]; cost: number } | null = null
    for (let j = from; j <= to; j++) {
      const rd = this.refDirs[j]
      const errs: (number | null)[] = []
      let sum = 0
      let n = 0
      for (let b = 0; b < LIMBS; b++) {
        const u = ud[b]
        const r = rd[b]
        if (!this.opts.mask[b] || !u || !r) {
          errs.push(null)
          continue
        }
        const e = angle(u, r)
        errs.push(e)
        sum += e
        n++
      }
      if (n < 3) continue
      // Prefer being on time: a small penalty for each frame of lag, so ties go to "now".
      const cost = sum / n + 4 * Math.abs(j / fps - t)
      if (!best || cost < best.cost) best = { j, errs, cost }
    }
    return best
  }

  push(t: number, frame: Frame | null): LiveSample | null {
    if (!frame) return null
    const m = this.match(frame, t)
    if (!m) return null
    const prev = this.samples[this.samples.length - 1]
    const s: LiveSample = {
      t,
      j: m.j,
      lag: m.j / this.ref.fps - t,
      errs: m.errs,
      frame,
      speed: prev ? tipSpeed(prev.frame, frame, t - prev.t) : null,
      refSpeed: this.refSpeed[m.j] ?? 0,
    }
    this.samples.push(s)
    while (this.samples.length && this.samples[0].t < t - this.opts.windowS) this.samples.shift()
    return s
  }

  /** How close the window is to a stop: 0 = dancing well, 1 = at the threshold (a stop). */
  pressure(t: number): number {
    if (t < this.graceUntil) return 0
    const w = this.samples
    if (w.length < 8) return 0
    const th = THRESHOLDS[this.opts.sensitivity]
    let worst = 0
    let sum = 0
    let n = 0
    for (let b = 0; b < LIMBS; b++) {
      const v = w.map((s) => s.errs[b]).filter((e): e is number => e !== null)
      if (v.length < w.length / 2) continue
      const m = v.reduce((a, c) => a + c, 0) / v.length
      worst = Math.max(worst, m)
      sum += m
      n++
    }
    if (n < 3) return 0
    return Math.min(1, Math.max(worst / th.bone, sum / n / th.mean))
  }

  /** A sustained mistake over the window, or null. */
  check(t: number): Mistake | null {
    if (t < this.graceUntil) return null
    const w = this.samples
    if (w.length < 8 || w[w.length - 1].t - w[0].t < 0.7 * this.opts.windowS) return null
    const th = THRESHOLDS[this.opts.sensitivity]
    // Per-limb mean error over the window.
    const mean = Array.from({ length: LIMBS }, (_, b) => {
      const v = w.map((s) => s.errs[b]).filter((e): e is number => e !== null)
      return v.length >= w.length / 2 ? v.reduce((a, c) => a + c, 0) / v.length : null
    })
    const seen = mean.filter((e): e is number => e !== null)
    if (seen.length < 3) return null
    const meanAll = seen.reduce((a, c) => a + c, 0) / seen.length
    let bone = -1
    mean.forEach((e, b) => {
      if (e !== null && (bone < 0 || e > (mean[bone] ?? 0))) bone = b
    })
    const lag = w.reduce((a, s) => a + s.lag, 0) / w.length
    const moving = w.filter((s) => s.speed !== null && s.refSpeed > 0.6)
    const speedRatio = moving.length >= 5 ? moving.reduce((a, s) => a + (s.speed ?? 0), 0) / moving.reduce((a, s) => a + s.refSpeed, 0) : null

    const shapeWrong = (mean[bone] ?? 0) > th.bone || meanAll > th.mean
    const kind: Mistake['kind'] | null = shapeWrong
      ? 'shape'
      : lag < -LATE_S
        ? 'late'
        : lag > EARLY_S
          ? 'early'
          : speedRatio !== null && speedRatio < 0.4
            ? 'small'
            : null
    if (!kind) return null
    // Freeze on the moment the worst limb was furthest off.
    let worst = w[w.length - 1]
    for (const s of w) if ((s.errs[bone] ?? -1) > (worst.errs[bone] ?? -1)) worst = s
    const ud = boneDirs(worst.frame)[bone]
    const rd = this.refDirs[worst.j][bone]
    const err = mean[bone] ?? 0
    const direction = ud && rd ? directionWords(bone, rd[0] - ud[0], rd[1] - ud[1], err) : 'sharper'
    return {
      kind,
      t: worst.t,
      j: worst.j,
      bone: kind === 'shape' ? bone : -1,
      part: BONE_PART[bone].replace('_', ' '),
      direction,
      err,
      lag,
      speedRatio,
      frame: worst.frame,
    }
  }
}

/** What to say and show when the flow pauses: a headline and up to three concrete fixes.
 * Body part, direction (position), timing and speed — never degrees or milliseconds. */
export function describe(m: Mistake, count: number): { headline: string; fixes: string[]; spoken: string } {
  const fixes: string[] = []
  const Part = m.part[0].toUpperCase() + m.part.slice(1)
  let headline: string
  if (m.kind === 'shape') {
    headline = `Count ${count}: ${m.part} is off`
    fixes.push(`Move your ${m.part} ${m.direction}. Match the ghost.`)
  } else if (m.kind === 'late') {
    headline = `Count ${count}: you're behind the music`
  } else if (m.kind === 'early') {
    headline = `Count ${count}: you're rushing ahead`
  } else {
    headline = `Count ${count}: the move is too small`
  }
  if (m.lag < -LATE_S) fixes.push(m.lag < -0.36 ? 'You\'re about half a beat late. Start each move earlier, on the count.' : 'You\'re a little late. Start the move as the count lands, not after.')
  else if (m.lag > EARLY_S) fixes.push('You\'re a little early. Wait for the count, then move.')
  if (m.speedRatio !== null && m.speedRatio < 0.6) fixes.push(m.speedRatio < 0.4 ? 'Go bigger and faster: you\'re moving at less than half the routine\'s speed.' : 'Bigger and sharper: the routine moves faster than you right now.')
  else if (m.speedRatio !== null && m.speedRatio > 1.8) fixes.push('Control it: you\'re moving faster than the routine. Smooth it out.')
  const spoken =
    m.kind === 'shape'
      ? `Pause. ${Part}, ${m.direction}. Match the ghost, then we'll go again.`
      : m.kind === 'late'
        ? 'Pause. You\'re behind the beat. Start each move on the count.'
        : m.kind === 'early'
          ? 'Pause. You\'re rushing. Wait for the count.'
          : 'Pause. Make it bigger and sharper.'
  return { headline, fixes: fixes.slice(0, 3), spoken }
}

/** Is the learner holding the target pose? (for the "now you try" step while paused) */
export function holding(frame: Frame | null, target: Frame, bone: number, mask: boolean[], th: { bone: number; mean: number }): boolean {
  if (!frame) return false
  const ud = boneDirs(frame)
  const rd = boneDirs(target)
  let sum = 0
  let n = 0
  let boneErr: number | null = null
  for (let b = 0; b < LIMBS; b++) {
    const u = ud[b]
    const r = rd[b]
    if (!mask[b] || !u || !r) continue
    const e = angle(u, r)
    if (b === bone) boneErr = e
    sum += e
    n++
  }
  if (n < 3) return false
  void th // kept for callers; the hold check uses fixed HOLD limits
  return (bone < 0 || (boneErr !== null && boneErr < HOLD.bone)) && sum / n < HOLD.mean
}

/** "How do I fix it?" answered instantly from the detected mistake: concrete technique steps
 * for that body part and direction, timing and speed — no network needed. */
export function howTo(m: Mistake, count: number): { steps: string[]; spoken: string } {
  const steps: string[] = []
  const d = m.direction
  const arm = /arm/.test(m.part)
  const fore = /forearm|shin/.test(m.part)
  const side = m.part.split(' ')[0]
  if (m.kind === 'shape') {
    steps.push(`Freeze in the ghost's pose first: look at where its ${m.part} is and copy just that.`)
    const tech: string[] = []
    if (arm) {
      if (/higher/.test(d)) tech.push(fore ? 'Bend less at the elbow and reach the hand up' : 'Lead with the elbow, then reach up through your fingertips. Keep the shoulder down so the arm lifts, not the shoulder')
      if (/lower/.test(d)) tech.push(fore ? 'Let the hand drop from the elbow' : 'Press the arm down from the shoulder, elbow soft')
      if (/wider/.test(d)) tech.push('Open from the shoulder blade and send the hand away from your body on a long line')
      if (/closer/.test(d)) tech.push('Draw the arm in towards your centre, close to the body')
    } else {
      if (/higher/.test(d)) tech.push(fore ? 'Kick out from the knee and point the foot' : 'Lift from the hip with your core tight; the standing leg stays strong')
      if (/lower/.test(d)) tech.push('Bring the leg down and keep the standing knee soft')
      if (/wider/.test(d)) tech.push(`Take a bigger step out to the ${side}, with your weight over both feet`)
      if (/closer/.test(d)) tech.push('Bring the foot back in under your hip')
    }
    if (!tech.length) tech.push(`Make the ${m.part} sharper and clearer in the shape`)
    steps.push(tech.join('. ') + '.')
  }
  if (m.lag < -0.28 || m.kind === 'late') steps.push(`Count out loud and arrive in the shape ON "${count}", not after it. Start moving on the count before.`)
  else if (m.lag > 0.12 || m.kind === 'early') steps.push(`Hold the shape before a touch longer, then move as "${count}" lands.`)
  if (m.kind === 'small' || (m.speedRatio !== null && m.speedRatio < 0.6)) steps.push('Go to full stretch on every move and snap into each shape. Bigger than feels natural.')
  steps.push(`Then we go again from count 1. Think "${m.kind === 'shape' ? `${m.part} ${d.replace(/^(much|a touch) /, '')}` : m.kind === 'late' ? 'early' : m.kind === 'early' ? 'wait' : 'bigger'}" on ${count}.`)
  return { steps, spoken: steps.slice(0, 3).join(' ') }
}
