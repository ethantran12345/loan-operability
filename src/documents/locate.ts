// Agreement-side evidence: where in a clause's own words a checked term is stated,
// and whether a term that fails on the decisive route is supported somewhere else.
//
// Both functions are pure. Neither decides anything: the verdicts they describe
// come from the evaluator's own comparators.

import { COMPARATORS } from '../domain/comparators'
import { isEffectiveAt } from '../domain/time'
import type { Capability, CapabilityGraph, CheckResult, Requirement, RequirementResult } from '../domain/types'
import type { Span } from './citations'

const CURRENCY_WORDS = 'Euro|US dollars|Dollars|sterling|Sterling'

/** How a clause writes each checked term. Matched against the clause's exact text. */
const TERM_PATTERNS: Record<string, RegExp> = {
  currency: new RegExp(`denominated in (?:${CURRENCY_WORDS})`),
  'amount.value': /(?:EUR|USD|GBP|CAD) [\d,]+/,
  'amount.increment': /(?:EUR|USD|GBP|CAD) [\d,]+/,
  'timing.settlement': /same-day settlement/,
  'timing.notice_lead': /same-day settlement/,
  'timing.notice_cutoff': /\d{1,2}:\d{2} [AP]\.M\.(?: (?:London|New York|Toronto) time)?/,
  booking_entity: /any Lending Office|(?:London|New York|Toronto) Lending Office/,
  notice_channel: /electronic mail|electronic portal/,
  required_fields: /specif(?:y|ying) the Facility, the principal amount, the currency and the requested value date/,
  'capability.outcome': /electronic mail/,
  service_level: /within one Business Day of receipt/,
  'manual_path.sla': /within one Business Day of receipt/,
}

/**
 * The words in the clause that state the term a check is about, as offsets into
 * the agreement's raw file. null means the clause does not state it, which is
 * itself the finding for an unspecified channel or unstated notice contents.
 */
export function locateTerm(clauseText: string, clauseStart: number, field: string): Span | null {
  const m = TERM_PATTERNS[field]?.exec(clauseText)
  if (!m) return null
  return { start: clauseStart + m.index, end: clauseStart + m.index + m[0].length, text: m[0] }
}

export interface ElsewhereSupport {
  field: string
  required: string
  /** A capability that, taken alone, accepts this one term. */
  capability_id: string
  label: string
  supported: string
  /** What that same capability rejects, which is why it is not an answer. */
  blocked_by: { field: string; required: string; supported: string }[]
}

/**
 * For each term that FAILS on the decisive route: another capability in the same
 * role that accepts that term on its own, and what that capability rejects
 * instead. This is the "individually supported, but not on one route" evidence.
 *
 * It runs the evaluator's own comparators, one capability at a time, so it can
 * see capabilities the path search pruned (a T+1 window for a same-day clause).
 * A capability in another currency is skipped: its limit is in other money. A
 * term no capability accepts is omitted. Nothing here affects a verdict.
 */
export function supportedElsewhere(
  req: Requirement,
  result: RequirementResult,
  graph: CapabilityGraph,
  txTime: string,
): ElsewhereSupport[] {
  const decisive = result.candidate_paths.find((p) => p.path_id === result.selected_path_id)
  if (!decisive || result.decision === 'PASS') return []
  const out: ElsewhereSupport[] = []
  for (const check of decisive.checks.filter((k) => k.verdict === 'FAIL')) {
    const own = graph.capabilities.find((c) => c.capability_id === check.capability_id)
    if (!own) continue
    let best: { cap: Capability; hit: CheckResult; blocked: CheckResult[] } | null = null
    for (const cap of graph.capabilities) {
      if (cap.capability_id === own.capability_id || cap.role !== own.role) continue
      if (!isEffectiveAt(cap.effective_from, cap.effective_to, txTime)) continue
      const checks = COMPARATORS.flatMap(({ run }) => run(req, cap, graph, txTime))
      if (checks.some((k) => k.field === 'currency' && k.verdict === 'FAIL')) continue
      const hit = checks.find((k) => k.field === check.field && k.verdict === 'PASS')
      if (!hit) continue
      const blocked = checks.filter((k) => k.verdict === 'FAIL')
      if (blocked.length > 0 && (!best || blocked.length < best.blocked.length)) best = { cap, hit, blocked }
    }
    if (best) {
      out.push({
        field: check.field,
        required: check.required,
        capability_id: best.cap.capability_id,
        label: best.cap.label,
        supported: best.hit.supported,
        blocked_by: best.blocked.map((k) => ({ field: k.field, required: k.required, supported: k.supported })),
      })
    }
  }
  return out
}
