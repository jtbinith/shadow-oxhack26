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
// OSNet cosine similarity needed to say "same person" when someone returns.
const EMB_REID = 0.75
// A track whose fresh fingerprint matches another track's identity this much better is a swap.
const EMB_SWAP_MARGIN = 0.15
const EMB_SWAP_MIN = 0.7
// How long a brand-new person waits for their fingerprint before their ID is final.
const TENTATIVE_MS = 2000

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function blendUnit(stored: Float32Array, next: Float32Array, rate = 0.2): Float32Array {
  const out = new Float32Array(stored.length)
  let norm = 0
  for (let i = 0; i < stored.length; i++) {
    out[i] = (1 - rate) * stored[i] + rate * next[i]
    norm += out[i] * out[i]
  }
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < out.length; i++) out[i] /= norm
  return out
}

// Two bodies whose torsos are this close (torso lengths) are the same person detected twice.
const DUPLICATE = 0.35
// Never pair a track with a body whose clothes clearly differ (stops a passer-by "taking over" someone).
const MIN_COLOUR_MATCH = 0.55
// Bodies this close to another body are overlapping; don't learn their colours (they'd mix).
const OVERLAP = 1.0

type Track = {
  id: number
  // OSNet "who is this" fingerprint (unit vector), averaged over time. Belongs to the identity, not the box.
  emb: Float32Array | null
  // Set while a new track hasn't yet been checked against people who left (needs its first fingerprint).
  tentativeUntil: number
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
  private lastReidentified: Track | null = null
  private departed: Track[] = []
  private maxPeople: number

  constructor(maxPeople: number) {
    this.maxPeople = maxPeople
  }

  /**
   * Returns one stable ID per body, in the same order as `bodies` (-1 = duplicate or over the limit).
   * `hists` holds each body's clothing histogram (null when it couldn't be sampled).
   */
  update(bodies: NormalizedLandmark[][], hists: (Float32Array | null)[], now: number): number[] {
    // Move tracks that have been missing too long into the "departed" memory.
    for (const t of this.active) if (now - t.lastSeen >= KEEP_MS) this.departed.push(t)
    this.active = this.active.filter((t) => now - t.lastSeen < KEEP_MS)
    this.departed = this.departed.filter((t) => now - t.lastSeen < REMEMBER_MS)

    const dets: Detection[] = bodies.map((b, i) => ({ ...torso(b), hist: hists[i] }))
    const ids: number[] = new Array(bodies.length).fill(-1)

    // 0. Drop duplicate detections of the same person (happens during fast, blurry movement).
    const skip = new Set<number>()
    for (let a = 0; a < dets.length; a++)
      for (let b = a + 1; b < dets.length; b++) {
        if (skip.has(a) || skip.has(b)) continue
        const scale = (dets[a].size + dets[b].size) / 2
        if (Math.hypot(dets[a].cx - dets[b].cx, dets[a].cy - dets[b].cy) / scale < DUPLICATE) skip.add(b)
      }
    // Overlapping people: still tracked, but their colours aren't learned this frame.
    const overlapping = dets.map((d, i) =>
      dets.some((o, j) => j !== i && !skip.has(j) && Math.hypot(d.cx - o.cx, d.cy - o.cy) / ((d.size + o.size) / 2) < OVERLAP),
    )

    // 1. Match detections to active tracks, cheapest pair first.
    const pairs: { t: number; d: number; cost: number }[] = []
    this.active.forEach((tr, t) => {
      const dt = Math.min((now - tr.lastSeen) / 1000, 0.5)
      // Trust the motion guess less the longer someone has been unseen.
      const damp = Math.exp(-dt / 0.3)
      const px = tr.cx + tr.vx * dt * damp
      const py = tr.cy + tr.vy * dt * damp
      dets.forEach((det, d) => {
        if (skip.has(d)) return
        const scale = (tr.size + det.size) / 2
        const dist = Math.hypot(det.cx - px, det.cy - py) / scale
        const sizeChange = Math.abs(Math.log(det.size / tr.size))
        let colour = 0
        if (tr.hist && det.hist) {
          const sim = similarity(tr.hist, det.hist)
          if (sim < MIN_COLOUR_MATCH) return
          colour = 1 - sim
        }
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
      this.move(this.active[t], dets[d], now, !overlapping[d])
    }

    // 1b. A body that didn't match by position may still be a currently tracked person who
    //     jumped (fast move, blur): match it to an unmatched track by clothing colour.
    for (let d = 0; d < dets.length; d++) {
      if (ids[d] !== -1 || skip.has(d) || !dets[d].hist) continue
      let best = -1
      let bestSim = REID_SIMILARITY
      this.active.forEach((tr, t) => {
        if (usedTracks.has(t) || !tr.hist) return
        const sim = similarity(tr.hist, dets[d].hist!)
        if (sim > bestSim) {
          bestSim = sim
          best = t
        }
      })
      if (best >= 0) {
        usedTracks.add(best)
        ids[d] = this.active[best].id
        this.move(this.active[best], dets[d], now, !overlapping[d])
      }
    }

    // 2. Unmatched detections: someone who left and came back, or someone new.
    for (let d = 0; d < bodies.length; d++) {
      if (ids[d] !== -1 || skip.has(d)) continue
      const det = dets[d]
      const taken = new Set(this.active.map((t) => t.id))
      this.lastReidentified = null
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
      const reidentified = this.lastReidentified as Track | null
      this.active.push({ id, ...det, vx: 0, vy: 0, lastSeen: now, emb: reidentified?.emb ?? null, tentativeUntil: reidentified ? 0 : now + TENTATIVE_MS })
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
    this.lastReidentified = best
    return best.id
  }

  /** Positions of active people, for choosing or clicking on the dancer. */
  people(): { id: number; cx: number; cy: number; size: number }[] {
    return this.active.map(({ id, cx, cy, size }) => ({ id, cx, cy, size }))
  }

  /**
   * A fresh OSNet fingerprint for the person currently holding `id`.
   * Returns an ID change if one happened: a newcomer recognised as someone who left (`merge`),
   * or two people whose identities had been swapped (`swap`).
   */
  addEmbedding(id: number, emb: Float32Array, now: number): { type: 'merge' | 'swap'; from: number; to: number } | null {
    const tr = this.active.find((t) => t.id === id)
    if (!tr) return null

    // A newcomer: are they actually someone who left a moment ago?
    if (tr.tentativeUntil > now || (tr.tentativeUntil > 0 && !tr.emb)) {
      tr.tentativeUntil = 0
      const taken = new Set(this.active.map((t) => t.id))
      let best: Track | null = null
      let bestSim = EMB_REID
      for (const d of this.departed) {
        if (!d.emb || (taken.has(d.id) && d.id !== tr.id)) continue
        const sim = dot(d.emb, emb)
        if (sim > bestSim) {
          bestSim = sim
          best = d
        }
      }
      if (best) {
        const from = tr.id
        tr.id = best.id
        tr.emb = blendUnit(best.emb!, emb)
        tr.hist = best.hist ?? tr.hist
        this.departed = this.departed.filter((d) => d !== best && d.id !== from)
        return from === best.id ? null : { type: 'merge', from, to: best.id }
      }
      tr.emb = emb
      return null
    }

    if (!tr.emb) {
      tr.emb = emb
      return null
    }

    // Has this box picked up someone else's identity (e.g. after two people crossed)?
    const own = dot(tr.emb, emb)
    for (const other of this.active) {
      if (other === tr || !other.emb) continue
      const sim = dot(other.emb, emb)
      if (sim > EMB_SWAP_MIN && sim > own + EMB_SWAP_MARGIN) {
        // Move the identities (ID, fingerprint, colours) to the right boxes.
        ;[tr.id, other.id] = [other.id, tr.id]
        ;[tr.emb, other.emb] = [other.emb, tr.emb]
        ;[tr.hist, other.hist] = [other.hist, tr.hist]
        tr.emb = blendUnit(tr.emb!, emb)
        return { type: 'swap', from: other.id, to: tr.id }
      }
    }
    tr.emb = blendUnit(tr.emb, emb)
    return null
  }

  private move(tr: Track, det: Detection, now: number, learnColour: boolean) {
    const dt = Math.max((now - tr.lastSeen) / 1000, 1 / 120)
    // Smoothed velocity, so one noisy frame doesn't throw the prediction off.
    tr.vx = 0.7 * tr.vx + 0.3 * ((det.cx - tr.cx) / dt)
    tr.vy = 0.7 * tr.vy + 0.3 * ((det.cy - tr.cy) / dt)
    tr.cx = det.cx
    tr.cy = det.cy
    tr.size = 0.8 * tr.size + 0.2 * det.size
    if (det.hist && learnColour) tr.hist = tr.hist ? blend(tr.hist, det.hist) : det.hist
    tr.lastSeen = now
  }
}
