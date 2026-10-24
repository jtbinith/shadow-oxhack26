import { describe, expect, it } from 'vitest'
import { cueFor } from '../score'
import { STYLES, styleCue, styleFor } from '../styles'

describe('style profiles', () => {
  it('weights sum to 1 for every style', () => {
    for (const s of Object.values(STYLES)) {
      const { shape, timing, dynamics } = s.weights
      expect(shape + timing + dynamics).toBeCloseTo(1, 5)
    }
  })

  it('bollywood says dhol; bharatanatyam says sollukattu', () => {
    expect(styleCue(STYLES.bollywood, { type: 'late', count: 3 })).toBe("Hit 3 with the dhol. You're a touch late.")
    expect(styleCue(STYLES.bharatanatyam, { type: 'late', count: 5 })).toMatch(/sollukattu/)
  })

  it('shape faults fall through to the default body-part wording', () => {
    const f = { type: 'shape' as const, count: 6, body_part: 'right_arm', direction: 'higher' }
    expect(styleCue(STYLES.bollywood, f)).toBeNull()
    expect(cueFor(f)).toBe('Right arm higher on 6.')
  })

  it('unknown styles fall back to general', () => {
    expect(styleFor('salsa-fusion').id).toBe('general')
  })

  it('dynamics faults have cues', () => {
    expect(cueFor({ type: 'soft', count: 5 })).toBe('Sharper on 5. Hit and stop.')
    expect(cueFor({ type: 'stiff', count: 2 })).toMatch(/Smoother/)
  })
})
