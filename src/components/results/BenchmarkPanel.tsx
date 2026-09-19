import { ArrowRight } from 'lucide-react'
import { Id } from '@/components/ui/badge'
import { cn } from '@/lib/cn'
import type { CapabilityGraph, CheckResult, RequirementResult } from '@/domain/types'
import { DECISION_ICON, DECISION_TEXT } from './Verdict'

function CheckLine({ check }: { check: CheckResult }) {
  const Icon = DECISION_ICON[check.verdict]
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', DECISION_TEXT[check.verdict])} />
      <span className="min-w-0">
        <span className="font-mono text-xs">{check.field}</span>{' '}
        <span className={cn('font-semibold', DECISION_TEXT[check.verdict])}>{check.verdict}</span>
        <span className="block text-ink-soft">
          requires {check.required}, bank supports {check.supported}
        </span>
      </span>
    </li>
  )
}

/**
 * The benchmark clause, split by where each fact lives. Both columns are the
 * engine's own checks on the reported path; nothing here is a model's answer.
 */
export function BenchmarkPanel({
  result,
  graph,
  renewedVersion,
  onSeeRenewal,
}: {
  result: RequirementResult
  graph: CapabilityGraph
  /** A later graph version to offer, or null when the latest is already selected. */
  renewedVersion: number | null
  onSeeRenewal: (version: number) => void
}) {
  const path = result.candidate_paths.find((p) => p.path_id === result.selected_path_id)
  const readable = path?.checks.filter((k) => k.field !== 'approval') ?? []
  const approvals = path?.checks.filter((k) => k.field === 'approval') ?? []
  if (!path || approvals.length === 0) return null

  const readablePassing = readable.filter((k) => k.verdict === 'PASS').length

  return (
    <div className="mb-6">
      <div className="rounded-lg border border-rule bg-sheet">
        <h3 className="border-b border-rule-soft px-4 py-3 font-serif text-lg font-semibold">
          What the rulebook reads like vs. what the institution knows
        </h3>
        <div className="grid md:grid-cols-2">
          <div className="px-4 py-4">
            <h4 className="text-xs font-semibold tracking-wider text-ink-faint uppercase">
              What the rulebook reads like
            </h4>
            <ul className="mt-3 space-y-2">
              {readable.map((k, i) => (
                <CheckLine key={`${k.field}-${k.capability_id}-${i}`} check={k} />
              ))}
            </ul>
            <p className="mt-3 text-sm font-medium">
              {readablePassing === readable.length
                ? 'Every constraint a reader can check from the rulebook passes.'
                : `${readablePassing} of ${readable.length} constraints a reader can check from the rulebook pass.`}
            </p>
          </div>

          <div className="border-t border-rule-soft px-4 py-4 md:border-t-0 md:border-l">
            <h4 className="text-xs font-semibold tracking-wider text-ink-faint uppercase">
              What the institution knows
            </h4>
            {approvals.map((k, i) => {
              const roles = graph.capabilities.find((c) => c.capability_id === k.capability_id)?.requires_approval ?? []
              const authorities = graph.approvals.filter((a) => roles.includes(a.role))
              return (
                <div key={`${k.capability_id}-${i}`} className="mt-3">
                  <ul>
                    <CheckLine check={k} />
                  </ul>
                  {authorities.map((a) => (
                    <div key={a.approval_id}>
                      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                        <dt className="text-ink-soft">Authority</dt>
                        <dd>
                          <Id>{a.approval_id}</Id> {a.role}
                        </dd>
                        <dt className="text-ink-soft">effective_from</dt>
                        <dd className="font-mono text-xs">{a.effective_from}</dd>
                        <dt className="text-ink-soft">effective_to</dt>
                        <dd className={cn('font-mono text-xs', k.verdict === 'FAIL' && 'font-semibold text-fail')}>
                          {a.effective_to ?? 'open'}
                        </dd>
                      </dl>
                      <p className="mt-3 text-sm font-medium">
                        {k.verdict === 'FAIL' && a.effective_to
                          ? `The authority that makes this path legal expired ${a.effective_to}.`
                          : `The authority that makes this path legal is in force from ${a.effective_from}${k.owner ? `, and ${k.owner} still has to sign off` : ''}.`}{' '}
                        That date is in the capability graph, not in the rulebook text.
                      </p>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {renewedVersion !== null && (
        <button
          type="button"
          onClick={() => onSeeRenewal(renewedVersion)}
          className="mt-3 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
        >
          See what changes when the bank renews the authority
          <ArrowRight aria-hidden className="size-4" />
        </button>
      )}
    </div>
  )
}
