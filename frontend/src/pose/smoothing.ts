import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

// One Euro filter (Casiez et al. 2012): heavy smoothing when a point is still,
// light smoothing when it moves fast, so jitter drops without adding lag.
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
    this.dx += alpha(1) * (rawDx - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += alpha(cutoff) * (value - this.x)
    return this.x
  }
}

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

  constructor(minCutoff = 1.2, beta = 0.05) {
    this.minCutoff = minCutoff
    this.beta = beta
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
      // Hand landmarks carry no visibility score, so treat them as seen.
      const seen = (p.visibility ?? 1) >= MIN_VISIBILITY
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

  constructor(minCutoff?: number, beta?: number) {
    this.minCutoff = minCutoff ?? 1.2
    this.beta = beta ?? 0.05
  }

  smooth(key: string, raw: NormalizedLandmark[], now: number): NormalizedLandmark[] {
    let entry = this.bank.get(key)
    if (!entry) {
      entry = { s: new SkeletonSmoother(this.minCutoff, this.beta), used: now }
      this.bank.set(key, entry)
    }
    entry.used = now
    return entry.s.update(raw, now)
  }

  prune(now: number, maxAgeMs = 1500) {
    for (const [k, v] of this.bank) if (now - v.used > maxAgeMs) this.bank.delete(k)
  }
}
