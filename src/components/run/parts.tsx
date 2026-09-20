import { Fragment, forwardRef, useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronDown, Flag, Minus } from 'lucide-react'
import { Citation } from '@/components/results/Findings'
import { DECISION_ICON, DECISION_TEXT } from '@/components/results/Verdict'
import { Badge, Id, decisionTone } from '@/components/ui/badge'
import { cn } from '@/lib/cn'
import { humanize } from '@/lib/format'
import { countDecisions, firstBlockingField, recordLines, type FieldRow } from '@/lib/runFormat'
import type { RepairPlan } from '@/domain/repair'
import type { CandidatePath, CheckResult, Decision, ReplayRecord } from '@/domain/types'

export type StageStatus = 'pending' | 'active' | 'done' | 'skipped'

const SURFACE: Record<Decision, string> = {
  PASS: 'border-pass-rule bg-pass-soft',
  MANUAL: 'border-manual-rule bg-manual-soft',
  FAIL: 'border-fail-rule bg-fail-soft',
}

const STRIKE: Record<Decision, string> = { PASS: 'bg-pass/50', MANUAL: 'bg-manual/50', FAIL: 'bg-fail/50' }

// ---------------------------------------------------------------- the stage shell

interface StageProps {
  n: number
  title: string
  status: StageStatus
  /** One line: what the stage found, or why it was skipped. */
  summary?: ReactNode
  /** A finished stage the viewer has opened again. */
  open: boolean
  onToggle: () => void
  children?: ReactNode
}

/** Active: the card that gets the eye. Done: one line with a check. Pending: one faint line. */
export const Stage = forwardRef<HTMLElement, StageProps>(function Stage(
  { n, title, status, summary, open, onToggle, children },
  ref,
) {
  const expanded = status === 'active' || (status === 'done' && open)
  return (
    <section
      ref={ref}
      aria-labelledby={`stage-${n}`}
      aria-current={status === 'active' ? 'step' : undefined}
      className={cn(
        'scroll-mt-20 scroll-mb-16 rounded-lg border transition-colors duration-300',
        status === 'active' && 'border-accent bg-sheet shadow-[inset_3px_0_0_var(--color-accent)]',
        status === 'done' && 'border-rule bg-sheet',
        (status === 'pending' || status === 'skipped') && 'border-transparent',
      )}
    >
      <button
        type="button"
        disabled={status !== 'done'}
        aria-expanded={status === 'done' ? open : undefined}
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-3 px-4 text-left',
          status === 'active' ? 'pt-4 pb-1' : 'min-h-10 py-1.5',
          status === 'done' && 'cursor-pointer',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
            status === 'active' && 'border-accent bg-accent text-sheet',
            status === 'done' && 'border-pass-rule bg-pass-soft text-pass',
            status === 'pending' && 'border-rule text-ink-faint',
            status === 'skipped' && 'border-rule text-ink-faint',
          )}
        >
          {status === 'done' ? <Check className="size-3.5" /> : status === 'skipped' ? <Minus className="size-3.5" /> : n}
        </span>
        <h2
          id={`stage-${n}`}
          className={cn(
            'min-w-0 font-sans font-semibold',
            status === 'active' ? 'text-2xl' : 'text-base',
            (status === 'pending' || status === 'skipped') && 'font-normal text-ink-faint',
          )}
        >
          {title}
        </h2>
        {(status === 'done' || status === 'skipped') && summary && (
          <span className={cn('min-w-0 flex-1 truncate text-sm', status === 'done' ? 'text-ink-soft' : 'text-ink-faint')}>
            {summary}
          </span>
        )}
        {status === 'done' && (
          <ChevronDown aria-hidden className={cn('ml-auto size-4 shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} />
        )}
      </button>
      {expanded && <div className="animate-rise-in px-4 pt-3 pb-5 pl-[3.25rem]">{children}</div>}
    </section>
  )
})

// ---------------------------------------------------------------- small pieces

/** Tenths of a second since `since` (a performance.now() reading). Real time, never paced. */
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 100)
    return () => clearInterval(timer)
  }, [])
  return <span className="font-mono tabular-nums">{(Math.max(0, now - since) / 1000).toFixed(1)} s</span>
}

/** Types `text` in over `durationMs`. 0 shows it at once. */
export function Typewriter({ text, durationMs }: { text: string; durationMs: number }) {
  const [shown, setShown] = useState(durationMs <= 0 ? text.length : 0)
  useEffect(() => {
    if (durationMs <= 0) {
      setShown(text.length)
      return
    }
    const started = performance.now()
    let frame = requestAnimationFrame(function step(now) {
      const n = Math.min(text.length, Math.ceil(((now - started) / durationMs) * text.length))
      setShown(n)
      if (n < text.length) frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [text, durationMs])
  return (
    <span aria-label={text}>
      <span aria-hidden>{text.slice(0, shown)}</span>
    </span>
  )
}

/** The typed fields, landing one at a time. Every slot is laid out from the start so nothing jumps. */
export function FieldGrid({ rows, shown }: { rows: FieldRow[]; shown: number }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row, i) => (
        <div
          key={row.key}
          className={cn(
            'rounded-md border px-3 py-2',
            i >= shown && 'invisible',
            i < shown && 'animate-rise-in',
            row.value === null ? 'border-manual-rule bg-manual-soft' : 'border-rule bg-sheet',
          )}
        >
          <dt className="flex items-center justify-between gap-2 text-xs text-ink-faint">
            {row.label}
          </dt>
          <dd className={cn('mt-0.5 font-serif text-lg leading-snug', row.value === null && 'text-manual italic')}>
            {row.value ?? 'not stated'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------- path search

interface LegColumn {
  role: string
  capabilities: { capability_id: string; label: string }[]
}

/** The legs of the search, read off the engine's own candidate paths. Nothing here is hardcoded. */
export function legColumns(paths: CandidatePath[]): LegColumn[] {
  const columns: LegColumn[] = []
  for (const path of paths) {
    path.legs.forEach((leg, i) => {
      const column = (columns[i] ??= { role: leg.role, capabilities: [] })
      if (!column.capabilities.some((c) => c.capability_id === leg.capability_id)) {
        column.capabilities.push({ capability_id: leg.capability_id, label: leg.label })
      }
    })
  }
  return columns
}

function LegColumns({ paths, current }: { paths: CandidatePath[]; current: CandidatePath | null }) {
  const columns = legColumns(paths)
  const lit = new Set(current?.legs.map((l) => l.capability_id))
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))` }}>
      {columns.map((column, i) => (
        <div key={column.role} className="rounded-md border border-rule bg-paper/60 px-3 py-2">
          <p className="text-xs font-semibold tracking-wider text-ink-faint uppercase">
            Leg {i + 1} · {humanize(column.role)} <span className="font-normal">×{column.capabilities.length}</span>
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {column.capabilities.map((c) => (
              <li
                key={c.capability_id}
                title={c.label}
                className={cn(
                  'rounded border px-2 py-0.5 font-mono text-xs font-semibold transition-colors duration-75',
                  lit.has(c.capability_id) ? 'border-accent bg-accent text-sheet' : 'border-rule bg-sheet text-ink-soft',
                )}
              >
                {c.capability_id}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function PathCell({ path, visible, decisive, animate }: { path: CandidatePath; visible: boolean; decisive: boolean; animate: boolean }) {
  const field = firstBlockingField(path)
  return (
    <li
      className={cn(
        'flex min-w-0 items-center gap-2 rounded border px-2 py-1',
        !visible && 'invisible',
        visible && animate && 'animate-rise-in',
        SURFACE[path.decision],
        decisive && 'ring-2 ring-accent',
      )}
    >
      <span className="relative shrink-0 font-mono text-[0.7rem] font-semibold whitespace-nowrap">
        {path.legs.length === 0 ? 'no complete path' : path.legs.map((l) => l.capability_id).join(' › ')}
        {path.decision !== 'PASS' && (
          <span
            aria-hidden
            className={cn('absolute inset-x-0 top-1/2 h-px origin-left', STRIKE[path.decision], visible && animate && 'animate-draw')}
          />
        )}
      </span>
      <span className={cn('shrink-0 text-[0.65rem] font-bold', DECISION_TEXT[path.decision])}>{path.decision}</span>
      {field && <span className="min-w-0 truncate font-mono text-[0.65rem] text-ink-soft" title={field}>{field}</span>}
    </li>
  )
}

/** The decisive path, drawn as a line of legs. Pinned above the grid the moment the search reaches it. */
function DecisivePath({ path, visible }: { path: CandidatePath | undefined; visible: boolean }) {
  return (
    <div
      className={cn(
        'flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent bg-sheet px-3 py-2 shadow-[inset_3px_0_0_var(--color-accent)]',
        !(visible && path) && 'invisible',
        visible && 'animate-rise-in',
      )}
    >
      {path && (
        <>
          <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-y-2">
            {path.legs.map((leg, i) => (
              <li key={leg.capability_id} className="flex items-center">
                {i > 0 && <span aria-hidden className="h-px w-5 bg-ink-faint" />}
                <span className="flex flex-col rounded-md border border-rule bg-rule-soft/60 px-2 py-1 leading-tight">
                  <span className="text-[0.65rem] tracking-wide text-ink-faint uppercase">{humanize(leg.role)}</span>
                  <span className="text-xs">
                    <span className="font-mono font-semibold">{leg.capability_id}</span>{' '}
                    <span className="text-ink-soft">{leg.label}</span>
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <Badge tone="accent">
            <Flag aria-hidden className="size-3" />
            Selected route
          </Badge>
          <Badge tone={decisionTone(path.decision)}>{path.decision}</Badge>
        </>
      )}
    </div>
  )
}

/**
 * The search, replayed over the engine's real `candidate_paths` in their real
 * order. `shown` is how many have been revealed; the rest hold their place.
 */
export function PathSearch({
  paths,
  selectedId,
  shown,
  dense = false,
  animate = true,
  presentation = false,
}: {
  paths: CandidatePath[]
  selectedId: string | null
  shown: number
  dense?: boolean
  animate?: boolean
  /** Lead with the business answer; keep the full route matrix one click away. */
  presentation?: boolean
}) {
  const seen = paths.slice(0, shown)
  const counts = countDecisions(seen)
  const decisiveIndex = paths.findIndex((p) => p.path_id === selectedId)
  const searching = shown > 0 && shown < paths.length

  if (presentation) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-rule bg-sheet px-4 py-3">
            <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Operating routes tested</p>
            <p className="mt-1 font-serif text-3xl font-semibold tabular-nums">{shown}<span className="text-lg font-normal text-ink-faint">/{paths.length}</span></p>
          </div>
          <div className="rounded-lg border border-pass-rule bg-pass-soft px-4 py-3">
            <p className="text-xs font-semibold tracking-wide text-pass uppercase">Routes that work</p>
            <p className="mt-1 font-serif text-3xl font-semibold text-pass tabular-nums">{counts.PASS}</p>
          </div>
          <div className="rounded-lg border border-fail-rule bg-fail-soft px-4 py-3">
            <p className="text-xs font-semibold tracking-wide text-fail uppercase">Routes blocked</p>
            <p className="mt-1 font-serif text-3xl font-semibold text-fail tabular-nums">{counts.FAIL}</p>
          </div>
        </div>

        <ol aria-label="Operating route search progress" className="grid grid-cols-8 gap-1 sm:grid-cols-16">
          {paths.map((path, i) => (
            <li
              key={path.path_id}
              title={i < shown ? `${path.path_id}: ${path.decision}` : `${path.path_id}: not tested yet`}
              className={cn(
                'h-3 rounded-sm border transition-colors duration-150',
                i >= shown && 'border-rule bg-rule-soft',
                i < shown && path.decision === 'PASS' && 'border-pass-rule bg-pass',
                i < shown && path.decision === 'MANUAL' && 'border-manual-rule bg-manual',
                i < shown && path.decision === 'FAIL' && 'border-fail-rule bg-fail',
              )}
            >
              <span className="sr-only">{i < shown ? `${path.decision} route` : 'Pending route'}</span>
            </li>
          ))}
        </ol>

        <DecisivePath path={paths[decisiveIndex]} visible={decisiveIndex >= 0 && shown > decisiveIndex} />

        <details className="group rounded-lg border border-rule bg-paper/50">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-ink-soft hover:text-ink">
            Inspect all {paths.length} routes and capability IDs
          </summary>
          <div className="border-t border-rule px-4 py-3">
            <PathSearch paths={paths} selectedId={selectedId} shown={shown} dense={dense} animate={animate} />
          </div>
        </details>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {!dense && <LegColumns paths={paths} current={searching ? (paths[shown - 1] ?? null) : null} />}
      <p aria-live="off" className="font-mono text-sm tabular-nums">
        searched <strong>{shown}</strong> of {paths.length} · <span className="text-pass">pass {counts.PASS}</span> ·{' '}
        <span className="text-manual">manual {counts.MANUAL}</span> · <span className="text-fail">fail {counts.FAIL}</span>
      </p>
      <DecisivePath path={paths[decisiveIndex]} visible={decisiveIndex >= 0 && shown > decisiveIndex} />
      <ol className={cn('grid gap-1.5', dense ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 lg:grid-cols-3')}>
        {paths.map((p, i) => (
          <PathCell key={p.path_id} path={p} visible={i < shown} decisive={i === decisiveIndex} animate={animate} />
        ))}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------- checks

/** The CheckResult rows of the decisive path, ticking in. */
export function CheckTicker({
  checks,
  shown,
  dense = false,
  presentation = false,
}: {
  checks: CheckResult[]
  shown: number
  dense?: boolean
  /** Show only decision-changing checks first, with the comparator table in a disclosure. */
  presentation?: boolean
}) {
  if (checks.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        No comparator could evaluate this path. An unevaluated path is never treated as a PASS.
      </p>
    )
  }
  if (presentation) {
    const visible = checks.slice(0, shown)
    const blockers = visible.filter((check) => check.verdict !== 'PASS')
    const passed = visible.length - blockers.length
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="pass">{passed} supported</Badge>
          {blockers.length > 0 && <Badge tone="fail">{blockers.length} blocking</Badge>}
        </div>
        <ol className="grid gap-2 lg:grid-cols-2">
          {blockers.map((check, i) => {
            const Icon = DECISION_ICON[check.verdict]
            return (
              <li key={`${check.field}-${i}`} className={cn('rounded-lg border px-4 py-3', SURFACE[check.verdict])}>
                <div className="flex items-center gap-2">
                  <Icon aria-hidden className={cn('size-4', DECISION_TEXT[check.verdict])} />
                  <strong className="font-semibold">{humanize(check.field)}</strong>
                  <Id className="ml-auto">{check.capability_id}</Id>
                </div>
                <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm">
                  <p><span className="block text-xs text-ink-faint">Contract promises</span>{check.required}</p>
                  <ArrowRight aria-hidden className="size-4 text-ink-faint" />
                  <p><span className="block text-xs text-ink-faint">Bank can support</span>{check.supported}</p>
                </div>
              </li>
            )
          })}
        </ol>
        <details className="rounded-lg border border-rule bg-paper/50">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-ink-soft hover:text-ink">
            Inspect all {checks.length} capability checks
          </summary>
          <div className="border-t border-rule p-3">
            <CheckTicker checks={checks} shown={shown} dense={dense} />
          </div>
        </details>
      </div>
    )
  }
  if (dense) {
    return (
      <ol className="grid gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
        {checks.map((k, i) => {
          const Icon = DECISION_ICON[k.verdict]
          return (
            <li key={`${k.field}-${i}`} className={cn('flex items-center gap-2 text-xs', i >= shown && 'invisible')}>
              <Icon aria-hidden className={cn('size-3.5 shrink-0', DECISION_TEXT[k.verdict])} />
              <span className={cn('w-14 shrink-0 font-bold', DECISION_TEXT[k.verdict])}>{k.verdict}</span>
              <span className="min-w-0 flex-1 truncate font-mono">{k.field}</span>
              <span className="shrink-0 font-mono text-ink-faint">{k.capability_id}</span>
            </li>
          )
        })}
      </ol>
    )
  }
  return (
    <ol className="divide-y divide-rule-soft rounded-lg border border-rule bg-sheet">
      {checks.map((k, i) => {
        const Icon = DECISION_ICON[k.verdict]
        return (
          <li
            key={`${k.field}-${i}`}
            className={cn(
              'grid grid-cols-[6.5rem_12rem_minmax(0,1fr)_minmax(0,1.4fr)_5rem] items-baseline gap-x-4 px-3 py-1.5 text-sm',
              i >= shown && 'invisible',
              i < shown && 'animate-rise-in',
            )}
          >
            <span className={cn('flex items-center gap-1.5 font-bold', DECISION_TEXT[k.verdict])}>
              <Icon aria-hidden className="size-4 shrink-0 self-center" />
              {k.verdict}
            </span>
            <span className="truncate font-mono text-xs">{k.field}</span>
            <span>
              <span className="text-xs text-ink-faint">Contract requires </span>
              {k.required}
            </span>
            <span>
              <span className="text-xs text-ink-faint">Bank supports </span>
              {k.supported}
              {k.verdict !== 'PASS' && <span className="block text-xs text-ink-soft">{k.reason}</span>}
            </span>
            <span className="text-right font-mono text-xs">{k.capability_id}</span>
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------- repair

/** Each proposal in place: the drafted value struck out, the bank's bound typed in, its capability cited. */
export function RepairRows({ plan, shown, typeMs }: { plan: RepairPlan; shown: number; typeMs: number }) {
  return (
    <ol className="grid gap-2 xl:grid-cols-2">
      {plan.proposals.map((p, i) => (
        <li
          key={p.field}
          className={cn('rounded-lg border border-rule bg-sheet px-4 py-2.5', i >= shown && 'invisible', i < shown && 'animate-rise-in')}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{humanize(p.field)}</span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-serif text-lg">
            <span className="relative text-fail">
              {p.from}
              <span aria-hidden className={cn('absolute inset-x-0 top-1/2 h-px origin-left bg-fail', i < shown && 'animate-draw')} />
            </span>
            <ArrowRight aria-hidden className="size-4 text-ink-faint" />
            <span className="sr-only">changes to</span>
            <span className="font-semibold text-pass">{i < shown ? <Typewriter text={p.to} durationMs={typeMs} /> : p.to}</span>
          </p>
          <p className="mt-1">
            <Citation capabilityId={p.capability_id} />
          </p>
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------- record

export function RecordPanel({
  title,
  record,
  decision,
  children,
}: {
  title: string
  record: ReplayRecord
  decision: Decision
  children?: ReactNode
}) {
  const lines = recordLines(record)
  return (
    <figure className="min-w-0 rounded-lg border border-rule bg-sheet">
      <figcaption className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm font-semibold">
        {title} <span className={DECISION_TEXT[decision]}>{decision}</span>
        <span className="ml-auto flex items-center gap-2 font-normal">{children}</span>
      </figcaption>
      <div className="grid gap-3 border-t border-rule px-3 py-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-ink-faint">Exact input fingerprint</p>
          <p className="mt-0.5 font-mono text-sm font-semibold">{record.requirement_bundle_hash.slice(0, 18)}…</p>
        </div>
        <div>
          <p className="text-xs text-ink-faint">Bank capability version</p>
          <p className="mt-0.5 text-sm font-semibold">Graph v{record.capability_graph_version}</p>
        </div>
        <div>
          <p className="text-xs text-ink-faint">Evidence used</p>
          <p className="mt-0.5 text-sm font-semibold">{record.evidence_ids.length} source{record.evidence_ids.length === 1 ? '' : 's'}</p>
        </div>
      </div>
      <details className="border-t border-rule">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-ink-soft hover:text-ink">Inspect replay data</summary>
        <pre className="overflow-hidden bg-ink p-3 font-mono text-[0.7rem] leading-relaxed break-all whitespace-pre-wrap text-sheet">
          {lines.map((line, i) => (
            <Fragment key={i}>
              {line.includes('"requirement_bundle_hash"') || line.includes('"capability_graph_version"') ? (
                <>
                  {'  '}
                  <mark className="rounded-sm bg-mark px-0.5 font-semibold text-ink">{line.trimStart()}</mark>
                </>
              ) : (
                line
              )}
              {i < lines.length - 1 && '\n'}
            </Fragment>
          ))}
        </pre>
      </details>
    </figure>
  )
}
