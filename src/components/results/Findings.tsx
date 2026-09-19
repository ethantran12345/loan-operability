import type { ReactNode } from 'react'
import { Badge, Id, decisionTone } from '@/components/ui/badge'
import { capabilityGraph } from '@/domain/fixtures'
import { businessDays, humanize } from '@/lib/format'
import type { CheckResult, RequirementResult } from '@/domain/types'

/** A capability id with the evidence that verifies it. Every bank-side claim cites one. */
export function Citation({ capabilityId }: { capabilityId: string }) {
  const cap = capabilityGraph.capabilities.find((c) => c.capability_id === capabilityId)
  if (!cap) return <Id>{capabilityId}</Id>
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-ink-soft">
      <Id>{cap.capability_id}</Id>
      <span className="font-medium text-ink">{cap.label}</span>
      <span>
        {cap.evidence.source}, section “{cap.evidence.section}”, verified{' '}
        {cap.evidence.last_verified}
      </span>
    </span>
  )
}

function Finding({
  tone,
  tag,
  field,
  children,
}: {
  tone: 'fail' | 'manual' | 'pass'
  tag: string
  field: string
  children: ReactNode
}) {
  return (
    <li className="rounded-lg border border-rule bg-sheet">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule-soft px-4 py-2.5">
        <Badge tone={tone}>{tag}</Badge>
        <span className="text-sm font-semibold">{humanize(field)}</span>
        <Id>{field}</Id>
      </div>
      <div className="px-4 py-3">{children}</div>
    </li>
  )
}

function Sides({ required, supported }: { required: string; supported: string }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div>
        <dt className="text-xs font-semibold tracking-wider text-ink-faint uppercase">
          Contract requires
        </dt>
        <dd className="mt-0.5 font-serif text-lg">{required}</dd>
      </div>
      <div>
        <dt className="text-xs font-semibold tracking-wider text-ink-faint uppercase">
          Bank supports
        </dt>
        <dd className="mt-0.5 font-serif text-lg">{supported}</dd>
      </div>
    </dl>
  )
}

/** Contract requires vs Bank supports, for one requirement, on the reported path. */
export function Findings({
  result,
  selectedChecks,
}: {
  result: RequirementResult
  selectedChecks: CheckResult[]
}) {
  const clean =
    result.conflicts.length === 0 && result.manual_flags.length === 0 && result.unknowns.length === 0

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {result.conflicts.map((c) => (
          <Finding key={`c-${c.field}-${c.capability_id}`} tone="fail" tag="Conflict" field={c.field}>
            <Sides required={c.required} supported={c.supported} />
            <p className="mt-3 text-sm">{c.reason}</p>
            <p className="mt-2">
              <Citation capabilityId={c.capability_id} />
            </p>
          </Finding>
        ))}

        {result.manual_flags.map((m, i) => (
          <Finding key={`m-${m.field}-${i}`} tone="manual" tag="Needs a person" field={m.field}>
            <p className="text-sm">{m.reason}</p>
            <p className="mt-1.5 text-sm text-ink-soft">
              Owner: <span className="font-medium text-ink">{m.owner}</span>
              {m.sla_business_days !== null && <> · turnaround {businessDays(m.sla_business_days)}</>}
            </p>
            <p className="mt-2">
              <Citation capabilityId={m.capability_id} />
            </p>
          </Finding>
        ))}

        {result.unknowns.map((u, i) => (
          <Finding key={`u-${i}`} tone="manual" tag="Unknown" field={u.field}>
            <p className="text-sm">{u.reason}</p>
            <p className="mt-1.5 text-xs text-ink-soft">
              An unknown never becomes a PASS. It is carried into the decision as it stands.
            </p>
          </Finding>
        ))}
      </ul>

      {clean && (
        <p className="text-sm text-ink-soft">
          No conflicts, manual steps or unknowns on the reported path. Each check below shows what
          the contract requires against what the bank supports.
        </p>
      )}

      {clean && (
        <ul className="space-y-3">
          {selectedChecks.map((k, i) => (
            <Finding
              key={`k-${k.field}-${k.capability_id}-${i}`}
              tone={decisionTone(k.verdict)}
              tag={k.verdict}
              field={k.field}
            >
              <Sides required={k.required} supported={k.supported} />
              <p className="mt-2">
                <Citation capabilityId={k.capability_id} />
              </p>
            </Finding>
          ))}
        </ul>
      )}
    </div>
  )
}
