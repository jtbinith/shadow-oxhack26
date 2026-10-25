import { useCallback, useEffect, useState } from 'react'
import { ClerkLoading, SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/clerk-react'
import PoseCam from './pose/PoseCam'
import Home from './pages/Home'
import Processing from './pages/Processing'
import LessonTree from './pages/LessonTree'
import Practice from './pages/Practice'
import ProgressPage from './pages/Progress'
import MyProgress from './pages/MyProgress'
import QuickLink from './QuickLink'
import Crow from './brand/Crow'
import LoadingScreen from './brand/LoadingScreen'
import DancingCrows from './brand/DancingCrows'
import { useApi, type Routine } from './api'

// Navigation lives in the browser history, so the browser / phone back button works everywhere.
type Screen = { name: 'tree' } | { name: 'progress' } | { name: 'practice'; step: number; whole: boolean }
type View = { name: 'home' } | { name: 'camera' } | { name: 'me' } | { name: 'routine'; id: string; screen: Screen }
type Nav = { go: (v: View, replace?: boolean) => void; back: (fallback: View) => void }

function useNav(): { view: View } & Nav {
  const [view, setView] = useState<View>(() => (history.state?.view as View) ?? { name: 'home' })
  useEffect(() => {
    if (!history.state?.view) history.replaceState({ view, depth: 0 }, '')
    const onPop = (e: PopStateEvent) => setView((e.state?.view as View) ?? { name: 'home' })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const go = useCallback((v: View, replace = false) => {
    const depth = (history.state?.depth ?? 0) + (replace ? 0 : 1)
    if (replace) history.replaceState({ view: v, depth }, '')
    else history.pushState({ view: v, depth }, '')
    setView(v)
    window.scrollTo(0, 0)
  }, [])
  // Back within the app if we came from somewhere in it; otherwise straight to the parent screen.
  const back = useCallback((fallback: View) => {
    if ((history.state?.depth ?? 0) > 0) history.back()
    else go(fallback, true)
  }, [go])
  return { view, go, back }
}

export default function App() {
  const { view, go, back } = useNav()
  const home: View = { name: 'home' }
  return (
    <main>
      <header>
        <h1 className="logo" onClick={() => go(home)}>
          <span className="logo-mark"><Crow size={38} pose="caw" inverse title="Shadow" /></span>
          Shadow
        </h1>
        <SignedIn>
          <nav className="topnav">
            <button className={`navlink ${view.name === 'home' ? 'on' : ''}`} onClick={() => go(home)}>My routines</button>
            <button className={`navlink ${view.name === 'me' ? 'on' : ''}`} onClick={() => go({ name: 'me' })}>My progress</button>
            <UserButton />
          </nav>
        </SignedIn>
      </header>
      <ClerkLoading>
        <LoadingScreen label="Waking the crows…" />
      </ClerkLoading>
      <SignedOut>
        <section className="hero">
          <DancingCrows />
          <h1>Hello.<br />Learn any dance.</h1>
          <p>From any video, with a coach that adapts to every rep.</p>
          <p className="lore"><mark>You shadow the dancer, move for move. The crows are watching too: slip up and they gather.</mark></p>
          <SignInButton mode="modal" />
        </section>
      </SignedOut>
      <SignedIn>
        {view.name === 'home' && <Home open={(id) => go({ name: 'routine', id, screen: { name: 'tree' } })} tryCamera={() => go({ name: 'camera' })} />}
        {view.name === 'me' && <MyProgress back={() => back(home)} open={(id) => go({ name: 'routine', id, screen: { name: 'tree' } })} />}
        {view.name === 'routine' && <RoutineView id={view.id} screen={view.screen} go={go} back={back} />}
        {view.name === 'camera' && (
          <section>
            <QuickLink back onClick={() => back(home)}>Back</QuickLink>
            <PoseCam />
          </section>
        )}
      </SignedIn>
    </main>
  )
}

// Shows processing progress until the course is ready, then the lesson tree / practice / progress.
function RoutineView({ id, screen, go, back }: { id: string; screen: Screen } & Nav) {
  const api = useApi()
  const [routine, setRoutine] = useState<Routine | null>(null)
  const [reload, setReload] = useState(0)
  const at = (sc: Screen): View => ({ name: 'routine', id, screen: sc })
  const tree = at({ name: 'tree' })
  const home: View = { name: 'home' }
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
    // Refetch when coming back to a screen, so newly unlocked steps show.
  }, [api, id, reload, screen.name])
  if (!routine) return <LoadingScreen label="Loading the routine…" />
  if (routine.status !== 'ready')
    return (
      <>
        <QuickLink back onClick={() => back(home)}>My routines</QuickLink>
        <Processing routine={routine} />
      </>
    )
  const steps = routine.lesson_plan.steps ?? []
  if (screen.name === 'practice' && steps[screen.step]) {
    const i = screen.step
    return (
      <Practice
        key={`${i}-${screen.whole}`}
        routine={routine}
        stepIndex={i}
        step={steps[i]}
        mode={screen.whole ? 'routine' : 'step'}
        onExit={() => back(tree)}
        onNextStep={() => (i + 1 < steps.length ? go(at({ name: 'practice', step: i + 1, whole: false }), true) : back(tree))}
      />
    )
  }
  if (screen.name === 'progress')
    return <ProgressPage routine={routine} back={() => back(tree)} practise={(i) => go(at({ name: 'practice', step: i, whole: false }))} />
  return (
    <LessonTree
      routine={routine}
      back={() => back(home)}
      practise={(i) => go(at({ name: 'practice', step: i, whole: false }))}
      flowAll={() => go(at({ name: 'practice', step: 0, whole: true }))}
      showProgress={() => go(at({ name: 'progress' }))}
      replanned={() => setReload((n) => n + 1)}
    />
  )
}
