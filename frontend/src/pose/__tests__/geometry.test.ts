import { describe, expect, it } from 'vitest'
import { focusBox, isPlausibleBody } from '../geometry'
import { makeBody } from './helpers'

describe('isPlausibleBody', () => {
  it('accepts a normal person', () => expect(isPlausibleBody(makeBody(0.5, 0.5))).toBe(true))
  it('rejects a "person" with no shoulders (e.g. found in a chair)', () => {
    const b = makeBody(0.5, 0.5).map((p, i) => (i === 11 || i === 12 ? { ...p, visibility: 0.1 } : p))
    expect(isPlausibleBody(b)).toBe(false)
  })
  it('rejects shoulders without nose, elbows or hips', () => {
    const b = makeBody(0.5, 0.5).map((p, i) => ([0, 13, 14, 23, 24].includes(i) ? { ...p, visibility: 0.1 } : p))
    expect(isPlausibleBody(b)).toBe(false)
  })
})

describe('focusBox', () => {
  it('contains the whole person with room to move, inside the frame', () => {
    const box = focusBox(makeBody(0.5, 0.4, 0.15), 960, 540)!
    expect(box).not.toBeNull()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.w).toBeLessThanOrEqual(960)
    expect(box.y + box.h).toBeLessThanOrEqual(540)
    expect(box.x).toBeLessThan(0.5 * 960 - 0.3 * 0.15 * 960)
  })
  it('gives up (full scan) when the dancer fills the frame', () => {
    expect(focusBox(makeBody(0.5, 0.3, 0.6), 960, 540)).toBeNull()
  })
})
