import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

// Keeps a stable ID per person across frames, so colours (and later, scoring)
// stay locked to the same dancer.

const L_SHOULDER = 11
const R_SHOULDER = 12
const L_HIP = 23
const R_HIP = 24

// How long a person keeps their ID after they stop being detected.
const KEEP_MS = 1000
// A match must be within this many torso-lengths of the predicted position.
const MAX_MATCH = 1.2

type Track = {
  id: number
  cx: number
  cy: number
  vx: number
  vy: number
  size: number
  lastSeen: number
}

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
  private tracks: Track[] = []
  private nextId = 0
  private maxPeople: number

  constructor(maxPeople: number) {
    this.maxPeople = maxPeople
  }

  /** Returns one stable ID per body, in the same order as `bodies`. */
  update(bodies: NormalizedLandmark[][], now: number): number[] {
    this.tracks = this.tracks.filter((t) => now - t.lastSeen < KEEP_MS)
    const dets = bodies.map(torso)

    // Score every (track, detection) pair by distance from the track's predicted position,
    // measured in torso lengths, plus a penalty for a change in apparent size.
    const pairs: { t: number; d: number; cost: number }[] = []
    this.tracks.forEach((tr, t) => {
      const dt = Math.min((now - tr.lastSeen) / 1000, 0.5)
      const px = tr.cx + tr.vx * dt
      const py = tr.cy + tr.vy * dt
      dets.forEach((det, d) => {
        const scale = (tr.size + det.size) / 2
        const dist = Math.hypot(det.cx - px, det.cy - py) / scale
        const sizeChange = Math.abs(Math.log(det.size / tr.size))
        const cost = dist + sizeChange
        if (cost < MAX_MATCH) pairs.push({ t, d, cost })
      })
    })

    // Greedy assignment, cheapest first (fine for a handful of people).
    pairs.sort((a, b) => a.cost - b.cost)
    const ids: number[] = new Array(bodies.length).fill(-1)
    const usedTracks = new Set<number>()
    for (const { t, d } of pairs) {
      if (usedTracks.has(t) || ids[d] !== -1) continue
      usedTracks.add(t)
      ids[d] = this.tracks[t].id
      this.move(this.tracks[t], dets[d], now)
    }

    // New people get the lowest free ID, so colours are reused predictably.
    for (let d = 0; d < bodies.length; d++) {
      if (ids[d] !== -1) continue
      const taken = new Set(this.tracks.map((t) => t.id))
      let id = 0
      while (taken.has(id)) id++
      if (id >= this.maxPeople) id = this.nextId++ % this.maxPeople
      const det = dets[d]
      this.tracks.push({ id, ...det, vx: 0, vy: 0, lastSeen: now })
      ids[d] = id
    }
    return ids
  }

  private move(tr: Track, det: { cx: number; cy: number; size: number }, now: number) {
    const dt = Math.max((now - tr.lastSeen) / 1000, 1 / 120)
    // Smoothed velocity, so one noisy frame doesn't throw the prediction off.
    tr.vx = 0.7 * tr.vx + 0.3 * ((det.cx - tr.cx) / dt)
    tr.vy = 0.7 * tr.vy + 0.3 * ((det.cy - tr.cy) / dt)
    tr.cx = det.cx
    tr.cy = det.cy
    tr.size = 0.8 * tr.size + 0.2 * det.size
    tr.lastSeen = now
  }
}
