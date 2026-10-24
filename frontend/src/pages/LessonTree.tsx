import { useEffect, useState } from 'react'
import { useApi, type Routine, type Step } from '../api'

type Progress = { steps: { index: number; best_speed: number | null; unlocked: boolean }[] }

const TIERS = [
  { speed: 0.5, name: 'bronze' },
  { speed: 0.75, name: 'silver' },
  { speed: 1, name: 'gold' },
]

function label(step: Step) {
  const n = step.eight_counts.map((i) => i + 1)
  return step.type === 'chain' ? `Checkpoint ${n.join('+')}` : `8-count ${n[0]}`
}

// A Duolingo-style path: a step unlocks when the one before it has been passed at any speed;
// bronze / silver / gold = passed at 0.5× / 0.75× / 1×.
export default function LessonTree({ routine, practise }: { routine: Routine; practise: (index: number) => void }) {
  const api = useApi()
  const [progress, setProgress] = useState<Progress | null>(null)
  useEffect(() => {
    api<Progress>(`/api/routines/${routine.id}/progress`).then(setProgress).catch(() => setProgress(null))
  }, [api, routine.id])
  const steps = routine.lesson_plan.steps ?? []
  const repeats = routine.eight_counts.filter((e) => e.repeat_of !== null)
  return (
    <section className="tree">
      <header className="tree-head">
        <h2>{routine.title}</h2>
        <p className="notice">
          {Math.round(routine.tempo_bpm ?? 0)} BPM · {routine.eight_counts.length} eight-counts
          {repeats.length ? ` · ${repeats.length} repeat${repeats.length > 1 ? 's' : ''} learnt once` : ''}
          {routine.lesson_plan.source === 'gemini' ? ' · plan by Gemini' : ''}
        </p>
        {routine.lesson_plan.summary && <p>{routine.lesson_plan.summary}</p>}
      </header>
      <ol className="path">
        {steps.map((s, i) => {
          const p = progress?.steps[i]
          const locked = p ? !p.unlocked : i > 0
          const best = p?.best_speed ?? 0
          return (
            <li key={i} className={`node ${s.type} ${locked ? 'locked' : 'open'}`} style={{ marginLeft: `${(Math.sin(i * 0.9) + 1) * 22}%` }}>
              <button disabled={locked} onClick={() => practise(i)} title={locked ? 'Pass the step before to unlock' : 'Practise'}>
                <span className="node-label">{label(s)}</span>
                <span className="tiers">
                  {TIERS.map((t) => (
                    <span key={t.name} className={`tier ${t.name} ${best >= t.speed ? 'earned' : ''}`} title={`${t.name}: pass at ${t.speed}×`} />
                  ))}
                </span>
                <span className="node-meta">
                  starts at {s.start_speed}×{s.note ? ` · ${s.note}` : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
