/**
 * Challenge mode: check a general model's work.
 *
 * The claim is never "the model is wrong". A capable model given the same
 * files will often reach the same verdict. The claim is that a direct answer
 * is narrated, not searched, and that difference is checkable. So the engine
 * acts as referee: it grades the model's answer against the exhaustive path
 * search, the graph's real bounds, the clause's stated facts, and itself.
 *
 * Nothing here calls a model. The API builds the bundle, gets the answers, and
 * hands them to `gradeChallenge`. Every number on the scorecard is derived from
 * the graph and the evaluator result, never from prose.
 */

import { z } from 'zod'
import { DecisionSchema } from './schema.js'
import type { CapabilityGraph, Decision, ExtractedClause, RequirementResult } from './types'

// ---------------------------------------------------------------- the model's answer

export const ModelPathSchema = z.object({
  capability_ids: z.array(z.string().min(1)).min(1),
  verdict: DecisionSchema,
  reason: z.string().default(''),
})

export const ModelAnswerSchema = z.object({
  verdict: DecisionSchema,
  reasoning: z.string().default(''),
  paths_considered: z.array(ModelPathSchema).default([]),
  conflicts: z.array(z.object({ field: z.string().min(1), reason: z.string().default('') })).default([]),
  proposed_fix: z.array(z.object({ field: z.string().min(1), value: z.string().min(1) })).default([]),
  assumptions: z.array(z.string()).default([]),
})

export type ModelAnswer = z.infer<typeof ModelAnswerSchema>

// ---------------------------------------------------------------- the files the model gets

export interface ChallengeBundle {
  transaction_time: string
  clause_id: string
  clause_text: string
  /** The complete capability graph, verbatim. The same file the engine reads. */
  capability_graph: CapabilityGraph
  instructions: string
}

export function buildChallengeBundle(
  clause: Pick<ExtractedClause, 'clause_id' | 'source_text'>,
  graph: CapabilityGraph,
  txTime: string,
): ChallengeBundle {
  return {
    transaction_time: txTime,
    clause_id: clause.clause_id,
    clause_text: clause.source_text,
    capability_graph: graph,
    instructions: [
      'You are given one draft credit-agreement clause and the bank\'s complete capability graph as JSON.',
      `Decide whether the bank can operationally execute the clause as drafted, as of ${txTime}.`,
      'A complete operating path for a funding draw needs exactly one capability of each role: notice_intake, funding_window, booking_entity. Constraints hold only on the same path; a limit from one capability cannot be combined with a cutoff or entity from another.',
      'Effective dates on capabilities and approvals matter. Evidence freshness matters.',
      'Reply with JSON only, no prose outside the JSON, matching:',
      '{ "verdict": "PASS"|"MANUAL"|"FAIL", "reasoning": string, "paths_considered": [{ "capability_ids": string[], "verdict": "PASS"|"MANUAL"|"FAIL", "reason": string }], "conflicts": [{ "field": string, "reason": string }], "proposed_fix": [{ "field": string, "value": string }], "assumptions": string[] }',
      'List EVERY complete path you considered, by capability_id. List every assumption you made about a fact the clause does not state.',
    ].join('\n'),
  }
}

// ---------------------------------------------------------------- the scorecard

export interface PathGrade {
  total_real: number
  named: number
  named_real: number
  not_real: { capability_ids: string[]; reason: string }[]
  verdict_mismatches: { capability_ids: string[]; model: Decision; engine: Decision }[]
}

export interface FixGrade {
  proposals: number
  grounded: number
  ungrounded: { field: string; value: string; reason: string }[]
}

export interface AssumptionGrade {
  items: string[]
  /** Facts the clause left open that the engine carried as unknowns without guessing. */
  engine_unknowns: number
  /** Assumptions the grader detected even if the model did not declare them. */
  detected: string[]
}

export interface ReproducibilityGrade {
  runs: number
  distinct_verdicts: number
  distinct_conflict_sets: number
  engine_requirement_hash: string
}

export interface ChallengeGrade {
  verdict: { model: Decision; engine: Decision; agrees: boolean }
  paths: PathGrade
  fix: FixGrade
  assumptions: AssumptionGrade
  reproducibility: ReproducibilityGrade | null
}

const idSet = (ids: string[]) => [...new Set(ids)].sort().join('+')

/** Every value the graph actually contains. A proposed fix may only use these. */
export function graphVocabulary(graph: CapabilityGraph) {
  const numbers = new Set<number>()
  const clocks = new Set<string>()
  const timezones = new Set<string>()
  const entities = new Set<string>()
  const words = new Set<string>()
  for (const c of graph.capabilities) {
    const k = c.constraints
    for (const n of [
      k.max_amount, k.amount_increment, k.notice_lead_business_days, k.max_observation_shift_days,
      k.max_fee_recipients, k.max_fee_currencies, k.min_service_level_business_days,
    ]) if (typeof n === 'number') numbers.add(n)
    for (const n of k.allowed_floor_bps ?? []) numbers.add(n)
    if (k.cutoff) clocks.add(k.cutoff)
    if (k.timezone) timezones.add(k.timezone.toLowerCase())
    for (const e of k.booking_entity ?? []) entities.add(e)
    for (const w of [...(k.currency ?? []), ...(k.notice_channel ?? []), k.settlement ?? '']) if (w) words.add(w.toLowerCase())
    if (c.manual_path) numbers.add(c.manual_path.sla_business_days)
  }
  for (const a of graph.approvals) numbers.add(a.threshold)
  for (const o of graph.lending_offices) { entities.add(o.entity); timezones.add(o.timezone.toLowerCase()) }
  return { numbers, clocks, timezones, entities, words }
}

const ENTITY_ALIASES: Record<string, string> = {
  'new york': 'new_york', 'new_york': 'new_york', 'newyork': 'new_york', ny: 'new_york',
  london: 'london', toronto: 'toronto',
}

const ID_RE = /\b(?:cap|apr)-\d+\b/g
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g

function extractClaims(value: string, vocabWords: Set<string>) {
  const text = value.toLowerCase()
  // References to the graph's own records are claims about the graph, not numbers.
  const ids = [...text.matchAll(ID_RE)].map((m) => m[0])
  const clockRe = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g
  const clocks = [...text.matchAll(clockRe)].map((m) => `${m[1]!.padStart(2, '0')}:${m[2]}`)
  // Strip ids, dates and clocks before reading numbers, so "cap-013", "2026-09-15"
  // and "09:30" are never mistaken for amounts.
  const stripped = text.replace(ID_RE, ' ').replace(ISO_DATE_RE, ' ').replace(clockRe, ' ')
  const numbers: number[] = []
  for (const m of stripped.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(million|mm|m|k|bn|billion)?\b/g)) {
    const raw = Number(m[1]!.replace(/,/g, ''))
    if (!Number.isFinite(raw)) continue
    const mult = m[2]
    const scale = mult === 'k' ? 1e3 : mult === 'm' || mult === 'mm' || mult === 'million' ? 1e6 : mult === 'bn' || mult === 'billion' ? 1e9 : 1
    numbers.push(raw * scale)
  }
  const entities: string[] = []
  for (const [alias, canonical] of Object.entries(ENTITY_ALIASES)) if (text.includes(alias)) entities.push(canonical)
  // Currency codes, channels and settlement bases are graph vocabulary too.
  const words = [...vocabWords].filter((w) => new RegExp(`\\b${w.replace(/_/g, '[_ ]')}\\b`, 'i').test(text))
  return { ids, numbers, clocks, entities: [...new Set(entities)], words }
}

function gradeFix(answer: ModelAnswer, graph: CapabilityGraph): FixGrade {
  const vocab = graphVocabulary(graph)
  const ungrounded: FixGrade['ungrounded'] = []
  const knownIds = new Set([
    ...graph.capabilities.map((c) => c.capability_id),
    ...graph.approvals.map((a) => a.approval_id),
  ])
  for (const p of answer.proposed_fix) {
    const claims = extractClaims(p.value, vocab.words)
    const badIds = claims.ids.filter((id) => !knownIds.has(id))
    const badNumbers = claims.numbers.filter((n) => !vocab.numbers.has(n))
    const badClocks = claims.clocks.filter((c) => !vocab.clocks.has(c))
    const badEntities = claims.entities.filter((e) => !vocab.entities.has(e))
    const nothing =
      claims.ids.length + claims.numbers.length + claims.clocks.length + claims.entities.length + claims.words.length === 0
    const reasons: string[] = []
    if (badIds.length) reasons.push(`${badIds.join(', ')} is not a record in the capability graph`)
    if (badNumbers.length) reasons.push(`${badNumbers.map((n) => n.toLocaleString('en-US')).join(', ')} is not a bound anywhere in the capability graph`)
    if (badClocks.length) reasons.push(`${badClocks.join(', ')} is not a cutoff anywhere in the capability graph`)
    if (badEntities.length) reasons.push(`${badEntities.join(', ')} is not an approved booking entity`)
    if (nothing) reasons.push('no verifiable value: nothing in this proposal can be checked against the graph')
    if (reasons.length) ungrounded.push({ field: p.field, value: p.value, reason: reasons.join('; ') })
  }
  return { proposals: answer.proposed_fix.length, grounded: answer.proposed_fix.length - ungrounded.length, ungrounded }
}

function gradePaths(answer: ModelAnswer, result: RequirementResult, graph: CapabilityGraph): PathGrade {
  const real = new Map(result.candidate_paths.filter((p) => p.complete).map((p) => [idSet(p.legs.map((l) => l.capability_id)), p]))
  const known = new Set(graph.capabilities.map((c) => c.capability_id))
  const not_real: PathGrade['not_real'] = []
  const verdict_mismatches: PathGrade['verdict_mismatches'] = []
  let named_real = 0
  for (const mp of answer.paths_considered) {
    const key = idSet(mp.capability_ids)
    const hit = real.get(key)
    if (hit) {
      named_real++
      if (hit.decision !== mp.verdict) verdict_mismatches.push({ capability_ids: mp.capability_ids, model: mp.verdict, engine: hit.decision })
      continue
    }
    const unknown = mp.capability_ids.filter((id) => !known.has(id))
    if (unknown.length) { not_real.push({ capability_ids: mp.capability_ids, reason: `${unknown.join(', ')} does not exist in the graph` }); continue }
    const roles = mp.capability_ids.map((id) => graph.capabilities.find((c) => c.capability_id === id)!.role)
    if (new Set(roles).size !== roles.length) { not_real.push({ capability_ids: mp.capability_ids, reason: 'two capabilities of the same role cannot sit on one path' }); continue }
    const subset = [...real.keys()].some((k) => mp.capability_ids.every((id) => k.split('+').includes(id)))
    not_real.push({ capability_ids: mp.capability_ids, reason: subset ? 'incomplete: not every required leg is named' : 'this combination is not a candidate path for the operation' })
  }
  return { total_real: real.size, named: answer.paths_considered.length, named_real, not_real, verdict_mismatches }
}

const TZ_WORDS = /\b(london time|new york time|toronto time|europe\/london|america\/new_york|america\/toronto|utc|gmt|bst|est|edt)\b/i

function gradeAssumptions(answer: ModelAnswer, clause: ExtractedClause, result: RequirementResult): AssumptionGrade {
  const detected: string[] = []
  const req = clause.requirements[0]
  const prose = [answer.reasoning, ...answer.conflicts.map((c) => c.reason), ...answer.paths_considered.map((p) => p.reason)].join(' ')
  if (req?.timing?.notice_cutoff && req.timing.timezone === null) {
    const m = TZ_WORDS.exec(prose)
    if (m) detected.push(`Read the ${req.timing.notice_cutoff} cutoff as "${m[1]}" although the clause states no timezone`)
  }
  return { items: answer.assumptions, engine_unknowns: result.unknowns.length, detected }
}

export function gradeReproducibility(answers: ModelAnswer[], engineHash: string): ReproducibilityGrade | null {
  if (answers.length < 2) return null
  const verdicts = new Set(answers.map((a) => a.verdict))
  const conflictSets = new Set(answers.map((a) => [...new Set(a.conflicts.map((c) => c.field.toLowerCase().trim()))].sort().join('|')))
  return { runs: answers.length, distinct_verdicts: verdicts.size, distinct_conflict_sets: conflictSets.size, engine_requirement_hash: engineHash }
}

/**
 * Grade one model answer (the first run) against the engine, and its
 * consistency across every run. `result` is the engine's evaluation of the
 * same clause on the same graph version, `engineHash` the replay record's
 * requirement bundle hash.
 */
export function gradeChallenge(
  answers: ModelAnswer[],
  clause: ExtractedClause,
  result: RequirementResult,
  graph: CapabilityGraph,
  engineHash: string,
): ChallengeGrade {
  const answer = answers[0]
  if (!answer) throw new Error('gradeChallenge needs at least one model answer')
  return {
    verdict: { model: answer.verdict, engine: result.decision, agrees: answer.verdict === result.decision },
    paths: gradePaths(answer, result, graph),
    fix: gradeFix(answer, graph),
    assumptions: gradeAssumptions(answer, clause, result),
    reproducibility: gradeReproducibility(answers, engineHash),
  }
}
