import { useEffect, useState } from 'react'
import { SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/clerk-react'
import PoseCam from './pose/PoseCam'
import Home from './pages/Home'
import Processing from './pages/Processing'
import LessonTree from './pages/LessonTree'
import { useApi, type Routine, type Step } from './api'

type View = { name: 'home' } | { name: 'routine'; id: string } | { name: 'camera' } | { name: 'practise'; id: string; step: Step }

export default function App() {
  const [view, setView] = useState<View>({ name: 'home' })
  return (
    <main>
      <header>
        <h1 className="logo" onClick={() => setView({ name: 'home' })}>
          Shadow
        </h1>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </header>
      <SignedOut>
        <section className="hero">
          <p>Learn any dance from any video, with a coach that adapts to every rep.</p>
          <SignInButton mode="modal" />
        </section>
      </SignedOut>
      <SignedIn>
        {view.name === 'home' && <Home open={(id) => setView({ name: 'routine', id })} tryCamera={() => setView({ name: 'camera' })} />}
        {view.name === 'routine' && <RoutineView id={view.id} practise={(step) => setView({ name: 'practise', id: view.id, step })} />}
        {view.name === 'camera' && <PoseCam />}
        {view.name === 'practise' && (
          <section>
            <p className="notice">Practice screen coming next (ghost, scoring, coach). Camera preview:</p>
            <PoseCam />
          </section>
        )}
      </SignedIn>
    </main>
  )
}

// Shows processing progress until the course is ready, then the lesson tree.
function RoutineView({ id, practise }: { id: string; practise: (step: Step) => void }) {
  const api = useApi()
  const [routine, setRoutine] = useState<Routine | null>(null)
  useEffect(() => {
    let stop = false
    let timer = 0
    const poll = async () => {
      try {
        const r = await api<Routine>(`/api/routines/${id}`)
        if (stop) return
        setRoutine(r)
        if (r.status === 'processing') timer = window.setTimeout(poll, 1500)
      } catch {
        if (!stop) timer = window.setTimeout(poll, 3000)
      }
    }
    poll()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [api, id])
  if (!routine) return <p className="notice">Loading…</p>
  return routine.status === 'ready' ? <LessonTree routine={routine} practise={practise} /> : <Processing routine={routine} />
}
