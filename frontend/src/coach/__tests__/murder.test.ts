import { describe, expect, it } from 'vitest'
import { CROW_COOLDOWN_MS, CROW_FORGIVE_MS, NO_CROWS, isMurder, onClean, onMistake, type Crows } from '../murder'

const feed = (events: [number, 'x' | 'ok'][]) => {
  let c: Crows = NO_CROWS
  const seen: number[] = []
  for (const [t, e] of events) {
    c = e === 'x' ? onMistake(c, t) : onClean(c, t)
    seen.push(c.n)
  }
  return { c, seen }
}

describe('murder meter', () => {
  it('the first mistake sends a crow straight away', () => {
    expect(onMistake(NO_CROWS, 0).n).toBe(1)
  })

  it('mistakes inside the cooldown do not send more crows', () => {
    const { seen } = feed([[0, 'x'], [500, 'x'], [1500, 'x']])
    expect(seen).toEqual([1, 1, 1])
  })

  it('the next mistake after the cooldown sends the next crow, and the third is a murder', () => {
    const { c, seen } = feed([[0, 'x'], [500, 'x'], [CROW_COOLDOWN_MS + 100, 'x'], [CROW_COOLDOWN_MS + 600, 'x'], [2 * CROW_COOLDOWN_MS + 300, 'x']])
    expect(seen).toEqual([1, 1, 2, 2, 3])
    expect(isMurder(c)).toBe(true)
  })

  it('a long clean stretch sends a crow away, one at a time', () => {
    const t = CROW_COOLDOWN_MS + 100
    const { seen } = feed([[0, 'x'], [t, 'x'], [t + 1000, 'ok'], [t + CROW_FORGIVE_MS, 'ok'], [t + CROW_FORGIVE_MS + 500, 'ok'], [t + 2 * CROW_FORGIVE_MS, 'ok']])
    expect(seen).toEqual([1, 2, 2, 1, 1, 0])
  })
})
