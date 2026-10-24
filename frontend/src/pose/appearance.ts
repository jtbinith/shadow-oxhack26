import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

// A clothing-colour fingerprint: an HSV histogram of the torso and upper legs.
// Used to tell people apart when they cross, and to recognise them when they return.

const H_BINS = 12
const S_BINS = 3
const V_BINS = 3
export const HIST_SIZE = H_BINS * S_BINS * V_BINS

const L_SHOULDER = 11
const R_SHOULDER = 12
const L_HIP = 23
const R_HIP = 24
const L_KNEE = 25
const R_KNEE = 26

type Pt = { x: number; y: number }

function inQuad(p: Pt, q: Pt[]): boolean {
  // Convex quad, points in order: same sign of cross product on every edge.
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (c !== 0) {
      if (sign === 0) sign = Math.sign(c)
      else if (Math.sign(c) !== sign) return false
    }
  }
  return true
}

function addRegion(img: ImageData, quad: Pt[], hist: Float32Array): number {
  const { width: w, height: h, data } = img
  const xs = quad.map((p) => p.x * w)
  const ys = quad.map((p) => p.y * h)
  const x0 = Math.max(0, Math.floor(Math.min(...xs)))
  const x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)))
  const y0 = Math.max(0, Math.floor(Math.min(...ys)))
  const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)))
  const q = quad.map((p) => ({ x: p.x * w, y: p.y * h }))
  let n = 0
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      if (!inQuad({ x, y }, q)) continue
      const i = (y * w + x) * 4
      const r = data[i] / 255
      const g = data[i + 1] / 255
      const b = data[i + 2] / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const d = max - min
      let hue = 0
      if (d > 0) {
        if (max === r) hue = ((g - b) / d + 6) % 6
        else if (max === g) hue = (b - r) / d + 2
        else hue = (r - g) / d + 4
      }
      const sat = max === 0 ? 0 : d / max
      const hb = Math.min(H_BINS - 1, Math.floor((hue / 6) * H_BINS))
      const sb = Math.min(S_BINS - 1, Math.floor(sat * S_BINS))
      const vb = Math.min(V_BINS - 1, Math.floor(max * V_BINS))
      hist[(hb * S_BINS + sb) * V_BINS + vb] += 1
      n++
    }
  }
  return n
}

/** Returns a normalised histogram, or null if not enough of the torso is visible to sample. */
export function clothingHistogram(img: ImageData, body: NormalizedLandmark[]): Float32Array | null {
  const vis = (i: number) => (body[i]?.visibility ?? 0) >= 0.5
  if (!vis(L_SHOULDER) || !vis(R_SHOULDER)) return null
  const hist = new Float32Array(HIST_SIZE)
  let n: number
  if (vis(L_HIP) && vis(R_HIP)) {
    n = addRegion(img, [body[L_SHOULDER], body[R_SHOULDER], body[R_HIP], body[L_HIP]], hist)
    if (vis(L_KNEE) && vis(R_KNEE)) {
      n += addRegion(img, [body[L_HIP], body[R_HIP], body[R_KNEE], body[L_KNEE]], hist)
    }
  } else {
    // Hips hidden (seated, behind a desk, close to the camera): sample the upper chest instead,
    // a box hanging below the shoulders as deep as 0.8 shoulder widths.
    const ls = body[L_SHOULDER]
    const rs = body[R_SHOULDER]
    const depth = 0.8 * Math.hypot(rs.x - ls.x, rs.y - ls.y)
    const down = (p: Pt) => ({ x: p.x, y: Math.min(1, p.y + depth) })
    n = addRegion(img, [ls, rs, down(rs), down(ls)], hist)
  }
  if (n < 30) return null
  for (let i = 0; i < HIST_SIZE; i++) hist[i] /= n
  return hist
}

/** Bhattacharyya coefficient: 1 = identical colours, 0 = nothing in common. */
export function similarity(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.sqrt(a[i] * b[i])
  return s
}

/** Slowly blend a new observation into a stored fingerprint (lighting changes, turning around). */
export function blend(stored: Float32Array, next: Float32Array, rate = 0.1): Float32Array {
  const out = new Float32Array(stored.length)
  for (let i = 0; i < stored.length; i++) out[i] = (1 - rate) * stored[i] + rate * next[i]
  return out
}
