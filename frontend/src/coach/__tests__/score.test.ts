import { describe, expect, it } from 'vitest'
import { dtw, normaliseFrame, scoreRep, type Frame, type RefData } from '../score'

// A simple stick person whose right arm angle we can control.
function person(armAngleDeg: number): Frame {
  const f: Frame = Array.from({ length: 33 }, () => null)
  f[0] = [0, -1.6]
  f[11] = [-0.4, -1]; f[12] = [0.4, -1]
  f[23] = [-0.25, 0]; f[24] = [0.25, 0]
  f[13] = [-0.6, -0.5]; f[15] = [-0.7, 0]
  const a = (armAngleDeg * Math.PI) / 180
  f[14] = [0.4 + 0.5 * Math.cos(a), -1 + 0.5 * Math.sin(a)]
  f[16] = [0.4 + Math.cos(a), -1 + Math.sin(a)]
  f[25] = [-0.25, 0.8]; f[27] = [-0.25, 1.6]; f[26] = [0.25, 0.8]; f[28] = [0.25, 1.6]
  return f
}

function ref(frames: Frame[]): RefData {
  const fps = 30
  const dur = frames.length / fps
  return { frames, fps, counts: Array.from({ length: 8 }, (_, k) => (k * dur) / 8), hits: [] }
}

describe('scoreRep', () => {
  const refFrames = Array.from({ length: 120 }, (_, i) => person(-90 + (i / 120) * 120)) // arm sweeps up
  it('scores a perfect copy near 100', () => {
    const user = refFrames.map((frame, i) => ({ t: i / 30, frame }))
    expect(scoreRep(user, ref(refFrames)).similarity).toBeGreaterThanOrEqual(95)
  })

  it('forgives being slightly slower (DTW), but not a wrong shape', () => {
    const slow = Array.from({ length: 140 }, (_, i) => ({ t: (i / 140) * 4, frame: refFrames[Math.floor((i / 140) * 120)] }))
    const wrong = refFrames.map((_, i) => ({ t: i / 30, frame: person(60) })) // arm held down
    expect(scoreRep(slow, ref(refFrames)).similarity).toBeGreaterThanOrEqual(90)
    expect(scoreRep(wrong, ref(refFrames)).similarity).toBeLessThan(60)
  })

  it('names the right arm as the fault, with a direction', () => {
    const wrong = refFrames.map((_, i) => ({ t: i / 30, frame: person(60) }))
    const s = scoreRep(wrong, ref(refFrames))
    expect(s.topFault?.body_part).toMatch(/right_(fore)?arm/)
    expect(s.cue).toMatch(/^Right (fore)?arm (higher|lower) on \d\.$/)
  })

  it('arms-only drill ignores the legs', () => {
    const legsWrong = refFrames.map((f, i) => {
      const g = [...f] as Frame
      g[27] = [0.5, 1.2]
      return { t: i / 30, frame: g }
    })
    expect(scoreRep(legsWrong, ref(refFrames), 'arms').similarity).toBeGreaterThanOrEqual(95)
  })

  it('asks to step back when the body is barely seen', () => {
    expect(scoreRep([], ref(refFrames)).cue).toMatch(/step back/i)
  })
})

describe('dtw', () => {
  it('aligns a sequence with a stretched copy of itself at zero cost', () => {
    const a = [0, 1, 2, 3]
    const b = [0, 0, 1, 1, 2, 2, 3, 3]
    expect(dtw((i, j) => Math.abs(a[i] - b[j]), a.length, b.length, 0.5).mean).toBe(0)
  })
})

describe('normaliseFrame', () => {
  it('keeps aspect: a square torso stays square on a wide video', () => {
    const pts = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }))
    pts[11] = { x: 0.45, y: 0.4, visibility: 1 }; pts[12] = { x: 0.55, y: 0.4, visibility: 1 }
    pts[23] = { x: 0.45, y: 0.6, visibility: 1 }; pts[24] = { x: 0.55, y: 0.6, visibility: 1 }
    const f = normaliseFrame(pts, 1600, 900)!
    const width = f[12]![0] - f[11]![0]
    expect(width).toBeCloseTo((0.1 * 1600) / (0.2 * 900), 3)
  })
})
