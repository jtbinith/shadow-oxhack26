import { useEffect, useState } from 'react'
import { SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/clerk-react'
import PoseCam from './pose/PoseCam'
import Home from './pages/Home'
import Processing from './pages/Processing'
import LessonTree from './pages/LessonTree'
import Practice from './pages/Practice'
import ProgressPage from './pages/Progress'
import { useApi, type Routine } from './api'

type View = { name: 'home' } | { name: 'routine'; id: string } | { name: 'camera' }

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
        {view.name === 'routine' && <RoutineView id={view.id} />}
        {view.name === 'camera' && <PoseCam />}
      </SignedIn>
    </main>
  )
}

// Shows processing progress until the course is ready, then the lesson tree / practice.
function RoutineView({ id }: { id: string }) {
  const api = useApi()
  const [routine, setRoutine] = useState<Routine | null>(null)
  const [practising, setPractising] = useState<number | null>(null)
  const [showProgress, setShowProgress] = useState(false)
  const [reload, setReload] = useState(0)
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
  }, [api, id, reload])
  if (!routine) return <p className="notice">Loading…</p>
  if (routine.status !== 'ready') return <Processing routine={routine} />
  const steps = routine.lesson_plan.steps ?? []
  if (practising !== null && steps[practising]) {
    return (
      <Practice
        key={practising}
        routine={routine}
        stepIndex={practising}
        step={steps[practising]}
        onExit={() => setPractising(null)}
        onNextStep={() => setPractising(practising + 1 < steps.length ? practising + 1 : null)}
      />
    )
  }
  if (showProgress) return <ProgressPage routine={routine} back={() => setShowProgress(false)} />
  return <LessonTree routine={routine} practise={setPractising} showProgress={() => setShowProgress(true)} replanned={() => setReload((n) => n + 1)} />
}
