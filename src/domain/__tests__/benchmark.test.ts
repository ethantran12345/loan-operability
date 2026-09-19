import { describe, expect, it } from 'vitest'
import { evaluateClause, evaluateRequirement } from '../evaluate'
import {
  TRANSACTION_TIME,
  agreement,
  cachedExtraction,
  capabilityGraph,
  capabilityGraphV8,
  capabilityGraphs,
} from '../fixtures'
import { proposeRepairs } from '../repair'

const T = TRANSACTION_TIME
const V7 = capabilityGraph
const V8 = capabilityGraphV8

/**
 * The benchmark clause: EUR 20M same-day through New York before 10:00 New York
 * time. Read as prose against the rulebook, New York looks supported "with a
 * Treasury exception". The decisive fact is a date that lives only in the graph:
 * the exception authority lapsed on 2026-08-31.
 */
describe('benchmark clause 2.03(c) — the answer depends on the institution, not the prose', () => {
  const clause = cachedExtraction('credit-agreement-2.03-c')

  it('is registered in the agreement as the benchmark', () => {
    const entry = agreement.clauses.find((c) => c.clause_id === clause.clause_id)!
    expect(entry.benchmark).toBe(true)
    expect(entry.scenario).toBe('FAIL')
  })

  describe('against graph v7 (authority expired)', () => {
    const result = evaluateClause(clause, V7, T)
    const req = result.requirement_results[0]!

    it('fails', () => {
      expect(result.decision).toBe('FAIL')
    })

    it('reports against the New York exception path, not London', () => {
      expect(req.selected_path_id).toBe('cap-001+cap-013+cap-027')
    })

    it('has exactly one decisive conflict and it is the expired authority', () => {
      expect(req.conflicts).toHaveLength(1)
      const c = req.conflicts[0]!
      expect(c.field).toBe('approval')
      expect(c.reason).toMatch(/treasury/i)
      expect(c.reason).toMatch(/not effective/i)
    })

    it('passes every other check on that path — amount at the inclusive limit, cutoff, entity, currency', () => {
      const path = req.candidate_paths.find((p) => p.path_id === req.selected_path_id)!
      const nonApproval = path.checks.filter((c) => c.field !== 'approval')
      expect(nonApproval.every((c) => c.verdict === 'PASS')).toBe(true)
      expect(nonApproval.map((c) => c.field)).toEqual(
        expect.arrayContaining(['amount.value', 'timing.notice_cutoff', 'booking_entity', 'currency']),
      )
    })

    it('rejected the London path on cutoff and entity, so the two cannot be mixed', () => {
      const london = req.candidate_paths.find((p) => p.path_id === 'cap-001+cap-010+cap-025')!
      expect(london.decision).toBe('FAIL')
      expect(london.checks.filter((c) => c.verdict === 'FAIL').map((c) => c.field)).toEqual(
        expect.arrayContaining(['timing.notice_cutoff', 'booking_entity']),
      )
    })

    it('offers no drafting repair, because the fix is on the bank side', () => {
      const plan = proposeRepairs(clause.requirements[0]!, req, V7)
      expect(plan.proposals).toHaveLength(0)
      expect(plan.unrepairable.map((u) => u.field)).toContain('approval')
    })
  })

  describe('against graph v8 (authority renewed 2026-09-15)', () => {
    const result = evaluateClause(clause, V8, T)
    const req = result.requirement_results[0]!

    it('becomes MANUAL with the same clause text', () => {
      expect(result.decision).toBe('MANUAL')
    })

    it('names treasury as the human step', () => {
      expect(req.manual_owner).toBe('treasury')
      expect(req.conflicts).toHaveLength(0)
    })

    it('selects the same New York path', () => {
      expect(req.selected_path_id).toBe('cap-001+cap-013+cap-027')
    })
  })

  it('the two graph versions differ only in the treasury authority', () => {
    const strip = (g: typeof V7) => ({
      ...g,
      version: 0,
      changelog: [],
      approvals: g.approvals.filter((a) => a.approval_id !== 'apr-021'),
    })
    expect(strip(V7)).toEqual(strip(V8))
    expect(capabilityGraphs[7]).toBe(V7)
    expect(capabilityGraphs[8]).toBe(V8)
  })
})

describe('adding the exception path did not move the three original scenarios', () => {
  it('2.03(a) still fails on amount, cutoff and booking entity against the London path', () => {
    const r = evaluateClause(cachedExtraction('credit-agreement-2.03-a'), V7, T)
    const req = r.requirement_results[0]!
    expect(r.decision).toBe('FAIL')
    expect(req.selected_path_id).toBe('cap-001+cap-010+cap-025')
    expect(req.conflicts.map((c) => c.field).sort()).toEqual(
      ['amount.value', 'booking_entity', 'timing.notice_cutoff'],
    )
  })

  it('2.03(a) now searches 32 paths, and the New York path is among the rejected', () => {
    const req = evaluateRequirement(cachedExtraction('credit-agreement-2.03-a').requirements[0]!, V7, T)
    expect(req.candidate_paths).toHaveLength(32)
    const ny = req.candidate_paths.find((p) => p.path_id === 'cap-001+cap-013+cap-027')!
    expect(ny.decision).toBe('FAIL')
  })

  it('2.02(c) is still MANUAL', () => {
    expect(evaluateClause(cachedExtraction('credit-agreement-2.02-c'), V7, T).decision).toBe('MANUAL')
  })

  it('2.03(b) still passes on the London path', () => {
    const r = evaluateClause(cachedExtraction('credit-agreement-2.03-b'), V7, T)
    expect(r.decision).toBe('PASS')
    expect(r.requirement_results[0]!.selected_path_id).toBe('cap-001+cap-010+cap-025')
  })

  it('the whole agreement reads FAIL, MANUAL, PASS, FAIL', () => {
    const decisions = agreement.clauses.map((c) => evaluateClause(cachedExtraction(c.clause_id), V7, T).decision)
    expect(decisions).toEqual(['FAIL', 'MANUAL', 'PASS', 'FAIL'])
  })
})
