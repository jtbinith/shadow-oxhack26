// The loading screen: the hopping crow (the brand GIF) in a window, with what's loading.
// compact = a small inline version for loading inside a card.
export default function LoadingScreen({ label = 'Loading…', compact = false }: { label?: string; compact?: boolean }) {
  return compact ? (
    <p className="loading-inline" role="status">
      <img src="/crow-hop.gif" alt="" width={54} height={60} /> {label}
    </p>
  ) : (
    <div className="loading-screen" role="status">
      <div className="window" data-title="loading">
        <img src="/crow-hop.gif" alt="" width={180} height={200} />
        <p>{label}</p>
      </div>
    </div>
  )
}
