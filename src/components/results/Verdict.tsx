import { CircleAlert, CircleCheck, CircleX } from 'lucide-react'
import { cn } from '@/lib/cn'
import { DECISION_MEANING } from '@/lib/format'
import type { Decision } from '@/domain/types'

export const DECISION_ICON = { PASS: CircleCheck, MANUAL: CircleAlert, FAIL: CircleX } as const

const SURFACE: Record<Decision, string> = {
  PASS: 'border-pass-rule bg-pass-soft text-pass',
  MANUAL: 'border-manual-rule bg-manual-soft text-manual',
  FAIL: 'border-fail-rule bg-fail-soft text-fail',
}

export const DECISION_TEXT: Record<Decision, string> = {
  PASS: 'text-pass',
  MANUAL: 'text-manual',
  FAIL: 'text-fail',
}

interface Props {
  decision: Decision
  label: string
  caption: string
  /** Play the arrival animation. Used for the re-tested revision only. */
  arrive?: boolean
}

/** The large PASS / MANUAL / FAIL. Word, icon and colour all carry the decision. */
export function Verdict({ decision, label, caption, arrive = false }: Props) {
  const Icon = DECISION_ICON[decision]
  return (
    <div
      className={cn(
        'flex-1 rounded-xl border px-5 py-5 sm:px-7 sm:py-6',
        SURFACE[decision],
        // One declaration: two `animate-*` utilities on an element would override each other.
        arrive &&
          (decision === 'PASS'
            ? '[animation:rise-in_420ms_cubic-bezier(0.2,0.8,0.2,1)_both,settle_900ms_ease-out_350ms_both]'
            : 'animate-rise-in'),
      )}
    >
      <p className="text-xs font-semibold tracking-widest uppercase opacity-80">{label}</p>
      <p
        className={cn(
          'mt-1 flex items-center gap-3 font-serif text-6xl leading-none font-semibold tracking-tight sm:text-7xl',
          arrive && 'animate-verdict-in',
        )}
      >
        <Icon aria-hidden className="size-10 shrink-0 sm:size-12" strokeWidth={1.75} />
        {decision}
      </p>
      <p className="mt-3 max-w-prose text-sm text-ink">{DECISION_MEANING[decision]}</p>
      <p className="mt-1 text-sm text-ink-soft">{caption}</p>
    </div>
  )
}
