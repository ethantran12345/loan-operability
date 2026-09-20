import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The findings column, scaled down just enough that a whole run is on screen at
 * once. A demo is watched, not scrolled: four cards are taller than most windows,
 * and a column that scrolls itself carries the first finding off the top before
 * the last one lands.
 *
 * The scale only ever tightens while a run is playing, so a chip landing can
 * never push the column back out and start it oscillating. `resetKey` releases
 * it for the next run.
 */

/** Below this the type is too small to read back on a recording, so the column scrolls instead. */
const FLOOR = 0.66
/** Changes smaller than this are not worth a re-step. */
const STEP = 0.015

export function FitColumn({ active, resetKey, scrollName, className, children }: { active: boolean; resetKey: unknown; scrollName?: string; className?: string; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => setScale(1), [resetKey])

  useEffect(() => {
    if (!active) return
    let raf = 0
    const measure = () => {
      const box = frame.current
      const content = inner.current
      if (!box || !content) return
      const available = box.clientHeight
      // scrollHeight is the laid-out height, before the transform, so measuring cannot feed back into it.
      const needed = content.scrollHeight
      if (available <= 0 || needed <= 0) return
      const want = Math.max(FLOOR, Math.min(1, available / needed))
      setScale((s) => {
        const next = want < s - STEP ? want : s
        // Once it fits, the column shows all of it from the top: a scroll position left over
        // from reading an open finding would otherwise hold the first card off the screen.
        if (needed * next <= available + 1) box.scrollTop = 0
        return next
      })
    }
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    })
    if (frame.current) observer.observe(frame.current)
    if (inner.current) observer.observe(inner.current)
    measure()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [active, resetKey])

  const fitted = active && scale < 1
  return (
    <div ref={frame} data-scroll={scrollName} data-fit={fitted ? scale.toFixed(3) : undefined} className={cn('min-h-0', active ? 'overflow-hidden' : 'overflow-y-auto', className)}>
      {/* Laid out wider and scaled back to the column's real width: the cards keep their size on screen
          and only the type and spacing tighten, so fewer chips wrap and less height is needed to begin with. */}
      <div
        ref={inner}
        className="origin-top-left transition-transform duration-300 ease-out"
        style={fitted ? { transform: `scale(${scale})`, width: `${100 / scale}%` } : undefined}
      >
        {children}
      </div>
    </div>
  )
}
