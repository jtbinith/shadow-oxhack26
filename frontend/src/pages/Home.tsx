import { useEffect, useRef, useState } from 'react'
import { useApi, type Routine } from '../api'
import { STYLES } from '../coach/styles'

type Summary = Pick<Routine, 'id' | 'title' | 'status' | 'tempo_bpm' | 'created_at'>

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

  useEffect(() => {
    api<Summary[]>('/api/routines').then(setRoutines).catch(() => setRoutines([]))
  }, [api])

  const upload = async () => {
    if (!file) return
    setBusy(true)
    setError('')
    const form = new FormData()
    form.append('video', file)
    form.append('title', title || file.name.replace(/\.[^.]+$/, ''))
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
    <div className="home">
      <section className="card upload">
        <h2>Learn a new routine</h2>
        <div
          className={`drop ${file ? 'has-file' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) setFile(f)
          }}
        >
          {file ? <strong>{file.name}</strong> : <span>Drop a dance video here, or click to choose (up to 3 min)</span>}
          <input ref={input} type="file" accept="video/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <input className="title" placeholder="Routine name (optional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
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
          This is my routine, my teacher's, or I'm using it for personal practice. Shadow deletes the audio and video after processing.
        </label>
        <p className="tips">Best results: one dancer, full body in frame, camera still and front-on, good light.</p>
        <button className="primary" disabled={!file || !rights || busy} onClick={upload}>
          {busy ? 'Uploading…' : 'Build my course'}
        </button>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h2>Your routines</h2>
        {routines === null && <p className="notice">Loading…</p>}
        {routines?.length === 0 && <p className="notice">None yet. Upload one above.</p>}
        <ul className="routines">
          {routines?.map((r) => (
            <li key={r.id}>
              <button onClick={() => open(r.id)}>
                <span>{r.title}</span>
                <span className={`badge ${r.status}`}>{r.status === 'ready' ? `${Math.round(r.tempo_bpm ?? 0)} BPM` : r.status}</span>
              </button>
            </li>
          ))}
        </ul>
        <button className="link" onClick={tryCamera}>
          Just try the camera →
        </button>
      </section>
    </div>
  )
}
