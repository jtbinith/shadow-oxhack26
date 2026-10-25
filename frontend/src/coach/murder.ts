// The murder meter: each mistake sends a crow; three crows are a murder, and the flow stops.
// Folklore: one crow is just a crow, two is an "attempted murder", three is a murder.
export const MAX_CROWS = 3
// After a crow lands, more mistakes within this long don't send another (one slip = one crow,
// however many frames it lasts). The next mistake after the cooldown sends the next crow.
export const CROW_COOLDOWN_MS = 2000
// Dance this long with no mistakes and one crow flies off (then another after the same again).
export const CROW_FORGIVE_MS = 4000
// The perch lands crows at least this far apart (used when the flow stops mid-flight).
export const CROW_GAP_MS = 1000

export type Crows = { n: number; lastChange: number; lastMistake: number }
export const NO_CROWS: Crows = { n: 0, lastChange: -Infinity, lastMistake: -Infinity }

/** A mistake was seen at `now` (ms): a crow lands unless one landed within the cooldown. */
export function onMistake(c: Crows, now: number): Crows {
  if (c.n >= MAX_CROWS || now - c.lastChange < CROW_COOLDOWN_MS) return { ...c, lastMistake: now }
  return { n: c.n + 1, lastChange: now, lastMistake: now }
}

/** A clean moment at `now`: after a long enough clean stretch, one crow flies off. */
export function onClean(c: Crows, now: number): Crows {
  if (c.n === 0 || now - c.lastMistake < CROW_FORGIVE_MS || now - c.lastChange < CROW_FORGIVE_MS) return c
  return { ...c, n: c.n - 1, lastChange: now }
}

export const isMurder = (c: Crows) => c.n >= MAX_CROWS
