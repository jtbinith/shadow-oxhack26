import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { blend, similarity } from './appearance'

// Keeps a stable ID per person across frames, so colours (and later, scoring)
// stay locked to the same dancer. Matches on position, size and clothing colour,
// and recognises people who leave and come back.

const L_SHOULDER = 11
const R_SHOULDER = 12
const L_HIP = 23
const R_HIP = 24

// Keep an active ID this long after the person stops being detected.
const KEEP_MS = 1500
// Remember a departed person's clothing for this long, to give them their ID back.
const REMEMBER_MS = 15000
// Matching cost limit: torso-lengths of distance + size change + colour difference.
const MAX_MATCH = 1.6
// How much clothing colour weighs against position.
const COLOUR_WEIGHT = 1.5
// Colour similarity needed to re-identify someone who came back.
const REID_SIMILARITY = 0.7
// Without a colour sample, someone reappearing this close (torso lengths) this soon gets their ID back.
const REID_NEAR = 1.5
const REID_NEAR_MS = 3000

type Track = {
  id: number
  cx: number
  cy: number
  vx: number
  vy: number
  size: number
  lastSeen: number
  hist: Float32Array | null
}

type Detection = { cx: number; cy: number; size: number; hist: Float32Array | null }

function torso(body: NormalizedLandmark[]) {
  const sx = (body[L_SHOULDER].x + body[R_SHOULDER].x) / 2
  const sy = (body[L_SHOULDER].y + body[R_SHOULDER].y) / 2
  const hx = (body[L_HIP].x + body[R_HIP].x) / 2
  const hy = (body[L_HIP].y + body[R_HIP].y) / 2
  return {
    cx: (sx + hx) / 2,
    cy: (sy + hy) / 2,
    size: Math.max(Math.hypot(sx - hx, sy - hy), 1e-3),
  }
}

export class PersonTracker {
  private active: Track[] = []
  private departed: Track[] = []
  private maxPeople: number

  constructor(maxPeople: number) {
    this.maxPeople = maxPeople
  }

  /**
   * Returns one stable ID per body, in the same order as `bodies`.
   * `hists` holds each body's clothing histogram (null when it couldn't be sampled).
   */
  update(bodies: NormalizedLandmark[][], hists: (Float32Array | null)[], now: number): number[] {
    // Move tracks that have been missing too long into the "departed" memory.
    for (const t of this.active) if (now - t.lastSeen >= KEEP_MS) this.departed.push(t)
    this.active = this.active.filter((t) => now - t.lastSeen < KEEP_MS)
    this.departed = this.departed.filter((t) => now - t.lastSeen < REMEMBER_MS)

    const dets: Detection[] = bodies.map((b, i) => ({ ...torso(b), hist: hists[i] }))
    const ids: number[] = new Array(bodies.length).fill(-1)

    // 1. Match detections to active tracks, cheapest pair first.
    const pairs: { t: number; d: number; cost: number }[] = []
    this.active.forEach((tr, t) => {
      const dt = Math.min((now - tr.lastSeen) / 1000, 0.5)
      const px = tr.cx + tr.vx * dt
      const py = tr.cy + tr.vy * dt
      dets.forEach((det, d) => {
        const scale = (tr.size + det.size) / 2
        const dist = Math.hypot(det.cx - px, det.cy - py) / scale
        const sizeChange = Math.abs(Math.log(det.size / tr.size))
        const colour = tr.hist && det.hist ? 1 - similarity(tr.hist, det.hist) : 0
        const cost = dist + sizeChange + COLOUR_WEIGHT * colour
        if (cost < MAX_MATCH) pairs.push({ t, d, cost })
      })
    })
    pairs.sort((a, b) => a.cost - b.cost)
    const usedTracks = new Set<number>()
    for (const { t, d } of pairs) {
      if (usedTracks.has(t) || ids[d] !== -1) continue
      usedTracks.add(t)
      ids[d] = this.active[t].id
      this.move(this.active[t], dets[d], now)
    }

    // 2. Unmatched detections: someone who left and came back, or someone new.
    for (let d = 0; d < bodies.length; d++) {
      if (ids[d] !== -1) continue
      const det = dets[d]
      const taken = new Set(this.active.map((t) => t.id))
      let id = this.reidentify(det, taken, now)
      if (id === -1) {
        // Prefer an ID nobody has used recently, so a departed person's colour stays theirs.
        const reserved = new Set(this.departed.map((t) => t.id))
        id = 0
        while ((taken.has(id) || reserved.has(id)) && id < this.maxPeople) id++
        if (id >= this.maxPeople) {
          // All IDs are active or reserved: take the one whose owner left longest ago.
          const oldest = this.departed.filter((t) => !taken.has(t.id)).sort((a, b) => a.lastSeen - b.lastSeen)[0]
          if (!oldest) continue // more people than we track; skip this one
          id = oldest.id
        }
        // This ID now belongs to someone new; forget the departed person who had it.
        this.departed = this.departed.filter((t) => t.id !== id)
      }
      this.active.push({ id, ...det, vx: 0, vy: 0, lastSeen: now })
      ids[d] = id
    }
    return ids
  }

  private reidentify(det: Detection, taken: Set<number>, now: number): number {
    let best: Track | null = null
    let bestSim = REID_SIMILARITY
    for (const t of this.departed) {
      if (taken.has(t.id)) continue
      if (det.hist && t.hist) {
        const sim = similarity(t.hist, det.hist)
        if (sim > bestSim) {
          bestSim = sim
          best = t
        }
      } else if (!best && now - t.lastSeen < REID_NEAR_MS) {
        // No colours to compare: fall back to "reappeared close to where they left".
        const dist = Math.hypot(det.cx - t.cx, det.cy - t.cy) / ((det.size + t.size) / 2)
        if (dist < REID_NEAR) best = t
      }
    }
    if (!best) return -1
    this.departed = this.departed.filter((t) => t !== best)
    return best.id
  }

  private move(tr: Track, det: Detection, now: number) {
    const dt = Math.max((now - tr.lastSeen) / 1000, 1 / 120)
    // Smoothed velocity, so one noisy frame doesn't throw the prediction off.
    tr.vx = 0.7 * tr.vx + 0.3 * ((det.cx - tr.cx) / dt)
    tr.vy = 0.7 * tr.vy + 0.3 * ((det.cy - tr.cy) / dt)
    tr.cx = det.cx
    tr.cy = det.cy
    tr.size = 0.8 * tr.size + 0.2 * det.size
    if (det.hist) tr.hist = tr.hist ? blend(tr.hist, det.hist) : det.hist
    tr.lastSeen = now
  }
}
