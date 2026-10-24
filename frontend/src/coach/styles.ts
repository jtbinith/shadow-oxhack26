// Style profiles: the same moves, judged by what matters in that style.
// Weights blend the component scores; tau is the timing forgiveness; the vocabulary
// recolours cues ("Hit 3 with the dhol"); watched bones get priority in fault ranking.

import type { Fault } from './score'

export type StyleProfile = {
  id: string
  label: string
  weights: { shape: number; timing: number; dynamics: number }
  tauMs: number
  // bone indexes (see BONES in score.ts) that this style cares most about; empty = all equal
  watched: number[]
  hitWord: string // what you "hit" on the beat in this style
  cues: {
    late: (c: number) => string
    early: (c: number) => string
    soft: (c: number) => string
    stiff: (c: number) => string
  }
}

const base = (p: Partial<StyleProfile> & Pick<StyleProfile, 'id' | 'label'>): StyleProfile => ({
  weights: { shape: 0.55, timing: 0.3, dynamics: 0.15 },
  tauMs: 100,
  watched: [],
  hitWord: 'the beat',
  cues: {
    late: (c) => `Hit ${c} right on the beat. You're a touch late.`,
    early: (c) => `Wait for ${c}. You're jumping ahead.`,
    soft: (c) => `Sharper on ${c}. Hit and stop.`,
    stiff: (c) => `Smoother through ${c}. Let it flow.`,
  },
  ...p,
})

export const STYLES: Record<string, StyleProfile> = {
  general: base({ id: 'general', label: 'General' }),
  bollywood: base({
    id: 'bollywood',
    label: 'Bollywood / Desi fusion',
    weights: { shape: 0.4, timing: 0.35, dynamics: 0.25 },
    tauMs: 90,
    watched: [0, 1, 2, 3], // arms carry the storytelling
    hitWord: 'the dhol',
    cues: {
      late: (c) => `Hit ${c} with the dhol. You're a touch late.`,
      early: (c) => `Wait for the dhol on ${c}.`,
      soft: (c) => `Punch ${c} harder. Hit and stop.`,
      stiff: (c) => `Let ${c} bounce. Loose shoulders.`,
    },
  }),
  hiphop: base({
    id: 'hiphop',
    label: 'Hip-hop',
    weights: { shape: 0.35, timing: 0.35, dynamics: 0.3 },
    tauMs: 80,
    watched: [8, 10, 11, 4, 6], // chest and knees: the groove
    hitWord: 'the snare',
    cues: {
      late: (c) => `Hit ${c} on the snare. You're behind it.`,
      early: (c) => `Sit in the groove. ${c} comes later.`,
      soft: (c) => `Harder hit on ${c}. Stop it dead.`,
      stiff: (c) => `Too stiff through ${c}. Ride the bounce.`,
    },
  }),
  kpop: base({
    id: 'kpop',
    label: 'K-pop',
    weights: { shape: 0.55, timing: 0.35, dynamics: 0.1 },
    tauMs: 80,
    watched: [0, 1, 2, 3, 12, 13], // arm lines and head angle: unison lines
  }),
  contemporary: base({
    id: 'contemporary',
    label: 'Contemporary',
    weights: { shape: 0.5, timing: 0.2, dynamics: 0.3 },
    tauMs: 140,
    watched: [8, 9, 10, 11], // spine and torso
    cues: {
      late: (c) => `Arrive into ${c} with the music.`,
      early: (c) => `Don't rush ${c}. Breathe into it.`,
      soft: (c) => `Commit to ${c}. Fill the shape.`,
      stiff: (c) => `Melt through ${c}. Let it flow.`,
    },
  }),
  bharatanatyam: base({
    id: 'bharatanatyam',
    label: 'Bharatanatyam',
    weights: { shape: 0.6, timing: 0.3, dynamics: 0.1 },
    tauMs: 90,
    watched: [4, 6, 0, 2], // bent knees (araimandi) and arm lines
    hitWord: 'the sollukattu',
    cues: {
      late: (c) => `Land ${c} on the sollukattu. You're late.`,
      early: (c) => `Hold for ${c}. Don't rush the tala.`,
      soft: (c) => `Stamp ${c} cleanly. Sharp and still.`,
      stiff: (c) => `Softer between ${c}. Keep the line.`,
    },
  }),
}

export const styleFor = (id: string | null | undefined): StyleProfile => STYLES[id ?? 'general'] ?? STYLES.general

/** Style-flavoured wording for a fault (shape faults keep the body-part wording). */
export function styleCue(style: StyleProfile, f: Fault | null): string | null {
  if (!f) return null
  if (f.type === 'late') return style.cues.late(f.count)
  if (f.type === 'early') return style.cues.early(f.count)
  if (f.type === 'soft') return style.cues.soft(f.count)
  if (f.type === 'stiff') return style.cues.stiff(f.count)
  return null
}
