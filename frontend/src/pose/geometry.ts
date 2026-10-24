import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

type Landmark = NormalizedLandmark

// The pose model sometimes "finds" a person in furniture or a blurry shape. A real person
// has both shoulders and at least three of: nose, elbows, hips, with a sensible shoulder width.
export function isPlausibleBody(b: Landmark[]): boolean {
  const seen = (i: number) => (b[i]?.visibility ?? 0) >= 0.5
  if (!seen(11) || !seen(12)) return false
  const others = [0, 13, 14, 23, 24].filter(seen).length
  const shoulders = Math.hypot(b[11].x - b[12].x, b[11].y - b[12].y)
  return others >= 3 && shoulders > 0.02 && shoulders < 0.9
}

export function visibleCount(b: Landmark[]): number {
  return b.filter((p) => (p.visibility ?? 0) > 0).length
}

export type Box = { x: number; y: number; w: number; h: number }

// A generous box around someone's visible keypoints, in video pixels, so the next frame's
// movement stays inside it.
export function focusBox(body: Landmark[], vw: number, vh: number): Box | null {
  const pts = body.filter((p) => (p.visibility ?? 0) > 0.3)
  if (pts.length < 8) return null
  const x0 = Math.min(...pts.map((p) => p.x)) * vw
  const x1 = Math.max(...pts.map((p) => p.x)) * vw
  const y0 = Math.min(...pts.map((p) => p.y)) * vh
  const y1 = Math.max(...pts.map((p) => p.y)) * vh
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  // Room for arms flung out and a step to the side.
  const side = Math.max(x1 - x0, y1 - y0) * 1.6 + 60
  const w = Math.min(vw, side)
  const h = Math.min(vh, side)
  if (w * h > 0.8 * vw * vh) return null // the dancer fills the frame; a full scan is just as good
  return { x: Math.min(Math.max(0, cx - w / 2), vw - w), y: Math.min(Math.max(0, cy - h / 2), vh - h), w, h }
}

