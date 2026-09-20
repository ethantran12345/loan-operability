import type { RepairPlan } from '@/domain/repair'
import type { CheckResult, Decision, Requirement, RequirementResult } from '@/domain/types'
import { humanize } from './format'

const SETTLEMENT_WORD: Record<string, string> = { same_day: 'same-day ', t_plus_1: 'T+1 ' }

/** A finding's headline: the outcome in plain words. The values sit under it. */
export function findingTitle(check: CheckResult, req: Requirement): string {
  const failed = check.verdict === 'FAIL'
  switch (check.field) {
    case 'amount.value':
      return `Unsupported ${SETTLEMENT_WORD[req.timing?.settlement ?? ''] ?? ''}amount`
    case 'amount.increment':
      return 'Amount is not a permitted increment'
    case 'timing.notice_cutoff':
      return failed ? 'Notice cutoff later than the bank accepts' : 'Cutoff depends on an unstated timezone'
    case 'timing.settlement':
      return 'Settlement basis not supported'
    case 'timing.notice_lead':
      return 'Notice period shorter than the bank needs'
    case 'booking_entity':
      return failed ? 'Booking office not supported' : 'Booking office needs review'
    case 'notice_channel':
      return failed ? 'Delivery channel not supported' : 'Delivery channel not stated'
    case 'required_fields':
      return failed ? 'Notice contents incomplete' : 'Notice contents not stated'
    case 'currency':
      return 'Currency not supported'
    case 'approval':
      return failed ? 'Approval authority not in force' : `Approval needed: ${check.required.replace(/ sign-off$/, '')}`
    case 'capability.outcome':
      return 'Manual handling required'
    case 'service_level':
    case 'manual_path.sla':
      return 'Service level depends on a manual step'
    case 'evidence.freshness':
      return 'Bank evidence is out of date'
    default:
      return `${humanize(check.field)} ${failed ? 'not supported' : 'needs review'}`
  }
}

/** Checks whose "required" side is a demand of the bank's route, not words in the clause. */
const ROUTE_SIDE = new Set(['approval', 'capability.outcome', 'evidence.freshness', 'manual_path.sla'])

/** The left-hand label: what the agreement says, or what the route itself demands. */
export const requiredSide = (check: CheckResult): string => (ROUTE_SIDE.has(check.field) ? 'Route needs' : 'Agreement')

/** The bank-side label and value, e.g. "Bank limit" / "EUR 25,000,000". */
export function bankSide(check: CheckResult): { label: string; value: string } {
  if (check.field === 'amount.value') return { label: 'Bank limit', value: check.supported.replace(/^max /, '') }
  if (check.field === 'timing.notice_cutoff') return { label: 'Bank cutoff', value: check.supported }
  if (check.field === 'booking_entity') return { label: 'Bank books through', value: humanize(check.supported) }
  if (check.field === 'approval') return { label: 'Bank record', value: check.supported }
  return { label: 'Bank', value: check.supported }
}

export const OUTCOME_HEADLINE: Record<Decision, string> = {
  FAIL: 'Not supportable as drafted',
  MANUAL: 'Supportable only with a manual step',
  PASS: 'Supported as drafted',
}

/** What the employee should do next. Never suggests that review can change a verdict. */
export function nextAction(result: RequirementResult, plan: RepairPlan): string {
  if (result.decision === 'PASS') return 'No action needed. One complete route supports this clause.'
  if (plan.proposals.length > 0) return 'Review the proposed amendment, then re-test it.'
  if (result.decision === 'MANUAL') {
    return `Refer to ${result.manual_owner ?? 'the named owner'} before signing. No drafting change removes this step.`
  }
  const reason = plan.unrepairable[0]?.reason
  return `No drafting change fixes this${reason ? `: ${reason}` : ''}. Escalate before signing.`
}
