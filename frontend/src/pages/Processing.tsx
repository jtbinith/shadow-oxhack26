import type { Routine } from '../api'

// The steps a viewer sees, in order, with the stage name that completes each.
const STEPS: { stage: string; label: string }[] = [
  { stage: 'received', label: 'Video received' },
  { stage: 'converted', label: 'Converted to 30 fps' },
  { stage: 'beats', label: 'Beats and counts found' },
  { stage: 'audio_deleted', label: 'Audio deleted' },
  { stage: 'pose', label: 'Dancer’s skeleton extracted' },
  { stage: 'video_kept', label: 'Silent video kept for your previews' },
  { stage: 'segmented', label: 'Cut into 8-counts' },
  { stage: 'planned', label: 'Course built' },
]

export default function Processing({ routine }: { routine: Routine }) {
  const done = new Set(routine.stages.map((s) => s.stage))
  const detail = (name: string) => routine.stages.filter((s) => s.stage === name).at(-1)
  const progress = detail('pose_progress')
  const next = STEPS.find((s) => !done.has(s.stage))
  return (
    <section className="card processing">
      <h2>Building “{routine.title}”</h2>
      <ol>
        {STEPS.map((s) => {
          const d = detail(s.stage)
          const extra =
            s.stage === 'beats' && d ? ` · ${d.tempo} BPM${d.source === 'default' ? ' (no music found: using 100 BPM)' : ''}` :
            s.stage === 'segmented' && d ? ` · ${d.eight_counts} eight-counts, ${d.repeats} repeats` :
            s.stage === 'planned' && d ? ` · ${d.steps} steps (${d.source === 'gemini' ? 'Gemini' : 'standard plan'})` : ''
          const state = done.has(s.stage) ? 'done' : s === next ? 'active' : 'todo'
          return (
            <li key={s.stage} className={state}>
              <span className="tick">{state === 'done' ? <svg viewBox="0 0 24 24" width="16" height="16" aria-label="Done"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg> : state === 'active' ? '…' : ''}</span>
              {s.label}
              {extra}
              {state === 'active' && s.stage === 'pose' && progress ? ` (${progress.percent}%)` : ''}
            </li>
          )
        })}
      </ol>
      {routine.status === 'failed' && <p className="error">Processing failed: {routine.error}</p>}
    </section>
  )
}
