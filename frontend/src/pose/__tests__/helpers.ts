import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

/** A standing person: 33 keypoints centred on (cx, cy), torso length `size` (normalised units). */
export function makeBody(cx: number, cy: number, size = 0.2, visibility = 0.9): NormalizedLandmark[] {
  const pts: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({ x: cx, y: cy, z: 0, visibility }))
  const set = (i: number, dx: number, dy: number) => (pts[i] = { x: cx + dx * size, y: cy + dy * size, z: 0, visibility })
  set(0, 0, -0.9) // nose
  set(11, -0.3, -0.5) // shoulders
  set(12, 0.3, -0.5)
  set(13, -0.45, -0.1) // elbows
  set(14, 0.45, -0.1)
  set(15, -0.5, 0.25) // wrists
  set(16, 0.5, 0.25)
  set(23, -0.2, 0.5) // hips
  set(24, 0.2, 0.5)
  set(25, -0.2, 1.0) // knees
  set(26, 0.2, 1.0)
  set(27, -0.2, 1.5) // ankles
  set(28, 0.2, 1.5)
  return pts
}

/** A normalised colour histogram with all its weight in one bucket. */
export function solidHist(bucket: number, size = 108): Float32Array {
  const h = new Float32Array(size)
  h[bucket] = 1
  return h
}

/** A fake OSNet fingerprint: a unit vector pointing mostly along one axis. */
export function fakeEmbedding(axis: number, noise = 0): Float32Array {
  const v = new Float32Array(512)
  v[axis] = 1
  if (noise) v[(axis + 1) % 512] = noise
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n)
  return v.map((x) => x / n)
}
