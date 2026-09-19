import { useState } from 'react'
import { ChevronDown, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Id, decisionTone } from '@/components/ui/badge'
import { mostSevere } from '@/domain/evaluate'
import { cn } from '@/lib/cn'
import { humanize } from '@/lib/format'
import type { CandidatePath, Decision, RequirementResult } from '@/domain/types'
import { DECISION_ICON, DECISION_TEXT } from './Verdict'

/** Other paths shown before the list is expanded. The reported path is always shown. */
const PREVIEW = 4

const NODE: Record<Decision, string> = {
  PASS: 'border-pass-rule bg-pass-soft',
  MANUAL: 'border-manual-rule bg-manual-soft',
  FAIL: 'border-fail-rule bg-fail-soft',
}

/** A leg's verdict is the worst check that fired against its capability. */
function legVerdict(path: CandidatePath, capabilityId: string): Decision | null {
  const checks = path.checks.filter((k) => k.capability_id === capabilityId)
  return checks.length === 0 ? null : mostSevere(checks.map((k) => k.verdict))
}

function PathRow({ path, reported }: { path: CandidatePath; reported: boolean }) {
  const blocking = [...new Set(path.checks.filter((k) => k.verdict !== 'PASS').map((k) => k.field))]

  return (
    <li>
      <details
        className={cn(
          'group rounded-lg border bg-sheet',
          reported ? 'border-accent shadow-[inset_3px_0_0_var(--color-accent)]' : 'border-rule',
        )}
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4 [&::-webkit-details-marker]:hidden">
          {/* The path, drawn as a line: one node per leg, in traversal order. */}
          <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-y-2">
            {path.legs.length === 0 && (
              <li className="text-sm text-fail">{path.incomplete_reason ?? 'Incomplete path'}</li>
            )}
            {path.legs.map((leg, i) => {
              const verdict = legVerdict(path, leg.capability_id)
              const Icon = verdict ? DECISION_ICON[verdict] : null
              return (
                <li key={leg.capability_id} className="flex items-center">
                  {i > 0 && <span aria-hidden className="h-px w-4 bg-ink-faint sm:w-6" />}
                  <span
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border px-2 py-1',
                      verdict ? NODE[verdict] : 'border-rule bg-rule-soft',
                    )}
                  >
                    {Icon && verdict && (
                      <Icon aria-hidden className={cn('size-3.5 shrink-0', DECISION_TEXT[verdict])} />
                    )}
                    <span className="flex flex-col leading-tight">
                      <span className="text-[0.65rem] tracking-wide text-ink-faint uppercase">
                        {humanize(leg.role)}
                      </span>
                      <span className="font-mono text-xs font-semibold">{leg.capability_id}</span>
                    </span>
                    <span className="sr-only">
                      {leg.label}: {verdict ?? 'no check fired'}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>

          <span className="flex items-center gap-2">
            {reported && (
              <Badge tone="accent">
                <Flag aria-hidden className="size-3" />
                Decision reported against this path
              </Badge>
            )}
            <Badge tone={decisionTone(path.decision)}>{path.decision}</Badge>
            <ChevronDown
              aria-hidden
              className="size-4 text-ink-faint transition-transform group-open:rotate-180"
            />
          </span>

          {blocking.length > 0 && (
            <span className="basis-full text-xs text-ink-soft">
              {path.decision === 'FAIL' ? 'Rejected on' : 'Held on'}: {blocking.join(', ')}
            </span>
          )}
        </summary>

        <div className="border-t border-rule-soft px-3 py-3 sm:px-4">
          <ul className="space-y-1 text-xs text-ink-soft">
            {path.legs.map((leg) => (
              <li key={leg.capability_id}>
                <Id>{leg.capability_id}</Id> {leg.label}
              </li>
            ))}
          </ul>
          <ChecksTable checks={path.checks} className="mt-3" />
        </div>
      </details>
    </li>
  )
}

export function ChecksTable({
  checks,
  className,
}: {
  checks: CandidatePath['checks']
  className?: string
}) {
  if (checks.length === 0) {
    return (
      <p className={cn('text-sm text-ink-soft', className)}>
        No comparator could evaluate this path. An unevaluated path is never treated as a PASS.
      </p>
    )
  }
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full min-w-[40rem] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-rule text-ink-faint">
            <th scope="col" className="py-1.5 pr-3 font-semibold">Check</th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">Verdict</th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">Contract requires</th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">Bank supports</th>
            <th scope="col" className="py-1.5 font-semibold">Capability</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((k, i) => (
            <tr key={`${k.field}-${k.capability_id}-${i}`} className="border-b border-rule-soft align-top">
              <td className="py-1.5 pr-3 font-mono">{k.field}</td>
              <td className={cn('py-1.5 pr-3 font-semibold', DECISION_TEXT[k.verdict])}>{k.verdict}</td>
              <td className="py-1.5 pr-3">{k.required}</td>
              <td className="py-1.5 pr-3">
                {k.supported}
                {k.verdict !== 'PASS' && <span className="mt-0.5 block text-ink-soft">{k.reason}</span>}
              </td>
              <td className="py-1.5 font-mono">{k.capability_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Every candidate path the search considered, one row each. The rejected rows
 * stay on screen on purpose: they are the visible proof that a search happened.
 */
export function CandidatePaths({ result }: { result: RequirementResult }) {
  const reported = result.candidate_paths.find((p) => p.path_id === result.selected_path_id)
  const rest = result.candidate_paths.filter((p) => p !== reported)
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? rest : rest.slice(0, PREVIEW)
  const counts = result.candidate_paths.reduce<Record<Decision, number>>(
    (acc, p) => ({ ...acc, [p.decision]: acc[p.decision] + 1 }),
    { PASS: 0, MANUAL: 0, FAIL: 0 },
  )

  return (
    <div>
      <p className="text-sm text-ink-soft">
        {result.candidate_paths.length} candidate path
        {result.candidate_paths.length === 1 ? '' : 's'} searched: {counts.PASS} pass, {counts.MANUAL}{' '}
        manual, {counts.FAIL} fail. Open a row to see every check on that path.
      </p>
      <ol className="mt-3 space-y-2">
        {reported && <PathRow path={reported} reported />}
        {visible.map((p) => (
          <PathRow key={p.path_id} path={p} reported={false} />
        ))}
      </ol>
      {rest.length > PREVIEW && (
        <Button
          variant="secondary"
          className="mt-3"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll
            ? 'Show fewer paths'
            : `Show the other ${rest.length - PREVIEW} searched paths`}
        </Button>
      )}
    </div>
  )
}
