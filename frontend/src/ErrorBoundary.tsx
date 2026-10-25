import { Component, type ReactNode } from 'react'
import Crow from './brand/Crow'

/** If a screen crashes, show a way back instead of a blank black page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('Screen crashed:', error)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <section className="card crash" data-title="oops">
        <h2><Crow size={44} pose="caw" /> Something went wrong on this screen.</h2>
        <p className="notice">{this.state.error.message}</p>
        <button className="primary" onClick={() => location.reload()}>Reload</button>
      </section>
    )
  }
}
