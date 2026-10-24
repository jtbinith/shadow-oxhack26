import { describe, expect, it } from 'vitest'
import { PersonTracker } from '../tracker'
import { fakeEmbedding, makeBody, solidHist } from './helpers'

const FRAME = 33 // ms

describe('PersonTracker', () => {
  it('keeps the same ID for a person moving smoothly', () => {
    const t = new PersonTracker(4)
    const ids: number[] = []
    for (let f = 0; f < 30; f++) ids.push(t.update([makeBody(0.3 + f * 0.005, 0.5)], [null], f * FRAME)[0])
    expect(new Set(ids).size).toBe(1)
  })

  it('keeps two people apart even when MediaPipe returns them in a different order', () => {
    const t = new PersonTracker(4)
    const [a, b] = t.update([makeBody(0.25, 0.5), makeBody(0.75, 0.5)], [null, null], 0)
    for (let f = 1; f < 20; f++) {
      const swapped = f % 2 === 0
      const bodies = swapped ? [makeBody(0.75, 0.5), makeBody(0.25, 0.5)] : [makeBody(0.25, 0.5), makeBody(0.75, 0.5)]
      const ids = t.update(bodies, [null, null], f * FRAME)
      expect(swapped ? ids : ids).toEqual(swapped ? [b, a] : [a, b])
    }
  })

  it('keeps an ID through a short occlusion (under 1.5 s)', () => {
    const t = new PersonTracker(4)
    const [id] = t.update([makeBody(0.5, 0.5)], [null], 0)
    t.update([], [], 500) // hidden
    expect(t.update([makeBody(0.52, 0.5)], [null], 1200)[0]).toBe(id)
  })

  it('gives a returning person their ID back by clothing colour', () => {
    const t = new PersonTracker(4)
    const red = solidHist(3)
    const [id] = t.update([makeBody(0.2, 0.5)], [red], 0)
    t.update([], [], 2000) // gone longer than the 1.5 s hold
    // Comes back on the other side of the frame, same clothes.
    expect(t.update([makeBody(0.8, 0.5)], [red], 4000)[0]).toBe(id)
  })

  it("doesn't give a departed person's colour to a newcomer in different clothes", () => {
    const t = new PersonTracker(4)
    const [first] = t.update([makeBody(0.2, 0.5)], [solidHist(3)], 0)
    t.update([], [], 2000)
    const [newcomer] = t.update([makeBody(0.2, 0.5)], [solidHist(60)], 4000)
    expect(newcomer).not.toBe(first)
  })

  it('never matches a track to a body whose clothes clearly differ (no takeovers)', () => {
    const t = new PersonTracker(4)
    const [seated] = t.update([makeBody(0.5, 0.5)], [solidHist(3)], 0)
    // A different person appears exactly where the seated person was.
    const [other] = t.update([makeBody(0.5, 0.5)], [solidHist(60)], FRAME)
    expect(other).not.toBe(seated)
  })

  it('drops duplicate detections of the same person', () => {
    const t = new PersonTracker(4)
    const ids = t.update([makeBody(0.5, 0.5), makeBody(0.505, 0.5)], [null, null], 0)
    expect(ids.filter((i) => i >= 0)).toHaveLength(1)
  })

  it('tracks no more than the limit', () => {
    const t = new PersonTracker(2)
    const ids = t.update([makeBody(0.1, 0.5), makeBody(0.4, 0.5), makeBody(0.7, 0.5)], [null, null, null], 0)
    expect(ids.filter((i) => i >= 0)).toHaveLength(2)
  })

  it('recognises a newcomer as someone who left, using OSNet fingerprints', () => {
    const t = new PersonTracker(4)
    const [id] = t.update([makeBody(0.2, 0.5)], [null], 0)
    t.addEmbedding(id, fakeEmbedding(7), 100)
    t.update([], [], 2000)
    const [tentative] = t.update([makeBody(0.8, 0.5)], [null], 4000)
    const change = t.addEmbedding(tentative, fakeEmbedding(7, 0.1), 4100)
    if (tentative !== id) expect(change).toEqual({ type: 'merge', from: tentative, to: id })
    expect(t.people().map((p) => p.id)).toContain(id)
  })

  it('swaps identities back when fingerprints show two people were swapped', () => {
    const t = new PersonTracker(4)
    const [a, b] = t.update([makeBody(0.25, 0.5), makeBody(0.75, 0.5)], [null, null], 0)
    t.addEmbedding(a, fakeEmbedding(1), 10)
    t.addEmbedding(b, fakeEmbedding(2), 10)
    // The box now labelled `a` sends person 2's fingerprint: they were swapped.
    const change = t.addEmbedding(a, fakeEmbedding(2), 50)
    expect(change?.type).toBe('swap')
  })

  it('focus mode: touch() moves a known person without creating anyone', () => {
    const t = new PersonTracker(4)
    const [id] = t.update([makeBody(0.3, 0.5)], [null], 0)
    t.touch(id, makeBody(0.35, 0.5), FRAME)
    const people = t.people()
    expect(people).toHaveLength(1)
    expect(people[0].cx).toBeCloseTo(0.35, 2)
  })
})
