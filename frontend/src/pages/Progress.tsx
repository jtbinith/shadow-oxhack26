import { useEffect, useState } from 'react'
import QuickLink from '../QuickLink'
import { MedalsInfo } from '../InfoTip'
import LoadingScreen from '../brand/LoadingScreen'
import { phraseName, useApi, type Routine } from '../api'

type Stats = {
  totals: { reps: number; passes: number; avg_score: number | null; best_score: number | null; timing_bias_ms: number | null; minutes: number | null }
  daily: { day: string; avg_score: number; best_score: number; reps: number }[]
  recent: { time: string; step_index: number; speed: number; drill: string; similarity: number; passed: boolean }[]
  reps_to_learn: { step_index: number; reps: number; learnt: boolean }[]
  habits: { label: string; times: number; share: number; body_part: string | null }[]
  mastery: { idx: number; rating: number; reps: number; passes: number; best_speed: number; due_at: string | null }[]
  streak: number
}

// Timing in words (no milliseconds): positive bias = late.
const timingWord = (ms: number | null) =>
  ms === null ? '—' : Math.abs(ms) < 60 ? 'on time' : ms > 0 ? (ms > 200 ? 'late' : 'a touch late') : ms < -200 ? 'early' : 'a touch early'

const tier = (s: number) => (s >= 1 ? 'gold' : s >= 0.75 ? 'silver' : s >= 0.5 ? 'bronze' : '—')

export default function Progress({ routine, back, practise }: { routine: Routine; back: () => void; practise: (stepIndex: number) => void }) {
  const api = useApi()
  const [s, setS] = useState<Stats | null>(null)
  useEffect(() => {
    api<Stats>(`/api/routines/${routine.id}/stats`).then(setS)
  }, [api, routine.id])
  if (!s) return <LoadingScreen label="Loading progress…" />
  const steps = routine.lesson_plan.steps ?? []
  const learnt = s.reps_to_learn.filter((r) => r.learnt).length
  const recent = [...s.recent].reverse()
  const label = (i: number) => {
    const st = steps[i]
    return st ? (st.type === 'chain' ? `Checkpoint ${st.eight_counts.map((x) => x + 1).join('+')}` : phraseName(routine, st.eight_counts[0])) : `Step ${i + 1}`
  }
  return (
    <section className="progress">
      <header className="practice-head">
        <QuickLink back onClick={back}>Lesson tree</QuickLink>
        <h2>Progress · {routine.title}</h2>
      </header>
      <div className="tiles">
        <div className="tile"><b>{learnt}/{steps.length}</b><span>steps learnt</span></div>
        <div className="tile"><b>{s.totals.reps}</b><span>reps · {s.totals.minutes ?? 0} min</span></div>
        <div className="tile"><b>{s.totals.best_score ?? '—'}</b><span>best score</span></div>
        <div className="tile"><b>{timingWord(s.totals.timing_bias_ms)}</b><span>timing on average</span></div>
      </div>

      <div className="card habits-card" data-title="habits">
        <h3>Your habits</h3>
        <p className="notice">Found by AI clustering: your missed reps, grouped by what went wrong (which limb, which way, which counts, timing).</p>
        <ul className="habit-list">
          {s.habits.length === 0 && <li className="notice">Not enough missed reps yet to spot a pattern (needs 4).</li>}
          {s.habits.map((h, i) => (
            <li key={i}>
              <span className="habit-label">{h.label}</span>
              <span className="pbar"><span style={{ width: `${Math.round(h.share * 100)}%` }} /></span>
              <span className="notice">{Math.round(h.share * 100)}% of missed reps ({h.times})</span>
            </li>
          ))}
        </ul>
      </div>

      {(() => {
        // The weakest practised step: lowest average score.
        const byStep = new Map<number, { sum: number; n: number }>()
        for (const r of s.recent) {
          const e = byStep.get(r.step_index) ?? { sum: 0, n: 0 }
          e.sum += r.similarity
          e.n++
          byStep.set(r.step_index, e)
        }
        const weakest = [...byStep.entries()].map(([i, e]) => [i, e.sum / e.n] as const).sort((a, b) => a[1] - b[1])[0]
        return weakest && weakest[1] < 85 ? (
          <div className="card weakest" data-title="weakest.txt">
            <h3>Weakest right now: {label(weakest[0])} (avg {Math.round(weakest[1])})</h3>
            <QuickLink className="primary" onClick={() => practise(weakest[0])}>Practise it now</QuickLink>
          </div>
        ) : null
      })()}

      <div className="card" data-title="history">
        <h3>Score, rep by rep</h3>
        <div className="spark">
          <i className="goal" style={{ bottom: '80%' }}><span>pass 80</span></i>
          {recent.map((r, i) => (
            <span key={i} className={`bar ${r.passed ? 'pass' : ''}`} style={{ height: `${Math.max(4, r.similarity)}%` }} title={`${label(r.step_index)} · ${r.speed}× · ${r.drill}: ${Math.round(r.similarity)}`} />
          ))}
        </div>
        <span className="notice">Last {recent.length} reps · black = passed · dashed line = pass mark (80)</span>
      </div>

      <div className="grid2">
        <div className="card" data-title="mastery">
          <h3>Move mastery</h3>
          <table>
            <thead><tr><th>Phrase</th><th>Rating</th><th>Tier <MedalsInfo /></th><th>Reps</th><th>Review</th></tr></thead>
            <tbody>
              {s.mastery.map((m) => (
                <tr key={m.idx}>
                  <td>{m.idx + 1}</td><td>{m.rating}</td><td className={tier(m.best_speed)}>{tier(m.best_speed)}</td><td>{m.reps}</td>
                  <td>{m.due_at ? (new Date(m.due_at) < new Date() ? 'due now' : new Date(m.due_at).toLocaleDateString()) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card" data-title="reps-to-learn">
          <h3>Reps to learn</h3>
          <ul className="plain">
            {s.reps_to_learn.map((r) => <li key={r.step_index}>{label(r.step_index)}: {r.reps} reps{r.learnt ? '' : ' (not passed yet)'}</li>)}
          </ul>
        </div>
      </div>
    </section>
  )
}
