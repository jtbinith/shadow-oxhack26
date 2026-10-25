import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import QuickLink from '../QuickLink'
import { phraseName, useApi, type Routine, type Step } from '../api'

type Progress = { steps: { index: number; best_speed: number | null; unlocked: boolean }[] }

const TIERS = [
  { speed: 0.5, name: 'bronze' },
  { speed: 0.75, name: 'silver' },
  { speed: 1, name: 'gold' },
]

// Building blocks: the bottom row is each phrase on its own; every block above joins the
// phrases under it into a checkpoint, up to the whole routine at the top. A block sits over
// exactly the phrases it contains, so the chaining (A, B, A+B, C, A+B+C…) is visible.
type Block = { step: number; from: number; to: number; row: number }

export function layoutBlocks(steps: Step[], columns: number[]): { blocks: Block[]; rows: number } {
  const col = new Map(columns.map((idx, c) => [idx, c]))
  const items = steps.map((s, i) => {
    const cs = s.eight_counts.map((e) => col.get(e) ?? 0)
    return { step: i, from: Math.min(...cs), to: Math.max(...cs), single: s.type === 'learn' && s.eight_counts.length === 1 }
  })
  const blocks: Block[] = []
  const base = new Set<number>()
  // Row 0: the first "learn" step for each phrase.
  for (const it of items) {
    if (it.single && !base.has(it.from)) {
      base.add(it.from)
      blocks.push({ step: it.step, from: it.from, to: it.to, row: 0 })
    }
  }
  // Everything else, narrowest first: above anything it contains, in the lowest free row.
  const rest = items.filter((it) => !blocks.some((b) => b.step === it.step)).sort((a, b) => a.to - a.from - (b.to - b.from) || a.step - b.step)
  for (const it of rest) {
    let row = 1 + Math.max(0, ...blocks.filter((b) => b.from >= it.from && b.to <= it.to).map((b) => b.row))
    while (blocks.some((b) => b.row === row && b.from <= it.to && it.from <= b.to)) row++
    blocks.push({ step: it.step, from: it.from, to: it.to, row })
  }
  return { blocks, rows: Math.max(0, ...blocks.map((b) => b.row)) + 1 }
}

// A still from the routine video for one phrase (needs the auth token, so fetched as a blob).
function useThumb(routineId: string, idx: number) {
  const { getToken } = useAuth()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let u: string | null = null
    let live = true
    ;(async () => {
      try {
        const res = await fetch(`/api/routines/${routineId}/eight-counts/${idx}/thumb`, { headers: { Authorization: `Bearer ${await getToken()}` } })
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
  const { blocks, rows } = layoutBlocks(steps, columns)
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

      <div className="blocks-scroll">
        <ol className="blocks" style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(150px, 1fr))` }}>
          {blocks.map((b) => {
            const s = steps[b.step]
            const p = progress?.steps[b.step]
            const locked = p ? !p.unlocked : b.step > 0
            const best = p?.best_speed ?? 0
            const whole = s.type === 'chain' && b.from === 0 && b.to === columns.length - 1 && columns.length > 1
            const ec = routine.eight_counts.find((e) => e.idx === s.eight_counts[0])
            return (
              <li
                key={b.step}
                className={`block ${b.row === 0 ? 'base' : 'chain'} ${locked ? 'locked' : ''} ${best > 0 ? 'done' : ''}`}
                style={{ gridColumn: `${b.from + 1} / ${b.to + 2}`, gridRow: rows - b.row }}
              >
                <button disabled={locked} onClick={() => practise(b.step)} title={locked ? 'Pass the step before to unlock' : 'Practise this'}>
                  {b.row === 0 && <Thumb routineId={routine.id} idx={s.eight_counts[0]} />}
                  <span className="block-label">
                    {b.row === 0 ? phraseName(routine, s.eight_counts[0]) : whole ? 'Whole routine' : `Checkpoint ${s.eight_counts[0] + 1}–${s.eight_counts[s.eight_counts.length - 1] + 1}`}
                  </span>
                  {b.row === 0 && ec?.name && <span className="block-moves">{ec.name}</span>}
                  <span className="block-foot">
                    <Medals best={best} />
                    <span className="notice">{locked ? 'locked' : `from ${s.start_speed}×`}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
