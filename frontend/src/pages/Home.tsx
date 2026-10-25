import { useEffect, useRef, useState } from 'react'
import { useApi, type Routine } from '../api'
import QuickLink from '../QuickLink'
import LoadingScreen from '../brand/LoadingScreen'
import { STYLES } from '../coach/styles'

type Summary = Pick<Routine, 'id' | 'title' | 'status' | 'tempo_bpm' | 'created_at'> & { steps_total?: number; steps_passed?: number }

export default function Home({ open, tryCamera }: { open: (id: string) => void; tryCamera: () => void }) {
  const api = useApi()
  const [routines, setRoutines] = useState<Summary[] | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [style, setStyle] = useState('general')
  const [rights, setRights] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  // Name: required and unique (ignoring capitals and extra spaces).
  const name = title.split(/\s+/).filter(Boolean).join(' ')
  const taken = !!routines?.some((r) => r.title.trim().toLowerCase() === name.toLowerCase())
  const nameOk = name.length > 0 && !taken
  const pick = (f: File | null) => {
    setFile(f)
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80))
  }

  useEffect(() => {
    api<Summary[]>('/api/routines').then(setRoutines).catch(() => setRoutines([]))
  }, [api])

  const upload = async () => {
    if (!file || !nameOk) return
    setBusy(true)
    setError('')
    const form = new FormData()
    form.append('video', file)
    form.append('title', name)
    form.append('style', style)
    form.append('rights', String(rights))
    try {
      const r = await api<{ id: string }>('/api/routines', { method: 'POST', body: form })
      open(r.id)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
    <section className="intro">
      <h1>Hello.<br />Learn any dance.</h1>
      <p>Upload a dance video. Shadow cuts it into counts, builds you a lesson path, and coaches you live through your camera.</p>
      <p className="lore"><mark>You shadow the dancer, move for move. The crows are watching too: slip up and they gather.</mark></p>
    </section>
    <div className="home">
      <section className="card upload" data-title="new-routine.mov">
        <h2>Learn a new routine</h2>
        <div
          className={`drop ${file ? 'has-file' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) pick(f)
          }}
        >
          {file ? <strong>{file.name}</strong> : <span>Drop a dance video here, or click to choose (up to 10 min)</span>}
          <input ref={input} type="file" accept="video/*" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </div>
        <input className={`title ${taken ? 'invalid' : ''}`} placeholder="Routine name" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required aria-invalid={taken || !name} />
        {taken && <p className="error">You already have a routine called “{name}”. Pick another name.</p>}
        <label className="style-pick">
          Style{' '}
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            {Object.values(STYLES).map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>{' '}
          <span className="notice">changes how you're judged and coached, not the steps</span>
        </label>
        <label className="rights">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
          This is my routine, my teacher's, or I'm using it for personal practice. Shadow deletes the audio after processing and keeps a silent copy of the video for your practice preview.
        </label>
        <p className="tips">Best results: one dancer, full body in frame, camera still and front-on, good light.</p>
        <button className="primary" disabled={!file || !nameOk || !rights || busy} title={!name ? 'Give the routine a name' : taken ? 'That name is taken' : undefined} onClick={upload}>
          {busy ? 'Uploading…' : 'Build my course'}
        </button>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card" data-title="my-routines">
        <h2>Your routines</h2>
        {routines === null && <LoadingScreen small label="Loading your routines…" />}
        {routines?.length === 0 && <p className="notice">None yet. Upload one above.</p>}
        <ul className="routines">
          {routines?.map((r) => (
            <li key={r.id}>
              <button onClick={() => open(r.id)}>
                <span className="routine-name">{r.title}</span>
                <span className={`badge ${r.status}`}>{r.status === 'ready' ? `${Math.round(r.tempo_bpm ?? 0)} BPM` : r.status}</span>
                {r.status === 'ready' && (r.steps_total ?? 0) > 0 && (
                  <span className="routine-progress" title={`${r.steps_passed ?? 0} of ${r.steps_total} steps passed`}>
                    <span className="pbar"><span style={{ width: `${Math.round((100 * (r.steps_passed ?? 0)) / r.steps_total!)}%` }} /></span>
                    <span className="notice">{r.steps_passed ?? 0}/{r.steps_total} steps</span>
                  </span>
                )}
                {r.status === 'processing' && <span className="routine-progress"><span className="pbar busy"><span /></span><span className="notice">building</span></span>}
              </button>
            </li>
          ))}
        </ul>
        <QuickLink className="primary" onClick={tryCamera}>Just try the camera</QuickLink>
      </section>
    </div>
    </>
  )
}
