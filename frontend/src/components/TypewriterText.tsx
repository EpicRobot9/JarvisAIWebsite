import { useEffect, useMemo, useRef, useState } from 'react'
import Markdown from './ui/Markdown'

export default function TypewriterText({
  text,
  enabled,
  speedCps = 35,
  className = '',
}: {
  text: string
  enabled: boolean
  speedCps?: number
  className?: string
}) {
  const [visible, setVisible] = useState<string>(enabled ? '' : text)
  const rafRef = useRef<number | null>(null)
  const lastTextRef = useRef<string>('')
  const prevEnabledRef = useRef<boolean>(enabled)
  const target = text || ''
  const cps = Math.max(5, Math.min(120, Number.isFinite(speedCps) ? speedCps : 35))

  useEffect(() => {
    // If disabled, show full text immediately
    if (!enabled) {
      setVisible(target)
      // Mark current text as already handled so toggling on doesn't re-animate old messages
      lastTextRef.current = target
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      prevEnabledRef.current = enabled
      return
    }
    // If toggled from off->on and the current message is already fully visible, do not re-animate
    if (prevEnabledRef.current === false && visible === target) {
      prevEnabledRef.current = enabled
      return
    }
    // If text changed, (re)start typing from zero
    if (lastTextRef.current !== target) {
      lastTextRef.current = target
      setVisible('')
    }
    prevEnabledRef.current = enabled
    let start = performance.now()
    const step = () => {
      const elapsed = performance.now() - start
      // chars per second => chars per ms = cps / 1000
      const n = Math.floor((elapsed * cps) / 1000)
      const next = target.slice(0, n)
      if (next !== visible) setVisible(next)
      if (n < target.length) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        // Ensure fully visible on completion
        if (visible !== target) setVisible(target)
        rafRef.current = null
      }
    }
    if (target && enabled) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      start = performance.now()
      rafRef.current = requestAnimationFrame(step)
    } else {
      setVisible(target)
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, enabled, cps])

  const isTyping = enabled && visible.length < target.length
  const content = isTyping ? visible : text
  return (
    <div className={className}>
      {isTyping ? (
        // During typing, render plain text so the caret can sit at the true end of the line
        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {content}
          <span className="tw-caret" aria-hidden>▍</span>
        </span>
      ) : (
        <Markdown content={content} />
      )}
    </div>
  )
}
