import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

// One Euro filter (Casiez et al. 2012): heavy smoothing when a point is still,
// light smoothing when it moves fast, so jitter drops without lagging behind dance moves.
// A higher beta = less lag on fast movement.
class OneEuro {
  private x: number | null = null
  private dx = 0
  private minCutoff: number
  private beta: number

  constructor(minCutoff: number, beta: number) {
    this.minCutoff = minCutoff
    this.beta = beta
  }

  filter(value: number, dt: number): number {
    if (this.x === null) {
      this.x = value
      return value
    }
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))
    const rawDx = (value - this.x) / dt
    // Speed estimate cutoff: higher reacts sooner to a sudden move (less lag at the start of a hit).
    this.dx += alpha(D_CUTOFF) * (rawDx - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += alpha(cutoff) * (value - this.x)
    return this.x
  }
}

const D_CUTOFF = 3

// A point counts as seen if the model is at least this confident.
const MIN_VISIBILITY = 0.5
// Keep showing a point's last good position for this long after it drops out.
const HOLD_MS = 250

type PointState = { fx: OneEuro; fy: OneEuro; fz: OneEuro; last: NormalizedLandmark | null; lastSeen: number }

/** Smooths one skeleton (body or hand) over time. Keep one per tracked person/hand. */
export class SkeletonSmoother {
  private points: PointState[] = []
  private lastTime = 0
  private minCutoff: number
  private beta: number
  private useVisibility: boolean

  constructor(minCutoff = 1.0, beta = 3.0, useVisibility = true) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.useVisibility = useVisibility
  }

  /** Returns smoothed points; a point that has been missing longer than HOLD_MS gets visibility 0. */
  update(raw: NormalizedLandmark[], now: number): NormalizedLandmark[] {
    const dt = this.lastTime ? Math.min(Math.max((now - this.lastTime) / 1000, 1 / 120), 0.25) : 1 / 30
    this.lastTime = now
    return raw.map((p, i) => {
      const s = (this.points[i] ??= {
        fx: new OneEuro(this.minCutoff, this.beta),
        fy: new OneEuro(this.minCutoff, this.beta),
        fz: new OneEuro(this.minCutoff, this.beta),
        last: null,
        lastSeen: 0,
      })
      // The hand model reports visibility as 0 for every point (it has no such score),
      // so hands are always treated as seen.
      const seen = !this.useVisibility || (p.visibility ?? 1) >= MIN_VISIBILITY
      if (seen) {
        s.last = { x: s.fx.filter(p.x, dt), y: s.fy.filter(p.y, dt), z: s.fz.filter(p.z, dt), visibility: 1 }
        s.lastSeen = now
        return s.last
      }
      if (s.last && now - s.lastSeen < HOLD_MS) return s.last
      return { ...p, visibility: 0 }
    })
  }
}

/** Holds smoothers per key (e.g. person id, or person id + hand side) and forgets stale ones. */
export class SmootherBank {
  private bank = new Map<string, { s: SkeletonSmoother; used: number }>()
  private minCutoff: number
  private beta: number
  private useVisibility: boolean

  constructor(minCutoff: number, beta: number, useVisibility = true) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.useVisibility = useVisibility
  }

  smooth(key: string, raw: NormalizedLandmark[], now: number): NormalizedLandmark[] {
    let entry = this.bank.get(key)
    if (!entry) {
      entry = { s: new SkeletonSmoother(this.minCutoff, this.beta, this.useVisibility), used: now }
      this.bank.set(key, entry)
    }
    entry.used = now
    return entry.s.update(raw, now)
  }

  prune(now: number, maxAgeMs = 1500) {
    for (const [k, v] of this.bank) if (now - v.used > maxAgeMs) this.bank.delete(k)
  }
}
