import { Check, ChevronRight, Loader2, TriangleAlert, UserRound } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { StepState } from '@/lib/useAgreementReview'

export interface StripStep {
  label: string
  /** 'waiting' is the employee's turn: nothing is running. */
  state: StepState | 'waiting'
  /** A real count or time from the operation itself. */
  detail: string
}

/** Four steps, each reporting the state of the operation it names. */
export function ProgressStrip({ steps }: { steps: StripStep[] }) {
  return (
    <ol aria-label="Review progress" className="flex min-w-0 items-center gap-1 text-xs">
      {steps.map((s, i) => (
        <li key={s.label} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-faint" />}
          <span
            data-step={s.label}
            data-state={s.state}
            className={cn(
              'flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1',
              s.state === 'done' && 'border-rule bg-sheet text-ink',
              s.state === 'running' && 'border-accent/40 bg-accent-soft text-accent',
              s.state === 'waiting' && 'border-accent/40 bg-sheet text-ink',
              s.state === 'pending' && 'border-transparent text-ink-faint',
              s.state === 'error' && 'border-fail-rule bg-fail-soft text-fail',
            )}
          >
            {s.state === 'done' && <Check aria-hidden className="size-3.5 shrink-0 text-pass" />}
            {s.state === 'running' && <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin" />}
            {s.state === 'waiting' && <UserRound aria-hidden className="size-3.5 shrink-0 text-accent" />}
            {s.state === 'error' && <TriangleAlert aria-hidden className="size-3.5 shrink-0" />}
            {s.state === 'pending' && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ink-faint/50" />}
            <span className="font-semibold whitespace-nowrap">{s.label}</span>
            <span className="truncate text-ink-soft">{s.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
