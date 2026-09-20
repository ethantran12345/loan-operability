import { describe, expect, it } from 'vitest'
import { ModelAnswerSchema, buildChallengeBundle, gradeChallenge, graphVocabulary } from '../challenge'
import type { ModelAnswer } from '../challenge'
import { evaluate, evaluateRequirement } from '../evaluate'
import { TRANSACTION_TIME, cachedExtraction, capabilityGraph } from '../fixtures'

const G = capabilityGraph
const T = TRANSACTION_TIME
const clause = cachedExtraction('credit-agreement-2.03-a')
const req = clause.requirements[0]!
const result = evaluateRequirement(req, G, T)
const hash = evaluate([clause], G, T).replay.requirement_bundle_hash

/** What a careful reader with the same files would plausibly write. */
const typicalAnswer: ModelAnswer = {
  verdict: 'FAIL',
  reasoning: 'EUR 40M exceeds the EUR 25M same-day cap, and 11:00 London time is after the 09:30 cutoff. Only London books EUR.',
  paths_considered: [
    { capability_ids: ['cap-010', 'cap-025'], verdict: 'FAIL', reason: 'amount and cutoff' },
    { capability_ids: ['cap-001', 'cap-009', 'cap-025'], verdict: 'FAIL', reason: 'USD window, wrong currency' },
    { capability_ids: ['cap-001', 'cap-010', 'cap-013'], verdict: 'FAIL', reason: 'two windows' },
  ],
  conflicts: [
    { field: 'amount', reason: 'EUR 40M > EUR 25M' },
    { field: 'cutoff', reason: '11:00 is after 09:30' },
  ],
  proposed_fix: [
    { field: 'amount', value: 'Cap same-day draws at EUR 30,000,000' },
    { field: 'cutoff', value: 'Move the cutoff to 10:00 London time' },
    { field: 'booking', value: 'Book through London' },
  ],
  assumptions: ['Assumed 11:00 A.M. refers to London time'],
}

describe('the model answer schema is forgiving about optional parts', () => {
  it('accepts a minimal answer', () => {
    expect(ModelAnswerSchema.safeParse({ verdict: 'FAIL' }).success).toBe(true)
  })
  it('rejects an unknown verdict', () => {
    expect(ModelAnswerSchema.safeParse({ verdict: 'MAYBE' }).success).toBe(false)
  })
})

describe('the bundle is the same file the engine reads', () => {
  it('ships the full graph and the clause text verbatim', () => {
    const b = buildChallengeBundle(clause, G, T)
    expect(b.capability_graph).toBe(G)
    expect(b.clause_text).toBe(clause.source_text)
    expect(b.instructions).toMatch(/JSON only/)
    expect(b.instructions).toMatch(/EVERY complete path/)
  })
})

describe('grading a typical direct answer', () => {
  const grade = gradeChallenge([typicalAnswer], clause, result, G, hash)

  it('credits an agreeing verdict without pretending otherwise', () => {
    expect(grade.verdict).toEqual({ model: 'FAIL', engine: 'FAIL', agrees: true })
  })

  it('counts enumeration against the real search space', () => {
    expect(grade.paths.total_real).toBe(32)
    expect(grade.paths.named).toBe(3)
    expect(grade.paths.named_real).toBe(1)
  })

  it('names why each non-real path is not a path', () => {
    const reasons = grade.paths.not_real.map((n) => n.reason)
    expect(reasons.some((r) => /incomplete/.test(r))).toBe(true)
    expect(reasons.some((r) => /same role/.test(r))).toBe(true)
  })

  it('catches values the graph does not contain', () => {
    expect(grade.fix.proposals).toBe(3)
    const bad = grade.fix.ungrounded.map((u) => u.value)
    expect(bad).toContain('Cap same-day draws at EUR 30,000,000')
    expect(bad).toContain('Move the cutoff to 10:00 London time')
    expect(grade.fix.ungrounded.find((u) => u.value.includes('30,000,000'))!.reason).toMatch(/30,000,000 is not a bound/)
  })

  it('accepts a proposal built from a real bound', () => {
    expect(grade.fix.ungrounded.map((u) => u.value)).not.toContain('Book through London')
    expect(grade.fix.grounded).toBe(1)
  })

  it('surfaces the timezone the model read into the clause', () => {
    expect(grade.assumptions.items).toHaveLength(1)
    expect(grade.assumptions.detected[0]).toMatch(/london time/i)
    expect(grade.assumptions.engine_unknowns).toBeGreaterThan(0)
  })

  it('has no reproducibility grade for a single run', () => {
    expect(grade.reproducibility).toBeNull()
  })
})

describe('grading the engine against itself is a clean sheet', () => {
  it('a perfect answer scores perfectly', () => {
    const perfect: ModelAnswer = {
      verdict: result.decision,
      reasoning: '',
      paths_considered: result.candidate_paths.map((p) => ({ capability_ids: p.legs.map((l) => l.capability_id), verdict: p.decision, reason: '' })),
      conflicts: result.conflicts.map((c) => ({ field: c.field, reason: c.reason })),
      proposed_fix: [
        { field: 'amount', value: 'EUR 25,000,000' },
        { field: 'cutoff', value: '09:30 Europe/London' },
        { field: 'booking_entity', value: 'london' },
      ],
      assumptions: [],
    }
    const grade = gradeChallenge([perfect, perfect], clause, result, G, hash)
    expect(grade.verdict.agrees).toBe(true)
    expect(grade.paths.named_real).toBe(32)
    expect(grade.paths.not_real).toHaveLength(0)
    expect(grade.paths.verdict_mismatches).toHaveLength(0)
    expect(grade.fix.ungrounded).toHaveLength(0)
    expect(grade.assumptions.detected).toHaveLength(0)
    expect(grade.reproducibility).toEqual({ runs: 2, distinct_verdicts: 1, distinct_conflict_sets: 1, engine_requirement_hash: hash })
  })
})

describe('reproducibility across runs', () => {
  it('counts distinct verdicts and distinct conflict sets', () => {
    const a = { ...typicalAnswer }
    const b: ModelAnswer = { ...typicalAnswer, verdict: 'MANUAL', conflicts: [{ field: 'Amount', reason: '' }] }
    const c: ModelAnswer = { ...typicalAnswer, conflicts: [{ field: 'amount', reason: '' }, { field: 'cutoff', reason: '' }] }
    const grade = gradeChallenge([a, b, c], clause, result, G, hash)
    expect(grade.reproducibility).toEqual({ runs: 3, distinct_verdicts: 2, distinct_conflict_sets: 2, engine_requirement_hash: hash })
  })

  it('flags a path the model graded differently from the engine', () => {
    const wrong: ModelAnswer = { ...typicalAnswer, paths_considered: [{ capability_ids: ['cap-001', 'cap-010', 'cap-025'], verdict: 'PASS', reason: '' }] }
    const grade = gradeChallenge([wrong], clause, result, G, hash)
    expect(grade.paths.verdict_mismatches).toEqual([{ capability_ids: ['cap-001', 'cap-010', 'cap-025'], model: 'PASS', engine: 'FAIL' }])
  })

  it('rejects a capability id that does not exist', () => {
    const ghost: ModelAnswer = { ...typicalAnswer, paths_considered: [{ capability_ids: ['cap-001', 'cap-999', 'cap-025'], verdict: 'FAIL', reason: '' }] }
    expect(gradeChallenge([ghost], clause, result, G, hash).paths.not_real[0]!.reason).toMatch(/cap-999 does not exist/)
  })
})

describe('graph vocabulary', () => {
  it('holds every bound a grounded proposal may use', () => {
    const v = graphVocabulary(G)
    expect(v.numbers.has(25000000)).toBe(true)
    expect(v.numbers.has(30000000)).toBe(false)
    expect(v.clocks.has('09:30')).toBe(true)
    expect(v.clocks.has('10:00')).toBe(false)
    expect(v.entities.has('new_york')).toBe(true)
  })
})
