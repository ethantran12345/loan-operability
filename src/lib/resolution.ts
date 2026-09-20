import { evidenceForCheck, type CitationIndex } from '@/documents/citations'
import { HUMAN_ONLY, type RepairPlan } from '@/domain/repair'
import type { Approval, CapabilityGraph, CheckResult, Decision } from '@/domain/types'
import { nextAction } from './findingText'
import { decisivePath, firstResult, type Evaluated } from './useAgreementReview'

/** An approval authority the route needs that is past its end date at the transaction time. */
export interface LapsedAuthority {
  role: string
  approval_id: string
  expired: string
  /** The policy that records the authority, when the packet's citations trace it there. */
  document_id: string | null
}

/**
 * The other capabilities version, when the same terms no longer fail on the lapsed authority
 * under it. `decision` and `remaining` are that version's real evaluation, nothing assumed.
 */
export interface Demonstration {
  version: number
  effective_from: string
  decision: Decision
  remaining: CheckResult[]
}

/** A step only a person can take: what it is, who takes it, and how long the bank allows. */
export interface HumanStep {
  text: string
  owner: string | null
  sla_business_days: number | null
  /** Set on a sign-off whose authority had lapsed under the other capabilities version. */
  lapsed_under: { version: number; expired: string } | null
}

/**
 * What to do about a finding. Three honestly different answers, plus the rare one with none:
 * - 'redraft': the clause's wording can change, and the plan's proposals are the change.
 * - 'bank_state': the bank's own approved state has to change. Operational. No redraft touches it.
 * - 'person': a human step stands on the route. Operational. No redraft removes it.
 * - 'escalate': a FAIL with neither a drafting change nor a lapsed authority behind it.
 */
export type Resolution =
  | { kind: 'redraft' }
  | { kind: 'bank_state'; lapsed: LapsedAuthority[]; demonstration: Demonstration | null; action: string }
  | { kind: 'person'; steps: HumanStep[]; action: string }
  | { kind: 'escalate'; action: string }

const effectiveAt = (a: Approval, time: string) =>
  new Date(time).getTime() >= new Date(a.effective_from).getTime() && (!a.effective_to || new Date(time).getTime() <= new Date(a.effective_to).getTime())

/** The roles whose authority has run out, on the path the verdict was decided on. */
function lapsedOn(e: Evaluated, time: string): { check: CheckResult; approval: Approval }[] {
  return (decisivePath(e)?.checks ?? []).flatMap((check) => {
    if (check.field !== 'approval' || check.verdict !== 'FAIL') return []
    const approval = e.graph.approvals.find((a) => a.role === check.required)
    return approval?.effective_to && new Date(time).getTime() > new Date(approval.effective_to).getTime() ? [{ check, approval }] : []
  })
}

function humanStep(check: CheckResult, graph: CapabilityGraph): string {
  if (check.field === 'capability.outcome') return graph.capabilities.find((c) => c.capability_id === check.capability_id)?.manual_path?.description ?? check.supported.replace(/^manual: /, '')
  if (check.field === 'approval') return check.required
  return check.reason
}

export function resolutionFor(
  review: { evaluated: Evaluated; otherVersion: Evaluated | null; plan: RepairPlan },
  citations: CitationIndex,
  time: string,
): Resolution | null {
  const { evaluated, otherVersion, plan } = review
  const result = firstResult(evaluated)
  if (result.decision === 'PASS') return null
  if (plan.proposals.length > 0) return { kind: 'redraft' }
  const action = nextAction(result, plan)

  if (result.decision === 'FAIL') {
    const lapsed = lapsedOn(evaluated, time)
    if (lapsed.length === 0) return { kind: 'escalate', action }
    const renewed = otherVersion && lapsed.map(({ approval }) => otherVersion.graph.approvals.find((a) => a.role === approval.role))
    const other = otherVersion && decisivePath(otherVersion)
    const resolves = renewed && other && renewed.every((a) => a && effectiveAt(a, time)) && lapsedOn(otherVersion, time).length === 0
    return {
      kind: 'bank_state',
      lapsed: lapsed.map(({ check, approval }) => ({
        role: approval.role,
        approval_id: approval.approval_id,
        expired: approval.effective_to!,
        document_id: evidenceForCheck(check, citations, evaluated.graph).find((p) => p.record_id === approval.approval_id)?.document_id ?? null,
      })),
      demonstration: resolves
        ? {
            version: otherVersion.graph.version,
            effective_from: renewed[0]!.effective_from,
            decision: otherVersion.report.decision,
            remaining: other.checks.filter((k) => k.verdict !== 'PASS'),
          }
        : null,
      action,
    }
  }

  const before = otherVersion ? lapsedOn(otherVersion, time) : []
  const steps = (decisivePath(evaluated)?.checks ?? [])
    .filter((k) => k.verdict === 'MANUAL')
    .map((check) => {
      const was = check.field === 'approval' ? before.find((l) => l.approval.role === check.owner) : undefined
      return {
        text: humanStep(check, evaluated.graph),
        owner: check.owner ?? null,
        sla_business_days: check.sla_business_days ?? null,
        lapsed_under: was ? { version: otherVersion!.graph.version, expired: was.approval.effective_to! } : null,
      }
    })
  return { kind: 'person', steps, action }
}

/** Whether a check is one no wording can clear. The redraft panel never claims these. */
export const isOperational = (check: CheckResult) => HUMAN_ONLY.has(check.field)
