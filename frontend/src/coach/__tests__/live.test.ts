import { describe as group, expect, it } from 'vitest'
import { MistakeDetector, describe, holding, THRESHOLDS } from '../live'
import type { Frame, P, RefData } from '../score'

const FPS = 30
// A body whose right arm (12→14→16) sweeps from down to straight up over 4 s, and left arm waves.
function pose(t: number, armOffset = 0): Frame {
  const f: Frame = Array.from({ length: 33 }, () => null)
  const set = (i: number, x: number, y: number) => { f[i] = [x, y] as P }
  set(0, 0, -1.4); set(11, 0.4, -1); set(12, -0.4, -1); set(23, 0.2, 0); set(24, -0.2, 0)
  set(25, 0.2, 1); set(26, -0.2, 1); set(27, 0.2, 2); set(28, -0.2, 2)
  const a = (Math.PI * t) / 4 + armOffset // right arm angle from straight down
  set(14, -0.4 - 0.5 * Math.sin(a), -1 + 0.5 * Math.cos(a)); set(16, -0.4 - Math.sin(a), -1 + Math.cos(a))
  const b = 0.6 + 0.5 * Math.sin(2 * Math.PI * t) // left arm waving out to the side
  set(13, 0.4 + 0.5 * Math.sin(b), -1 + 0.5 * Math.cos(b)); set(15, 0.4 + Math.sin(b), -1 + Math.cos(b))
  return f
}
const ref: RefData = { frames: Array.from({ length: 4 * FPS }, (_, j) => pose(j / FPS)), fps: FPS, counts: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], hits: [] }
const mask = Array(14).fill(true)

function run(user: (t: number) => Frame, until = 3) {
  const d = new MistakeDetector(ref, { sensitivity: 'normal', mask, windowS: 1 })
  d.reset(0.5)
  for (let t = 0; t <= until; t += 1 / FPS) {
    d.push(t, user(t))
    const m = d.check(t)
    if (m) return m
  }
  return null
}

group('MistakeDetector', () => {
  it('lets a good dancer flow', () => {
    expect(run((t) => pose(t))).toBeNull()
  })
  it('stops on a sustained wrong arm and says which way to move it', () => {
    const m = run((t) => (t > 2 ? pose(t, -1.2) : pose(t)), 3.5) // arm stays low while the routine raises it
    expect(m?.kind).toBe('shape')
    expect(m?.part).toMatch(/right/)
    expect(m?.direction).toMatch(/higher/)
  })
  it('calls out being late when the shape is right but behind', () => {
    const m = run((t) => pose(Math.max(0, t - 0.36)))
    expect(m?.kind).toBe('late')
    expect(m?.lag).toBeLessThan(-0.28)
  })
  it('ignores one bad moment', () => {
    expect(run((t) => (t > 1.5 && t < 1.65 ? pose(t, -1.4) : pose(t)))).toBeNull()
  })
})

group('describe and holding', () => {
  it('names body part, direction and timing without numbers', () => {
    const m = run((t) => (t > 2 ? pose(t, -1.2) : pose(t)), 3.5)!
    m.lag = -0.4 // and behind the music
    const d = describe(m, 3)
    expect(d.headline).toMatch(/Count 3/)
    expect(d.fixes.join(' ')).toMatch(/higher/)
    expect(d.fixes.join(' ') + d.spoken).not.toMatch(/\d+ ?(°|ms|degrees)/)
  })
  it('recognises the learner matching the target pose', () => {
    const target = pose(2)
    expect(holding(pose(2), target, 2, mask, THRESHOLDS.normal)).toBe(true)
    expect(holding(pose(2, -1.4), target, 2, mask, THRESHOLDS.normal)).toBe(false)
  })
})
