export default function ErrorCard({ title, tech, details, onRetry }: { title: string; tech?: string; details?: string; onRetry?: () => void }) {
  return (
  <div className="border border-red-500/30 bg-red-500/10 text-red-200 rounded-lg p-3 text-sm">
      <div className="flex items-center justify-between">
        <strong>{title}</strong>
    {onRetry && <button onClick={onRetry} className="px-2 py-1 rounded border text-xs bg-white/10">Retry</button>}
      </div>
      {(tech || details) && (
        <details className="mt-2">
          <summary>Technical details</summary>
          <div className="mt-1 whitespace-pre-wrap break-words text-xs opacity-80">
            {tech && <div>{tech}</div>}
            {details && <div>{details}</div>}
          </div>
        </details>
      )}
    </div>
  )
}
