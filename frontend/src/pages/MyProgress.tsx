import { useEffect, useState } from 'react'
import QuickLink from '../QuickLink'
import LoadingScreen from '../brand/LoadingScreen'
import { useApi } from '../api'

type MyStats = {
  totals: { reps: number; passes: number; avg_score: number | null; days_practised: number; sessions: number; minutes: number | string }
  streak: number
  daily: { day: string; reps: number; avg_score: number }[]
  routines: { id: string; title: string; status: string; steps_total: number; steps_passed: number; reps: number; avg_score: number | null; best_speed: number | null; last_practised: string | null }[]
  habits: { label: string; times: number; share: number; routine: string }[]
}

function ago(iso: string | null) {
  if (!iso) return 'not yet'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

// Progress across every routine: totals, streak, practice over the last 30 days, each routine,
// and the habits that keep coming up.
export default function MyProgress({ back, open }: { back: () => void; open: (id: string) => void }) {
  const api = useApi()
  const [s, setS] = useState<MyStats | null>(null)
  useEffect(() => {
    api<MyStats>('/api/me/stats').then(setS).catch(() => setS(null))
  }, [api])
  if (!s) return <LoadingScreen label="Loading your progress…" />
  const stepsPassed = s.routines.reduce((a, r) => a + r.steps_passed, 0)
  const stepsTotal = s.routines.reduce((a, r) => a + r.steps_total, 0)
  // Last 30 days, one bar per day (empty days included).
  const byDay = new Map(s.daily.map((d) => [d.day.slice(0, 10), d]))
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10)
    return { day: d, reps: byDay.get(d)?.reps ?? 0 }
  })
  const most = Math.max(1, ...days.map((d) => d.reps))
  return (
    <section className="progress">
      <QuickLink back onClick={back}>My routines</QuickLink>
      <h2 className="page-title">My progress</h2>
      <div className="tiles">
        <div className="tile"><b>{s.streak}</b><span>day streak</span></div>
        <div className="tile"><b>{stepsPassed}/{stepsTotal}</b><span>steps passed</span></div>
        <div className="tile"><b>{s.totals.reps}</b><span>reps</span></div>
        <div className="tile"><b>{Number(s.totals.minutes) || 0}</b><span>minutes practised</span></div>
        <div className="tile"><b>{s.totals.days_practised}</b><span>days practised</span></div>
        <div className="tile"><b>{s.totals.avg_score ?? '—'}</b><span>average score</span></div>
      </div>

      <div className="card habits-card" data-title="habits">
        <h3>Habits across your routines</h3>
        <p className="notice">Found by AI clustering of your missed reps.</p>
        <ul className="habit-list">
          {s.habits.length === 0 && <li className="notice">No patterns yet. Keep practising and they'll show up here.</li>}
          {s.habits.map((h, i) => (
            <li key={i}>
              <span className="habit-label">{h.label} <span className="notice">· {h.routine}</span></span>
              <span className="pbar"><span style={{ width: `${Math.round(h.share * 100)}%` }} /></span>
              <span className="notice">{Math.round(h.share * 100)}% of missed reps ({h.times})</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card" data-title="last-30-days">
        <h3>Practice, last 30 days</h3>
        <div className="spark days">
          {days.map((d) => (
            <span key={d.day} className={`bar ${d.reps ? 'pass' : ''}`} style={{ height: `${d.reps ? Math.max(6, (100 * d.reps) / most) : 2}%` }} title={`${d.day}: ${d.reps} reps`} />
          ))}
        </div>
        <span className="notice">Reps per day</span>
      </div>

      <div className="card" data-title="routines">
        <h3>Each routine</h3>
        <table className="routine-table">
          <thead><tr><th>Routine</th><th>Steps passed</th><th>Reps</th><th>Avg score</th><th>Last practised</th><th /></tr></thead>
          <tbody>
            {s.routines.map((r) => (
              <tr key={r.id}>
                <td><b>{r.title}</b></td>
                <td>
                  <span className="routine-progress">
                    <span className="pbar"><span style={{ width: `${r.steps_total ? Math.round((100 * r.steps_passed) / r.steps_total) : 0}%` }} /></span>
                    {r.steps_passed}/{r.steps_total}
                  </span>
                </td>
                <td>{r.reps}</td>
                <td>{r.avg_score ?? '—'}</td>
                <td>{ago(r.last_practised)}</td>
                <td>{r.status === 'ready' && <QuickLink onClick={() => open(r.id)}>Open</QuickLink>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
