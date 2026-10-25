// The loading window: the hopping crow (the brand GIF) with what's loading. One look everywhere.
// overlay = pops up over the page with a dimmed backdrop; small = a compact window inside a panel.
export default function LoadingScreen({ label = 'Loading…', overlay = false, small = false }: { label?: string; overlay?: boolean; small?: boolean }) {
  const win = (
    <div className={`window loading-window ${small ? 'small' : ''}`} data-title="loading" role="status">
      <img src="/crow-hop.gif" alt="" width={small ? 90 : 180} height={small ? 100 : 200} />
      <p>{label}</p>
    </div>
  )
  if (overlay) return <div className="loading-overlay">{win}</div>
  if (small) return win
  return <div className="loading-screen">{win}</div>
}
