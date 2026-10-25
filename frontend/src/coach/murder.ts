// The murder meter: how many crows are perched, from how close the dancing is to the stop threshold.
// pressure: 0 = dancing well, 1 = at the threshold (the flow stops there: "It's a murder!").
export const MAX_CROWS = 3
// One more crow at each of these levels of pressure. Folklore: one crow is just a crow, two is an
// "attempted murder", three is a murder, so the third lands exactly at the threshold, where the flow stops.
export const CROW_LEVELS = [0.6, 0.8, 1.0]
// Crows arrive (and leave) one at a time, at least this many ms apart (each crow gets its moment).
export const CROW_GAP_MS = 1000

/** How many crows this pressure calls for (0..3). */
export function targetCrows(pressure: number): number {
  return CROW_LEVELS.filter((l) => pressure >= l).length
}

/** Move one crow at a time towards the target, no faster than one per CROW_GAP_MS. */
export function stepCrows(current: number, target: number, msSinceLastChange: number): number {
  if (target === current || msSinceLastChange < CROW_GAP_MS) return current
  return current + Math.sign(target - current)
}
