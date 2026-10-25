import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import QuickLink from '../QuickLink'
import { phraseName, useApi, type Routine } from '../api'

type Progress = { steps: { index: number; best_speed: number | null; unlocked: boolean }[] }

const TIERS = [
  { speed: 0.5, name: 'bronze' },
  { speed: 0.75, name: 'silver' },
  { speed: 1, name: 'gold' },
]

// A still from the routine video for one phrase (needs the auth token, so fetched as a blob).
function useThumb(routineId: string, idx: number) {
  const { getToken } = useAuth()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let u: string | null = null
    let live = true
    ;(async () => {
      try {
        const get = async () => fetch(`/api/routines/${routineId}/eight-counts/${idx}/thumb`, { headers: { Authorization: `Bearer ${await getToken()}` } })
        let res = await get()
        if (!res.ok) res = await new Promise<Response>((r) => setTimeout(() => void get().then(r), 800)) // one retry
        if (!res.ok || !live) return
        u = URL.createObjectURL(await res.blob())
        setUrl(u)
      } catch { /* no thumbnail */ }
    })()
    return () => {
      live = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [getToken, routineId, idx])
  return url
}

function Thumb({ routineId, idx }: { routineId: string; idx: number }) {
  const url = useThumb(routineId, idx)
  return url ? <img className="block-thumb" src={url} alt="" /> : <span className="block-thumb empty" />
}

function Medals({ best }: { best: number }) {
  return (
    <span className="tiers">
      {TIERS.map((t) => <span key={t.name} className={`tier ${t.name} ${best >= t.speed ? 'earned' : ''}`} title={`${t.name}: pass at ${t.speed}×`} />)}
    </span>
  )
}

export default function LessonTree({ routine, back, practise, flowAll, showProgress, replanned }: {
  routine: Routine
  back: () => void
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
  const columns = [...new Set(steps.flatMap((s) => s.eight_counts))].sort((a, b) => a - b)
  const indexed = steps.map((s, i) => ({ s, i }))
  const phrases = indexed.filter(({ s }) => s.type === 'learn')
  const checkpoints = indexed.filter(({ s }) => s.type === 'chain')
  const passed = progress ? progress.steps.filter((p) => p.best_speed !== null).length : 0
  const allFour = routine.eight_counts.every((e) => e.count_times.length === 4)
  const looked = coachSays?.actions.map((a) => a.replace('get_', '').replace('update_lesson_plan', 'rewrote your plan').replace('_', ' ')) ?? []

  return (
    <section className="tree">
      <QuickLink back onClick={back}>My routines</QuickLink>
      <header className="tree-head window" data-title="lesson-plan">
        <div className="tree-title">
          <h2>{routine.title}</h2>
          <ul className="facts">
            <li><b>{Math.round(routine.tempo_bpm ?? 0)}</b> BPM</li>
            <li><b>{routine.eight_counts.length}</b> {allFour ? 'four' : 'eight'}-count{routine.eight_counts.length === 1 ? '' : 's'}</li>
            {repeats.length > 0 && <li><b>{repeats.length}</b> repeat{repeats.length > 1 ? 's' : ''} learnt once</li>}
            <li><b>{passed}/{steps.length}</b> steps passed</li>
            {routine.lesson_plan.source && routine.lesson_plan.source !== 'rules' && <li>plan by the coach</li>}
          </ul>
        </div>
        {routine.lesson_plan.summary && <p className="tree-summary">{routine.lesson_plan.summary}</p>}
        <div className="tree-actions">
          <button className="primary" onClick={flowAll} title="Dance the whole routine in one continuous run, stopping only on noticeable mistakes">Flow the whole routine</button>
          <QuickLink onClick={showProgress}>See progress</QuickLink>
        </div>
      </header>

      <section className="window plan-coach" data-title="plan-coach">
        <form className="replan" onSubmit={(e) => { e.preventDefault(); if (request.trim().length >= 3) void replan() }}>
          <input placeholder='Tell the coach, e.g. "I have two weeks" or "I keep messing up the turn"' value={request} onChange={(e) => setRequest(e.target.value)} maxLength={300} />
          <button className="primary" disabled={replanning || request.trim().length < 3}>{replanning ? 'Re-planning…' : 'Re-plan'}</button>
        </form>
        {coachSays && (
          <div className="coach-says">
            <p><b>Coach:</b> {coachSays.text}</p>
            {looked.length > 0 && <p className="notice">Looked at {looked.join(', ')}.</p>}
          </div>
        )}
      </section>

      {/* The phrases, each learnt on its own */}
      <ol className="phrases" aria-label="Phrases">
        {phrases.map(({ s, i }) => {
          const p = progress?.steps[i]
          const locked = p ? !p.unlocked : i > 0
          const best = p?.best_speed ?? 0
          const ec = routine.eight_counts.find((e) => e.idx === s.eight_counts[0])
          return (
            <li key={i} className={`phrase ${locked ? 'locked' : ''} ${best > 0 ? 'done' : ''}`}>
              <button disabled={locked} onClick={() => practise(i)} title={locked ? 'Pass the step before to unlock' : `Practise ${phraseName(routine, s.eight_counts[0])}`}>
                <Thumb routineId={routine.id} idx={s.eight_counts[0]} />
                <span className="phrase-label">{phraseName(routine, s.eight_counts[0])}</span>
                {ec?.name && <span className="phrase-moves">{ec.name}</span>}
                <span className="phrase-foot">
                  <Medals best={best} />
                  <span className="notice">{locked ? 'locked' : `${s.start_speed}×`}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      {/* Checkpoints: joining the phrases up, ending with the whole routine */}
      {checkpoints.length > 0 && (
        <div className="checkpoints">
          <span className="checkpoints-title">Checkpoints</span>
          <ol className="checkpoint-bar">
            {checkpoints.map(({ s, i }, k) => {
              const p = progress?.steps[i]
              const locked = p ? !p.unlocked : true
              const best = p?.best_speed ?? 0
              const last = s.eight_counts
              const whole = k === checkpoints.length - 1 && last.length === columns.length
              const name = whole ? 'Whole routine' : `${last[0] + 1}–${last[last.length - 1] + 1}`
              return (
                <li key={i} className={`cp ${locked ? 'locked' : best > 0 ? 'done' : 'open'} ${whole ? 'whole' : ''}`}>
                  <button disabled={locked} onClick={() => practise(i)} title={locked ? 'Unlocks as you pass the phrases before it' : `Practise checkpoint ${name}`}>
                    <span className="cp-node">{whole ? '★' : ''}</span>
                    <span className="cp-label">{name}</span>
                    {best > 0 && <Medals best={best} />}
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}
