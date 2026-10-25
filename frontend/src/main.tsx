import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from './App'
import ErrorBoundary from './ErrorBoundary'
import './index.css'

// The publishable key is fetched at runtime so one build works on every host.
function Root() {
  const [key, setKey] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => setKey(c.clerkPublishableKey ?? ''))
      .catch(() => setKey(''))
  }, [])
  if (key === null) return null
  if (!key) return <p className="notice">Login isn't configured yet (CLERK_PUBLISHABLE_KEY).</p>
  return (
    <ClerkProvider publishableKey={key}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ClerkProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
