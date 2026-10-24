import { describe, expect, it } from 'vitest'
import { blend, clothingHistogram, similarity } from '../appearance'
import { makeBody } from './helpers'

function image(w: number, h: number, rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4)
  return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData
}

describe('clothing colour fingerprint', () => {
  const body = makeBody(0.5, 0.4, 0.3)
  it('is identical for the same clothes and different for different clothes', () => {
    const red1 = clothingHistogram(image(192, 108, [200, 30, 30]), body)!
    const red2 = clothingHistogram(image(192, 108, [205, 35, 28]), body)!
    const blue = clothingHistogram(image(192, 108, [30, 40, 200]), body)!
    expect(similarity(red1, red2)).toBeGreaterThan(0.95)
    expect(similarity(red1, blue)).toBeLessThan(0.1)
  })

  it('falls back to the chest when the hips are hidden', () => {
    const seated = body.map((p, i) => (i === 23 || i === 24 ? { ...p, visibility: 0.1 } : p))
    expect(clothingHistogram(image(192, 108, [10, 200, 10]), seated)).not.toBeNull()
  })

  it('returns nothing without both shoulders', () => {
    const noShoulder = body.map((p, i) => (i === 11 ? { ...p, visibility: 0 } : p))
    expect(clothingHistogram(image(192, 108, [10, 200, 10]), noShoulder)).toBeNull()
  })

  it('blends slowly towards new observations', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([0, 1])
    expect(Array.from(blend(a, b, 0.1))).toEqual([expect.closeTo(0.9, 5), expect.closeTo(0.1, 5)])
  })
})
