import { useEffect, useState } from 'react'
import { SignInButton, SignedIn, SignedOut, UserButton, useAuth } from '@clerk/clerk-react'
import PoseCam from './pose/PoseCam'

export default function App() {
  return (
    <main>
      <header>
        <h1>Shadow</h1>
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
        <WhoAmI />
        <PoseCam />
      </SignedIn>
    </main>
  )
}

// Proves the browser → API → Clerk check works end to end.
function WhoAmI() {
  const { getToken } = useAuth()
  const [me, setMe] = useState('')
  useEffect(() => {
    getToken().then((t) =>
      fetch('/api/me', { headers: { Authorization: `Bearer ${t}` } })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d) => setMe(d.user_id))
        .catch((s) => setMe(`API error ${s}`)),
    )
  }, [getToken])
  return <p className="notice">API: {me || '…'}</p>
}
