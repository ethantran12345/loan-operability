// Agreement-side evidence: where in a clause's own words a checked term is stated,
// and whether a term that fails on the decisive route is supported somewhere else.
//
// Every function is pure. None decides anything: the verdicts they describe come
// from the evaluator's own comparators, and the values they draft from repair.ts.

import { COMPARATORS } from '../domain/comparators'
import type { RepairProposal } from '../domain/repair'
import { isEffectiveAt } from '../domain/time'
import type { Capability, CapabilityGraph, CheckResult, Decision, Requirement, RequirementResult } from '../domain/types'
import { clock12, officeName, zoneCity, type Span } from './citations'

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

export interface TermSpan extends Span {
  field: string
  verdict: Decision
}

const HARDER: Record<Decision, number> = { PASS: 0, MANUAL: 1, FAIL: 2 }

/**
 * Every term on the decisive route that did not pass, where the clause states it.
 * Two checks can read the same words (the amount and its increment); the harder
 * verdict marks them. A finding that is not in the clause's words marks nothing.
 */
export function locateFailing(clauseText: string, clauseStart: number, checks: CheckResult[]): TermSpan[] {
  const byStart = new Map<number, TermSpan>()
  for (const k of checks) {
    if (k.verdict === 'PASS') continue
    const term = locateTerm(clauseText, clauseStart, k.field)
    if (!term) continue
    const held = byStart.get(term.start)
    if (!held || HARDER[k.verdict] > HARDER[held.verdict]) byStart.set(term.start, { ...term, field: k.field, verdict: k.verdict })
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start)
}

const CHANNEL_WORDS: Record<string, string> = { portal: "through the Agent's electronic portal", email: 'by electronic mail' }
const FIELD_WORDS: Record<string, string> = {
  facility_id: 'the Facility',
  amount: 'the principal amount',
  currency: 'the currency',
  value_date: 'the requested value date',
}
const listed = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

/**
 * A proposed value in the words this agreement uses for that term: TERM_PATTERNS
 * read backwards. Only the wording is supplied here. The value is the proposal's
 * own, and a term this agreement has no idiom for stays as the proposal wrote it.
 */
export function draftTerm(p: RepairProposal): string {
  const { patch } = p
  switch (patch.kind) {
    case 'timing.cutoff':
      return patch.timezone.includes('/') ? `${clock12(patch.cutoff)} ${zoneCity(patch.timezone)} time` : p.to
    case 'booking_entity':
      return `the ${officeName(patch.entity)} Lending Office`
    case 'notice_channel':
      return CHANNEL_WORDS[patch.channel] ?? p.to
    case 'required_fields':
      return `specifying ${listed(patch.fields.map((f) => FIELD_WORDS[f] ?? f.replace(/_/g, ' ')))}`
    default:
      return p.to
  }
}

/** One side of a wording change: some words, and the range of them that changes. Offsets are into `text`. */
export interface WordingSide {
  text: string
  mark: Span
  /** The clause has more words before / after these. */
  lead: boolean
  more: boolean
}

export interface WordingDiff {
  /** The clause's own words around the term. null: the clause does not state it, so the change is an addition. */
  before: WordingSide | null
  after: WordingSide
}

/**
 * A proposal as a change to the clause's wording: the words around the failing
 * term as they stand, and the same words with the proposed term in its place.
 */
export function diffWording(clauseText: string, p: RepairProposal, pad = 32): WordingDiff {
  const draft = draftTerm(p)
  const term = locateTerm(clauseText, 0, p.field)
  if (!term) return { before: null, after: { text: draft, mark: { start: 0, end: draft.length, text: draft }, lead: false, more: false } }
  let from = Math.max(0, term.start - pad)
  let to = Math.min(clauseText.length, term.end + pad)
  if (from > 0) from = Math.min(term.start, clauseText.indexOf(' ', from) + 1)
  if (to < clauseText.length) to = Math.max(term.end, clauseText.lastIndexOf(' ', to))
  const head = clauseText.slice(from, term.start)
  const tail = clauseText.slice(term.end, to)
  const side = (words: string): WordingSide => ({
    text: `${head}${words}${tail}`,
    mark: { start: head.length, end: head.length + words.length, text: words },
    lead: from > 0,
    more: to < clauseText.length,
  })
  return { before: side(term.text), after: side(draft) }
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
