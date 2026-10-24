import { describe, expect, it } from 'vitest'
import { SkeletonSmoother } from '../smoothing'

const pt = (x: number, visibility = 1) => [{ x, y: 0.5, z: 0, visibility }]

describe('SkeletonSmoother', () => {
  it('reduces jitter on a still point', () => {
    const s = new SkeletonSmoother()
    let maxDev = 0
    for (let f = 0; f < 60; f++) {
      const raw = 0.5 + (f % 2 ? 0.01 : -0.01) // ±1% jitter
      const out = s.update(pt(raw), f * 33)[0].x
      if (f > 10) maxDev = Math.max(maxDev, Math.abs(out - 0.5))
    }
    expect(maxDev).toBeLessThan(0.006)
  })

  it('follows a fast move closely with the app\'s body settings (little lag)', () => {
    const s = new SkeletonSmoother(1.0, 3.0) // same as PoseCam's body smoother
    let out = 0
    for (let f = 0; f <= 10; f++) out = s.update(pt(0.2 + f * 0.05), f * 33)[0].x // fast sweep
    expect(Math.abs(out - 0.7)).toBeLessThan(0.035) // under one frame of movement
  })

  it('holds a point briefly when it drops out, then hides it', () => {
    const s = new SkeletonSmoother()
    s.update(pt(0.4), 0)
    expect(s.update(pt(0.9, 0.1), 100)[0].visibility).toBe(1) // held
    expect(s.update(pt(0.9, 0.1), 400)[0].visibility).toBe(0) // hidden after 250 ms
  })

  it('treats hand points (visibility always 0) as seen when told to', () => {
    const s = new SkeletonSmoother(3, 1, false)
    expect(s.update(pt(0.4, 0), 0)[0].visibility).toBe(1)
  })
})
