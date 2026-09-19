import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import type { Decision } from '@/domain/types'

type Tone = 'neutral' | 'accent' | 'pass' | 'manual' | 'fail'

const TONES: Record<Tone, string> = {
  neutral: 'border-rule bg-rule-soft text-ink-soft',
  accent: 'border-accent/25 bg-accent-soft text-accent',
  pass: 'border-pass-rule bg-pass-soft text-pass',
  manual: 'border-manual-rule bg-manual-soft text-manual',
  fail: 'border-fail-rule bg-fail-soft text-fail',
}

export const decisionTone = (d: Decision): Tone =>
  d === 'PASS' ? 'pass' : d === 'MANUAL' ? 'manual' : 'fail'

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        TONES[tone],
        className,
      )}
      {...props}
    />
  )
}

/** A capability or path id. Always monospace, always selectable: it is evidence. */
export function Id({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cn(
        'rounded border border-rule-soft bg-rule-soft/60 px-1.5 py-0.5 font-mono text-[0.72rem] text-ink-soft break-all',
        className,
      )}
      {...props}
    />
  )
}
