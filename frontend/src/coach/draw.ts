// Drawing the 2D overlays: the flat ghost, stick poses and the correction arrow.
import type { Person } from '../pose/PoseCam'
import { BONES, type Frame } from './score'

// Where to draw a reference pose: anchored at the learner's mid-hip, scaled to their torso.
export function anchor(person: Person | undefined, w: number, h: number) {
  const b = person?.body
  const seen = (i: number) => b && (b[i]?.visibility ?? 0) > 0
  if (!b || ![11, 12, 23, 24].every(seen)) return { x: w / 2, y: h * 0.55, torso: h * 0.22 }
  const hx = ((b[23].x + b[24].x) / 2) * w
  const hy = ((b[23].y + b[24].y) / 2) * h
  const sx = ((b[11].x + b[12].x) / 2) * w
  const sy = ((b[11].y + b[12].y) / 2) * h
  return { x: hx, y: hy, torso: Math.hypot(sx - hx, sy - hy) }
}

export function drawPose(ctx: CanvasRenderingContext2D, f: Frame, at: { x: number; y: number; torso: number }, colours: (string | null)[], width: number) {
  ctx.lineCap = 'round'
  BONES.forEach(([a, b], i) => {
    const pa = f[a]
    const pb = f[b]
    const c = colours[i]
    if (!pa || !pb || !c) return
    ctx.strokeStyle = c
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(at.x + pa[0] * at.torso, at.y + pa[1] * at.torso)
    ctx.lineTo(at.x + pb[0] * at.torso, at.y + pb[1] * at.torso)
    ctx.stroke()
  })
}

// A solid, translucent body (torso, head, tapered limbs) — reads as a dancer, not a stick figure.
export function drawBodyGhost(ctx: CanvasRenderingContext2D, f: Frame, at: { x: number; y: number; torso: number }, colours: (string | null)[]) {
  const P = (p: [number, number]) => [at.x + p[0] * at.torso, at.y + p[1] * at.torso] as const
  ctx.save()
  // torso
  const [ls, rs, rh, lh] = [f[11], f[12], f[24], f[23]]
  if (ls && rs && rh && lh) {
    ctx.beginPath()
    const pts = [ls, rs, rh, lh].map(P)
    ctx.moveTo(pts[0][0], pts[0][1])
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y)
    ctx.closePath()
    ctx.fillStyle = 'rgba(127,216,255,0.28)'
    ctx.strokeStyle = 'rgba(127,216,255,0.8)'
    ctx.lineWidth = at.torso * 0.05
    ctx.lineJoin = 'round'
    ctx.fill()
    ctx.stroke()
    // head
    if (f[0]) {
      const mid = P([(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2])
      const nose = P(f[0])
      const r = Math.max(8, Math.hypot(nose[0] - mid[0], nose[1] - mid[1]) * 0.55)
      ctx.beginPath()
      ctx.arc(nose[0], nose[1] + r * 0.35, r, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
    }
  }
  // limbs: thick near the body, slimmer at the tip
  BONES.forEach(([a, b], i) => {
    if (i >= 8) return
    const pa = f[a]
    const pb = f[b]
    const c = colours[i]
    if (!pa || !pb || !c) return
    const [x1, y1] = P(pa)
    const [x2, y2] = P(pb)
    ctx.strokeStyle = c
    ctx.lineCap = 'round'
    ctx.lineWidth = at.torso * (i % 2 === 0 ? 0.17 : 0.12) // upper limb thicker than fore-limb
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  })
  ctx.restore()
}

export function drawArrow(ctx: CanvasRenderingContext2D, fx: number, fy: number, tx: number, ty: number) {
  const head = 14
  const ang = Math.atan2(ty - fy, tx - fx)
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.setLineDash([2, 8])
  ctx.beginPath()
  ctx.moveTo(fx, fy)
  ctx.lineTo(tx, ty)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(tx, ty)
  ctx.lineTo(tx - head * Math.cos(ang - 0.45), ty - head * Math.sin(ang - 0.45))
  ctx.lineTo(tx - head * Math.cos(ang + 0.45), ty - head * Math.sin(ang + 0.45))
  ctx.closePath()
  ctx.fill()
}
