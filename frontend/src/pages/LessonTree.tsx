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

function moveName(routine: Routine, step: Step) {
  return routine.eight_counts.find((e) => e.idx === step.eight_counts[0])?.name ?? null
}

// A Duolingo-style path: a step unlocks when the one before it has been passed at any speed;
// bronze / silver / gold = passed at 0.5× / 0.75× / 1×.
export default function LessonTree({ routine, practise, flowAll, showProgress, replanned }: {
  routine: Routine
  practise: (index: number) => void
  flowAll: () => void
  showProgress: () => void
  replanned: () => void
}) {
  const api = useApi()
  const [progress, setProgress] = useState<Progress | null>(null)
  const [request, setRequest] = useState('')
  const [replanning, setReplanning] = useState(false)
  const [coachSays, setCoachSays] = useState<{ text: string; actions: string[] } | null>(null)
  const replan = async () => {
    setReplanning(true)
    try {
      const r = await api<{ explanation: string; actions: string[] }>(`/api/routines/${routine.id}/replan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request }),
      })
      setCoachSays({ text: r.explanation, actions: r.actions })
      setRequest('')
      replanned()
    } finally {
      setReplanning(false)
    }
  }
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
        <div className="tree-actions">
          <button className="primary" onClick={flowAll} title="Dance the whole routine in one continuous run, stopping only on noticeable mistakes">▶ Flow the whole routine</button>
          <button className="link" onClick={showProgress}>See progress →</button>
          <form
            className="replan"
            onSubmit={(e) => {
              e.preventDefault()
              if (request.trim().length >= 3) void replan()
            }}
          >
            <input placeholder='Tell the coach, e.g. "I have two weeks" or "I keep messing up the turn"' value={request} onChange={(e) => setRequest(e.target.value)} maxLength={300} />
            <button className="primary" disabled={replanning || request.trim().length < 3}>{replanning ? 'Re-planning…' : 'Re-plan'}</button>
          </form>
        </div>
        {coachSays && (
          <div className="coach-says">
            <p>🗣️ {coachSays.text}</p>
            {coachSays.actions.length > 0 && (
              <span className="notice">The coach looked at: {coachSays.actions.map((a) => a.replace('get_', '').replace('update_lesson_plan', 'and rewrote your plan').replace('_', ' ')).join(', ')}</span>
            )}
          </div>
        )}
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
                {s.type === 'learn' && moveName(routine, s) && <span className="node-moves">{moveName(routine, s)}</span>}
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
