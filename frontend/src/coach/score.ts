// Scoring a rep against the reference: shape (DTW on bone directions), timing (hits on the beat),
// a score per count, the single biggest fault, and the cue to say. Pure functions, unit tested.

export type P = [number, number] // x, y in torso units, centred on the mid-hip
export type Frame = (P | null)[] // 33 points (null = not seen)

// Same bones as the server (backend/app/pipeline/features.py).
export const BONES: [number, number][] = [
  [11, 13], [13, 15], [12, 14], [14, 16], // arms
  [23, 25], [25, 27], [24, 26], [26, 28], // legs
  [11, 12], [23, 24], // shoulder line, hip line
  [11, 23], [12, 24], // torso sides
  [0, 11], [0, 12], // head
]
export const BONE_PART = [
  'left_arm', 'left_forearm', 'right_arm', 'right_forearm',
  'left_thigh', 'left_shin', 'right_thigh', 'right_shin',
  'shoulders', 'hips', 'left_side', 'right_side', 'head', 'head',
]
const ARM_BONES = [0, 1, 2, 3]
const LEG_BONES = [4, 5, 6, 7]
export type Drill = 'full' | 'freeze' | 'arms' | 'legs' | 'half'
export function boneMask(drill: Drill): boolean[] {
  return BONES.map((_, i) => (drill === 'arms' ? ARM_BONES.includes(i) : drill === 'legs' ? LEG_BONES.includes(i) : true))
}

/** Screen keypoints (0–1, with visibility) → torso units centred on the mid-hip, in pixels so aspect is kept. */
export function normaliseFrame(pts: { x: number; y: number; visibility?: number }[], width: number, height: number): Frame | null {
  const px = pts.map((p) => [p.x * width, p.y * height] as P)
  const vis = (i: number) => (pts[i]?.visibility ?? 1) > 0.3
  if (![11, 12, 23, 24].every(vis)) return null
  const hip: P = [(px[23][0] + px[24][0]) / 2, (px[23][1] + px[24][1]) / 2]
  const sh: P = [(px[11][0] + px[12][0]) / 2, (px[11][1] + px[12][1]) / 2]
  const torso = Math.hypot(sh[0] - hip[0], sh[1] - hip[1]) || 1
  return px.map((p, i) => (vis(i) ? ([(p[0] - hip[0]) / torso, (p[1] - hip[1]) / torso] as P) : null))
}

// Extra segments for drawing the ghost (not scored): hands and feet. Third value = the limb
// (BONES index) they belong to, for colour.
export const DETAIL_BONES: [number, number, number][] = [
  [15, 19, 1], [15, 17, 1], [15, 21, 1], [17, 19, 1], // left hand: wrist→index, wrist→pinky, thumb, palm edge
  [16, 20, 3], [16, 18, 3], [16, 22, 3], [18, 20, 3], // right hand
  [27, 29, 5], [29, 31, 5], [27, 31, 5], // left foot: ankle, heel, toes
  [28, 30, 7], [30, 32, 7], [28, 32, 7], // right foot
]

/** For display: keep low-confidence points too (floor work hides joints, but the pose model's
 * estimate is still the best guess of where they are). Scoring uses refFrame. */
export function refFrameDisplay(points: number[][]): Frame {
  return points.map(([x, y, v]) => (v > 0.02 && (x !== 0 || y !== 0) ? ([x, y] as P) : null))
}

/** Reference frames from the server ([x, y, vis] per point) → Frame. */
export function refFrame(points: number[][]): Frame {
  return points.map(([x, y, v]) => (v > 0.3 && (x !== 0 || y !== 0) ? ([x, y] as P) : null))
}

export function boneDirs(f: Frame): ([number, number] | null)[] {
  return BONES.map(([a, b]) => {
    const pa = f[a]
    const pb = f[b]
    if (!pa || !pb) return null
    const dx = pb[0] - pa[0]
    const dy = pb[1] - pa[1]
    const n = Math.hypot(dx, dy)
    return n > 1e-6 ? [dx / n, dy / n] : null
  })
}

/** Angle between two bone directions, in degrees (0 = identical). */
export function angle(a: [number, number], b: [number, number]): number {
  return (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180) / Math.PI
}

// Limbs carry the choreography; the torso and head barely change, so they count for less
// (otherwise a wrong arm is diluted by a dozen bones that are always "right").
const BONE_WEIGHT = BONES.map((_, i) => (i < 8 ? 1 : 0.2))

function frameCost(u: ReturnType<typeof boneDirs>, r: ReturnType<typeof boneDirs>, mask: boolean[]): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < u.length; i++) {
    const a = u[i]
    const b = r[i]
    if (!mask[i] || !a || !b) continue
    sum += BONE_WEIGHT[i] * (1 - (a[0] * b[0] + a[1] * b[1]))
    n += BONE_WEIGHT[i]
  }
  return n ? sum / n : 1
}

/** Dynamic time warping with a Sakoe-Chiba band; returns the mean cost along the best path and the path. */
export function dtw(costAt: (i: number, j: number) => number, n: number, m: number, band = 0.2) {
  const w = Math.max(Math.ceil(band * Math.max(n, m)), Math.abs(n - m))
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity))
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  D[0][0] = 0
  for (let i = 1; i <= n; i++) {
    const jc = Math.round((i * m) / n)
    for (let j = Math.max(1, jc - w); j <= Math.min(m, jc + w); j++) {
      const c = costAt(i - 1, j - 1)
      const opts = [D[i - 1][j - 1], D[i - 1][j], D[i][j - 1]]
      const k = opts[0] <= opts[1] && opts[0] <= opts[2] ? 0 : opts[1] <= opts[2] ? 1 : 2
      D[i][j] = c + opts[k]
      L[i][j] = (k === 0 ? L[i - 1][j - 1] : k === 1 ? L[i - 1][j] : L[i][j - 1]) + 1
    }
  }
  const path: [number, number][] = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1])
    const opts = [D[i - 1][j - 1], D[i - 1][j], D[i][j - 1]]
    const k = opts[0] <= opts[1] && opts[0] <= opts[2] ? 0 : opts[1] <= opts[2] ? 1 : 2
    if (k === 0) { i--; j-- } else if (k === 1) i--; else j--
  }
  path.reverse()
  return { mean: D[n][m] / Math.max(1, L[n][m]), path }
}

// Calibration placeholders until AIST++ calibration lands: distance of a near-perfect rep and of a poor one.
const D_EXPERT = 0.04
const D_NOVICE = 0.45
export const toScore = (d: number) => Math.round(100 * Math.min(1, Math.max(0, (D_NOVICE - d) / (D_NOVICE - D_EXPERT))))

export type UserSample = { t: number; frame: Frame } // t = time in the reference (seconds from its start)
export type RefData = { frames: Frame[]; fps: number; counts: number[]; hits: number[] } // counts/hits relative to start

export type Fault = { type: 'shape' | 'late' | 'early' | 'soft' | 'stiff'; count: number; body_part?: string; direction?: string; magnitude?: number }
export type RepScore = {
  similarity: number
  shape: number
  timing: number | null
  dynamics: number | null
  perCount: number[]
  timingBiasMs: number | null
  topFault: Fault | null
  cue: string
  worstCount: number
  lost?: boolean
  /** Human-readable detail for the feedback card (the cue stays single and spoken). */
  notes: string[]
}

export type ScoreOptions = {
  weights?: { shape: number; timing: number; dynamics: number }
  tauMs?: number
  watched?: number[] // bone indexes the style cares most about (boosted in fault ranking)
  vocabulary?: (f: Fault | null) => string | null // style wording; falls back to the default cue
}

function speedSeries(frames: Frame[], dt: number[]): number[] {
  const tips = [15, 16, 27, 28]
  return frames.map((f, i) => {
    if (i === 0) return 0
    const prev = frames[i - 1]
    let s = 0
    for (const k of tips) if (f[k] && prev[k]) s += Math.hypot(f[k]![0] - prev[k]![0], f[k]![1] - prev[k]![1])
    return s / Math.max(dt[i], 1e-3)
  })
}

/**
 * Plain-language correction for a limb, relative to the dancer's own body: higher/lower and
 * out wider / in closer (towards the midline). Facing the camera, the dancer's left side is on
 * the camera's right, so "out" flips with the side.
 */
export function directionWords(bone: number, dx: number, dy: number, err: number): string {
  const left = BONE_PART[bone].startsWith('left')
  const outward = left ? dx > 0 : dx < 0
  const parts: string[] = []
  const v = Math.abs(dy)
  const h = Math.abs(dx)
  if (v >= 0.6 * Math.max(v, h)) parts.push(dy < 0 ? 'higher' : 'lower')
  if (h >= 0.6 * Math.max(v, h)) parts.push(outward ? 'out wider' : 'in closer')
  const how = err >= 60 ? 'much ' : err < 30 ? 'a touch ' : ''
  return how + (parts.join(' and ') || 'sharper')
}

/** The single most useful thing to say, as an external-focus cue of 12 words or fewer. */
export function cueFor(f: Fault | null): string {
  if (!f) return 'Lovely. Again!'
  if (f.type === 'late') return `Hit ${f.count} right on the beat. You're a touch late.`
  if (f.type === 'early') return `Wait for ${f.count}. You're jumping ahead.`
  if (f.type === 'soft') return `Sharper on ${f.count}. Hit and stop.`
  if (f.type === 'stiff') return `Smoother through ${f.count}. Let it flow.`
  const part = (f.body_part ?? 'arms').replace('_', ' ')
  return `${part[0].toUpperCase()}${part.slice(1)} ${f.direction ?? 'sharper'} on ${f.count}.`
}

export function scoreRep(user: UserSample[], ref: RefData, drill: Drill = 'full', opts: ScoreOptions = {}): RepScore {
  const weights = opts.weights ?? { shape: 0.7, timing: 0.3, dynamics: 0 }
  const tau = opts.tauMs ?? 100
  const watched = new Set(opts.watched ?? [])
  const mask = boneMask(drill)
  const refDirs = ref.frames.map(boneDirs)
  const usable = user.filter((u) => u.frame)
  if (usable.length < 5) {
    return { similarity: 0, shape: 0, timing: null, dynamics: null, perCount: ref.counts.map(() => 0), timingBiasMs: null, topFault: null, cue: 'Step back so I can see your whole body.', worstCount: 1, notes: ['I could barely see you — full body in frame, ~3 m back.'] }
  }
  const userDirs = usable.map((u) => boneDirs(u.frame))

  // Freeze drill: only the key shape on each count matters, not the movement between them.
  let shapeDist: number
  let pathPairs: [number, number][]
  if (drill === 'freeze') {
    pathPairs = ref.counts.map((c) => {
      const j = Math.min(ref.frames.length - 1, Math.round(c * ref.fps))
      const i = usable.reduce((best, u, k) => (Math.abs(u.t - c) < Math.abs(usable[best].t - c) ? k : best), 0)
      return [i, j]
    })
    shapeDist = pathPairs.reduce((s, [i, j]) => s + frameCost(userDirs[i], refDirs[j], mask), 0) / pathPairs.length
  } else {
    const r = dtw((i, j) => frameCost(userDirs[i], refDirs[j], mask), userDirs.length, refDirs.length)
    shapeDist = r.mean
    pathPairs = r.path
  }

  // Per count: average cost of path pairs whose reference frame falls in that count.
  const countEnds = [...ref.counts.slice(1), ref.frames.length / ref.fps]
  const perCountCost = ref.counts.map(() => ({ sum: 0, n: 0 }))
  for (const [i, j] of pathPairs) {
    const t = j / ref.fps
    const k = Math.max(0, countEnds.findIndex((e) => t < e))
    perCountCost[k].sum += frameCost(userDirs[i], refDirs[j], mask)
    perCountCost[k].n++
  }
  const perCount = perCountCost.map((c) => toScore(c.n ? c.sum / c.n : D_NOVICE))
  const worst = perCount.indexOf(Math.min(...perCount))

  // Biggest shape error: the bone that's furthest off during the worst count
  // (and per-bone errors over the whole rep, for the detailed notes).
  let shapeFault: Fault | null = null
  const overall = BONES.map(() => ({ sum: 0, n: 0 }))
  {
    const errs = BONES.map(() => ({ sum: 0, n: 0, dy: 0, dx: 0 }))
    for (const [i, j] of pathPairs) {
      userDirs[i].forEach((u, b) => {
        const r = refDirs[j][b]
        if (!mask[b] || !u || !r) return
        overall[b].sum += angle(u, r)
        overall[b].n++
      })
      const t = j / ref.fps
      if (Math.max(0, countEnds.findIndex((e) => t < e)) !== worst) continue
      userDirs[i].forEach((u, b) => {
        const r = refDirs[j][b]
        if (!mask[b] || !u || !r) return
        errs[b].sum += angle(u, r)
        errs[b].n++
        errs[b].dy += r[1] - u[1] // positive: reference points further down
        errs[b].dx += r[0] - u[0] // positive: reference points further to the camera's right
      })
    }
    let best = -1
    let bestErr = 0
    errs.forEach((e, b) => {
      let mean = e.n ? e.sum / e.n : 0
      if (watched.has(b)) mean *= 1.5 // this style watches these bones hardest
      if (b < 8 && mean > bestErr) { bestErr = mean; best = b }
    })
    if (best >= 0 && bestErr > 20) {
      const e = errs[best]
      shapeFault = { type: 'shape', count: worst + 1, body_part: BONE_PART[best], direction: directionWords(best, e.dx / e.n, e.dy / e.n, bestErr), magnitude: Math.round(bestErr) }
    }
  }

  // Dynamics: does your energy rise and fall where the routine's does (sharp hits, smooth flows)?
  let dynamics: number | null = null
  let dynFault: Fault | null = null
  if (drill !== 'freeze' && usable.length >= 10) {
    const udts = usable.map((u, i) => (i ? u.t - usable[i - 1].t : 0))
    const uSpeed = speedSeries(usable.map((u) => u.frame), udts)
    const rSpeed = speedSeries(ref.frames, ref.frames.map(() => 1 / ref.fps))
    // Correlate the speed envelopes along the DTW path.
    const pairs = pathPairs.filter(([i, j]) => i < uSpeed.length && j < rSpeed.length)
    const mu = pairs.reduce((s, [i]) => s + uSpeed[i], 0) / pairs.length
    const mr = pairs.reduce((s, [, j]) => s + rSpeed[j], 0) / pairs.length
    let num = 0, du = 0, dr = 0
    for (const [i, j] of pairs) {
      num += (uSpeed[i] - mu) * (rSpeed[j] - mr)
      du += (uSpeed[i] - mu) ** 2
      dr += (rSpeed[j] - mr) ** 2
    }
    const corr = du > 1e-6 && dr > 1e-6 ? num / Math.sqrt(du * dr) : 0
    // Sharpness: your energy at the routine's hits, relative to the routine's.
    let ratioSum = 0, ratioN = 0, worstHitCount = 1
    for (const h of ref.hits) {
      const j = Math.min(rSpeed.length - 1, Math.round(h * ref.fps))
      const near = pairs.filter(([, pj]) => Math.abs(pj - j) <= 3)
      if (!near.length || rSpeed[j] < 1e-3) continue
      const u = Math.max(...near.map(([i]) => uSpeed[i]))
      ratioSum += u / rSpeed[j]
      ratioN++
      if (u / rSpeed[j] < 0.6) worstHitCount = Math.max(1, ref.counts.findIndex((c) => c > h))
    }
    const ratio = ratioN ? ratioSum / ratioN : 1
    dynamics = Math.round(100 * Math.max(0, Math.min(1, 0.6 * (corr + 1) / 2 + 0.4 * Math.min(1, ratio / 0.8))))
    if (ratioN && ratio < 0.6) dynFault = { type: 'soft', count: worstHitCount, magnitude: Math.round(100 * ratio) }
    else if (ratioN && ratio > 1.7) dynFault = { type: 'stiff', count: worstHitCount, magnitude: Math.round(100 * ratio) }
  }

  // Timing: for each reference hit, the nearest user speed peak within ±250 ms.
  let timing: number | null = null
  let bias: number | null = null
  let timingFault: Fault | null = null
  if (ref.hits.length && drill !== 'freeze') {
    const ut = usable.map((u) => u.t)
    const dts = ut.map((t, i) => (i ? t - ut[i - 1] : 0))
    const sp = speedSeries(usable.map((u) => u.frame), dts)
    const offsets: number[] = []
    for (const h of ref.hits) {
      let bestK = -1
      for (let k = 1; k < sp.length - 1; k++) {
        if (Math.abs(ut[k] - h) > 0.25 || sp[k] < sp[k - 1] || sp[k] < sp[k + 1]) continue
        if (bestK < 0 || sp[k] > sp[bestK]) bestK = k
      }
      if (bestK >= 0) offsets.push((ut[bestK] - h) * 1000)
    }
    timing = Math.round((100 * offsets.reduce((s, o) => s + Math.exp(-Math.abs(o) / tau), 0)) / ref.hits.length)
    if (offsets.length) {
      bias = Math.round(offsets.reduce((a, b) => a + b, 0) / offsets.length)
      if (Math.abs(bias) > 90) {
        const worstHit = ref.hits[0]
        const count = Math.max(1, ref.counts.findIndex((c) => c > worstHit))
        timingFault = { type: bias > 0 ? 'late' : 'early', count, magnitude: Math.abs(bias) }
      }
    }
  }

  const shape = toScore(shapeDist)
  // Blend by the style's weights, renormalised over the components we could measure.
  const parts: [number, number][] = [[weights.shape, shape]]
  if (timing !== null) parts.push([weights.timing, timing])
  if (dynamics !== null) parts.push([weights.dynamics, dynamics])
  const wsum = parts.reduce((s, [w]) => s + w, 0)
  const similarity = Math.round(parts.reduce((s, [w, v]) => s + (w / wsum) * v, 0))
  // Fault ranking: the component that lost the most points wins.
  const candidates: [number, Fault | null][] = [
    [shape, shapeFault],
    [timing ?? 100, timingFault],
    [dynamics ?? 100, dynFault],
  ]
  const topFault = candidates.filter(([, f]) => f).sort((a, b) => a[0] - b[0])[0]?.[1] ?? null
  let cue = opts.vocabulary?.(topFault) ?? cueFor(topFault)

  // Detailed notes for the feedback card.
  const notes: string[] = []
  const name = (b: number) => BONE_PART[b].replace('_', ' ')
  const limbErrs = overall
    .map((e, b) => ({ b, err: e.n ? e.sum / e.n : 0 }))
    .filter((x) => x.b < 8 && x.err > 18)
    .sort((a, b) => b.err - a.err)
    .slice(0, 2)
  for (const { b, err } of limbErrs) notes.push(`Your ${name(b)} was ${err >= 45 ? 'well off' : 'a little off'} the routine's line through the rep.`)
  if (bias !== null && Math.abs(bias) > 60) notes.push(`Timing: you're landing hits a little ${bias > 0 ? 'after' : 'before'} the beat${timing !== null && timing >= 70 ? ', but consistently — nudge it and timing jumps' : ''}.`)
  else if (timing !== null && timing >= 80) notes.push('Timing: locked in. Hits landed on the beat.')
  if (dynamics !== null && dynamics < 60) notes.push(dynFault?.type === 'stiff' ? 'Energy: you overshot the hits — same shape, less force.' : 'Energy: the routine hits harder than you did — attack the accents.')
  else if (dynamics !== null && dynamics >= 80) notes.push('Energy: your sharpness matched the routine.')
  const good = perCount.map((v, k) => (v >= 80 ? k + 1 : 0)).filter(Boolean)
  if (good.length) notes.push(`Clean counts: ${good.join(', ')}.`)
  const weak = perCount.map((v, k) => (v < 60 ? k + 1 : 0)).filter(Boolean)
  if (weak.length && weak.length <= 4) notes.push(`Counts to drill: ${weak.join(', ')} — the replay below shows count ${worst + 1}.`)

  return { similarity, shape, timing, dynamics, perCount, timingBiasMs: bias, topFault, cue, worstCount: worst + 1, notes }
}
