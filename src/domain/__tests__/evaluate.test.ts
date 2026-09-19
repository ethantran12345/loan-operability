import { describe, expect, it } from 'vitest'
import { evaluate, evaluateClause, evaluateRequirement } from '../evaluate'
import { TRANSACTION_TIME, agreement, cachedExtraction, capabilityGraph } from '../fixtures'
import type { ExtractedClause, Requirement } from '../types'

const G = capabilityGraph
const T = TRANSACTION_TIME

const fieldsOf = (fields: { field: string }[]) => fields.map((f) => f.field)

function drawRequirement(over: Partial<Requirement> = {}): Requirement {
  const base = cachedExtraction('credit-agreement-2.03-b').requirements[0]!
  return { ...structuredClone(base), ...over }
}

function withTiming(req: Requirement, over: Partial<NonNullable<Requirement['timing']>>): Requirement {
  return { ...req, timing: { ...req.timing!, ...over } }
}

// ------------------------------------------------------------------ scenarios

describe('scenario 1 — EUR 40M same-day draw through any lending office', () => {
  const clause = cachedExtraction('credit-agreement-2.03-a')
  const result = evaluateClause(clause, G, T)
  const req = result.requirement_results[0]!

  it('fails', () => {
    expect(result.decision).toBe('FAIL')
  })

  it('names the amount, cutoff and booking-location conflicts', () => {
    expect(fieldsOf(req.conflicts)).toEqual(
      expect.arrayContaining(['amount.value', 'timing.notice_cutoff', 'booking_entity']),
    )
  })

  it('cites the EUR window and the London entity as the capabilities it was tested against', () => {
    expect(req.matched_capabilities).toEqual(expect.arrayContaining(['cap-010', 'cap-025']))
  })

  it('compares real bounds, not prose', () => {
    const amount = req.conflicts.find((c) => c.field === 'amount.value')!
    expect(amount.required).toContain('40,000,000')
    expect(amount.supported).toContain('25,000,000')
    expect(amount.capability_id).toBe('cap-010')
  })

  it('reports the conflicts against the path they were measured on', () => {
    expect(req.selected_path_id).toBe('cap-001+cap-010+cap-025')
  })

  it('records that no path was selected for execution', () => {
    expect(evaluate([clause], G, T).replay.selected_path).toBeNull()
  })

  it('reports the unstated timezone as a surviving ambiguity', () => {
    expect(req.unknowns.map((u) => u.reason).join(' ')).toMatch(/timezone/i)
  })
})

describe('scenario 2 — borrowing notice by email requiring authentication', () => {
  const clause = cachedExtraction('credit-agreement-2.02-c')
  const result = evaluateClause(clause, G, T)
  const req = result.requirement_results[0]!

  it('returns MANUAL, not PASS and not FAIL', () => {
    expect(result.decision).toBe('MANUAL')
  })

  it('routes to the manual intake capability', () => {
    expect(req.selected_path_id).toBe('cap-002')
  })

  it('names an owner', () => {
    expect(req.manual_owner).toBe('loan operations')
  })

  it('does not report a hard conflict', () => {
    expect(req.conflicts).toHaveLength(0)
  })

  it('records that the portal path was tried and rejected on channel', () => {
    const portalPath = req.candidate_paths.find((p) => p.path_id === 'cap-001')!
    expect(portalPath.decision).toBe('FAIL')
    expect(portalPath.checks.some((c) => c.field === 'notice_channel' && c.verdict === 'FAIL')).toBe(true)
  })
})

describe('scenario 3 — EUR 20M same-day draw through London before 09:30', () => {
  const clause = cachedExtraction('credit-agreement-2.03-b')
  const result = evaluateClause(clause, G, T)
  const req = result.requirement_results[0]!

  it('passes', () => {
    expect(result.decision).toBe('PASS')
  })

  it('selects one complete path across intake, funding and booking', () => {
    expect(req.selected_path_id).toBe('cap-001+cap-010+cap-025')
    expect(req.matched_capabilities).toEqual(['cap-001', 'cap-010', 'cap-025'])
  })

  it('has no conflicts and nothing left for a human', () => {
    expect(req.conflicts).toHaveLength(0)
    expect(req.manual_flags).toHaveLength(0)
  })
})

// ------------------------------------------------------- cross-path integrity

describe('complete-path integrity', () => {
  it('will not lend the USD limit to a EUR draw', () => {
    const req = drawRequirement({ amount: { operator: 'lte', value: 40000000, unit: 'EUR' } })
    const result = evaluateRequirement(req, G, T)
    // USD's ceiling is 50M, which would cover 40M — but only on a USD path.
    const usdPaths = result.candidate_paths.filter((p) => p.path_id.includes('cap-009'))
    expect(usdPaths.length).toBeGreaterThan(0)
    for (const p of usdPaths) {
      expect(p.decision).toBe('FAIL')
      expect(p.checks.some((c) => c.field === 'currency' && c.verdict === 'FAIL')).toBe(true)
    }
    expect(result.decision).toBe('FAIL')
  })

  it('will not pair a EUR funding window with a Toronto booking entity', () => {
    const req = drawRequirement({ booking_entity: 'toronto' })
    const result = evaluateRequirement(req, G, T)
    const path = result.candidate_paths.find((p) => p.path_id === 'cap-001+cap-010+cap-026')!
    expect(path.decision).toBe('FAIL')
    expect(fieldsOf(path.checks.filter((c) => c.verdict === 'FAIL'))).toEqual(
      expect.arrayContaining(['currency']),
    )
  })

  it('fails when a required leg has no capability effective at the transaction time', () => {
    const req = drawRequirement()
    const result = evaluateRequirement(req, G, '2024-01-01T10:00:00Z')
    expect(result.decision).toBe('FAIL')
    expect(result.selected_path_id).toBe('incomplete')
    expect(result.conflicts[0]!.field).toMatch(/^path\./)
    expect(result.candidate_paths[0]!.complete).toBe(false)
  })
})

// ------------------------------------------------------------- amount bounds

describe('amount comparator', () => {
  it('passes at exactly the inclusive limit', () => {
    const req = drawRequirement({ amount: { operator: 'lte', value: 25000000, unit: 'EUR' } })
    expect(evaluateRequirement(req, G, T).decision).toBe('PASS')
  })

  it('fails one increment above the limit', () => {
    const req = drawRequirement({ amount: { operator: 'lte', value: 25100000, unit: 'EUR' } })
    const r = evaluateRequirement(req, G, T)
    expect(r.decision).toBe('FAIL')
    expect(fieldsOf(r.conflicts)).toContain('amount.value')
  })

  it('fails an amount that is not a permitted increment', () => {
    const req = drawRequirement({ amount: { operator: 'lte', value: 20050000, unit: 'EUR' } })
    const r = evaluateRequirement(req, G, T)
    expect(r.decision).toBe('FAIL')
    expect(fieldsOf(r.conflicts)).toContain('amount.increment')
  })
})

// -------------------------------------------------------------- cutoff bounds

describe('cutoff comparator', () => {
  it('fails when no timezone reading of the clause could meet the cutoff', () => {
    const req = withTiming(drawRequirement(), { notice_cutoff: '11:00', timezone: null })
    const r = evaluateRequirement(req, G, T)
    const cutoff = r.conflicts.find((c) => c.field === 'timing.notice_cutoff')
    expect(cutoff).toBeDefined()
    expect(cutoff!.reason).toMatch(/every candidate lending-office timezone/i)
  })

  it('returns MANUAL when the answer depends on the missing timezone', () => {
    const req = withTiming(drawRequirement(), { notice_cutoff: '08:00', timezone: null })
    const r = evaluateRequirement(req, G, T)
    expect(r.decision).toBe('MANUAL')
    expect(fieldsOf(r.manual_flags)).toContain('timing.notice_cutoff')
  })

  it('passes when every timezone reading meets the cutoff', () => {
    // 04:00 is before 09:30 London even read as a New York wall clock.
    const req = withTiming(drawRequirement(), { notice_cutoff: '04:00', timezone: null })
    expect(evaluateRequirement(req, G, T).decision).toBe('PASS')
  })

  it('normalises a stated timezone before comparing', () => {
    const req = withTiming(drawRequirement(), {
      notice_cutoff: '04:00',
      timezone: 'America/New_York',
    })
    // 04:00 New York is 09:00 London, inside the 09:30 cutoff.
    expect(evaluateRequirement(req, G, T).decision).toBe('PASS')
  })

  it('fails a stated timezone that lands after the cutoff', () => {
    const req = withTiming(drawRequirement(), {
      notice_cutoff: '09:00',
      timezone: 'America/New_York',
    })
    const r = evaluateRequirement(req, G, T)
    expect(r.decision).toBe('FAIL')
    expect(r.conflicts.find((c) => c.field === 'timing.notice_cutoff')!.reason).toMatch(/14:00/)
  })
})

// ------------------------------------------------------------ booking entity

describe('booking entity comparator', () => {
  it('treats "any lending office" as a promise of every office', () => {
    const req = drawRequirement({ booking_entity: 'any_lending_office' })
    const r = evaluateRequirement(req, G, T)
    expect(r.decision).toBe('FAIL')
    const conflict = r.conflicts.find((c) => c.field === 'booking_entity')!
    expect(conflict.reason).toMatch(/new_york/)
    expect(conflict.reason).toMatch(/toronto/)
  })
})

// --------------------------------------------------- unknown never becomes pass

describe('missing information', () => {
  it('returns MANUAL when the delivery channel is not stated', () => {
    const req = drawRequirement({ notice_channel: 'unspecified' })
    expect(evaluateRequirement(req, G, T).decision).toBe('MANUAL')
  })

  it('returns MANUAL when the notice contents are not committed', () => {
    const req = drawRequirement({ required_fields: null })
    expect(evaluateRequirement(req, G, T).decision).toBe('MANUAL')
  })

  it('returns MANUAL when the settlement basis is not stated', () => {
    const req = withTiming(drawRequirement(), { settlement: 'unspecified' })
    expect(evaluateRequirement(req, G, T).decision).not.toBe('PASS')
  })
})

// ----------------------------------------------------------- manual path SLA

describe('manual process timing', () => {
  it('fails when the manual path is slower than the promised service level', () => {
    const clause = cachedExtraction('credit-agreement-2.02-c')
    const req = clause.requirements[0]!
    req.timing = { ...req.timing!, service_level_business_days: 0 }
    const r = evaluateRequirement(req, G, T)
    expect(r.decision).toBe('FAIL')
    expect(r.conflicts.find((c) => c.field === 'manual_path.sla')!.reason).toMatch(/cannot meet/i)
  })

  it('accepts a manual path that fits inside the promised service level', () => {
    const clause = cachedExtraction('credit-agreement-2.02-c')
    expect(evaluateClause(clause, G, T).decision).toBe('MANUAL')
  })
})

// ------------------------------------------------------------------- approvals

describe('approval validity', () => {
  it('fails when the approving role cannot authorise the size', () => {
    const graph = structuredClone(G)
    graph.approvals = graph.approvals.map((a) =>
      a.role === 'loan operations' ? { ...a, threshold: 1000 } : a,
    )
    const clause = cachedExtraction('credit-agreement-2.02-c')
    const req = clause.requirements[0]!
    req.amount = { operator: 'lte', value: 5000000, unit: 'EUR' }
    const r = evaluateRequirement(req, graph, T)
    expect(r.decision).toBe('FAIL')
    expect(fieldsOf(r.conflicts)).toContain('approval')
  })

  it('fails on an expired authority', () => {
    const graph = structuredClone(G)
    graph.approvals = graph.approvals.map((a) =>
      a.role === 'loan operations' ? { ...a, effective_to: '2026-06-30' } : a,
    )
    const r = evaluateRequirement(cachedExtraction('credit-agreement-2.02-c').requirements[0]!, graph, T)
    expect(r.decision).toBe('FAIL')
    expect(r.conflicts.find((c) => c.field === 'approval')!.reason).toMatch(/not effective/i)
  })

  it('fails a self-approval', () => {
    const graph = structuredClone(G)
    graph.approvals = graph.approvals.map((a) =>
      a.role === 'loan operations' ? { ...a, self_approval: true } : a,
    )
    const r = evaluateRequirement(cachedExtraction('credit-agreement-2.02-c').requirements[0]!, graph, T)
    expect(r.decision).toBe('FAIL')
    expect(r.conflicts.find((c) => c.field === 'approval')!.reason).toMatch(/independent/i)
  })
})

// -------------------------------------------------------------- evidence status

describe('evidence status', () => {
  it('will not silently pass on stale evidence', () => {
    const clause = cachedExtraction('credit-agreement-2.03-b')
    const late = evaluateClause(clause, G, '2027-06-01T09:00:00Z')
    expect(late.decision).toBe('MANUAL')
    expect(late.requirement_results[0]!.unknowns.map((u) => u.field)).toContain('evidence.freshness')
  })
})

// --------------------------------------------------------------------- interest

describe('interest comparator', () => {
  const interestReq = (over: Partial<NonNullable<Requirement['interest']>>): Requirement => ({
    ...drawRequirement(),
    operation: 'calculate_interest',
    amount: null,
    timing: null,
    booking_entity: null,
    notice_channel: null,
    required_fields: null,
    interest: {
      benchmark: 'EURIBOR',
      method: 'compounded_in_arrears',
      day_count: 'ACT/360',
      observation_shift_days: 5,
      floor_bps: 0,
      ...over,
    },
  })

  it('passes a standard EURIBOR configuration', () => {
    expect(evaluateRequirement(interestReq({}), G, T).decision).toBe('PASS')
  })

  it('fails an observation shift beyond the platform limit', () => {
    const r = evaluateRequirement(interestReq({ observation_shift_days: 7 }), G, T)
    expect(r.decision).toBe('FAIL')
    expect(fieldsOf(r.conflicts)).toContain('interest.observation_shift_days')
  })

  it('returns MANUAL for a non-standard negative floor', () => {
    const r = evaluateRequirement(interestReq({ floor_bps: -50 }), G, T)
    expect(r.decision).toBe('MANUAL')
    expect(fieldsOf(r.manual_flags)).toContain('interest.floor_bps')
  })

  it('does not accept a method name alone when a parameter is out of bounds', () => {
    const r = evaluateRequirement(
      interestReq({ observation_shift_days: 7, floor_bps: -50 }),
      G,
      T,
    )
    expect(r.decision).toBe('FAIL')
  })
})

// -------------------------------------------------------------------- fees

describe('fee comparator', () => {
  const feeReq = (over: Partial<NonNullable<Requirement['fee']>>, sla: number | null): Requirement => ({
    ...drawRequirement(),
    operation: 'collect_fee',
    amount: null,
    booking_entity: null,
    notice_channel: null,
    required_fields: null,
    timing: {
      settlement: 'unspecified',
      notice_cutoff: null,
      timezone: null,
      notice_lead_business_days: null,
      service_level_business_days: sla,
    },
    fee: {
      basis: 'external_esg_metric',
      recipients: 4,
      currencies: ['USD', 'EUR', 'CAD'],
      recalculation_frequency: 'monthly',
      ...over,
    },
  })

  it('returns MANUAL for a metric-linked multi-currency fee with a workable service level', () => {
    const r = evaluateRequirement(feeReq({}, 3), G, T)
    expect(r.decision).toBe('MANUAL')
    expect(r.manual_owner).toBe('loan operations')
  })

  it('fails when the promised one-day turnaround is faster than any fee path', () => {
    const r = evaluateRequirement(feeReq({}, 1), G, T)
    expect(r.decision).toBe('FAIL')
    // No path can finish in one business day, so the decisive conflict is timing.
    expect(fieldsOf(r.conflicts)).toContain('service_level')
    // And the manual path independently fails its own SLA against the clause.
    const manualPath = r.candidate_paths.find((p) => p.path_id === 'cap-023')!
    expect(
      manualPath.checks.some((c) => c.field === 'manual_path.sla' && c.verdict === 'FAIL'),
    ).toBe(true)
  })

  it('passes a standard single-recipient commitment fee', () => {
    const r = evaluateRequirement(
      feeReq({ basis: 'commitment', recipients: 1, currencies: ['USD'] }, 5),
      G,
      T,
    )
    expect(r.decision).toBe('PASS')
  })
})

// ------------------------------------------------------------ clause severity

describe('clause and agreement severity', () => {
  it('takes the most severe unresolved requirement result', () => {
    const clause: ExtractedClause = {
      ...cachedExtraction('credit-agreement-2.03-b'),
      requirements: [
        cachedExtraction('credit-agreement-2.03-b').requirements[0]!,
        cachedExtraction('credit-agreement-2.03-a').requirements[0]!,
      ],
    }
    expect(evaluateClause(clause, G, T).decision).toBe('FAIL')
  })

  it('never lets a non-mandatory requirement fail the clause outright', () => {
    const optional = { ...cachedExtraction('credit-agreement-2.03-a').requirements[0]!, mandatory: false }
    const clause: ExtractedClause = {
      ...cachedExtraction('credit-agreement-2.03-b'),
      requirements: [cachedExtraction('credit-agreement-2.03-b').requirements[0]!, optional],
    }
    expect(evaluateClause(clause, G, T).decision).toBe('MANUAL')
  })

  it('reports the whole agreement at its worst clause', () => {
    const report = evaluate(
      agreement.clauses.map((c) => cachedExtraction(c.clause_id)),
      G,
      T,
    )
    expect(report.decision).toBe('FAIL')
    expect(report.clause_results.map((c) => c.decision)).toEqual(['FAIL', 'MANUAL', 'PASS'])
  })
})

// ------------------------------------------------------------- replay record

describe('replay record', () => {
  const clauses = agreement.clauses.map((c) => cachedExtraction(c.clause_id))

  it('pins the inputs the decision was made against', () => {
    const report = evaluate(clauses, G, T)
    expect(report.replay.capability_graph_version).toBe(7)
    expect(report.replay.evaluator_version).toBe('0.1.0')
    expect(report.replay.transaction_time).toBe(T)
    expect(report.replay.requirement_bundle_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('is stable for identical inputs', () => {
    expect(evaluate(clauses, G, T).replay.requirement_bundle_hash).toBe(
      evaluate(clauses, G, T).replay.requirement_bundle_hash,
    )
  })

  it('changes when a single requirement changes', () => {
    const edited = structuredClone(clauses)
    edited[0]!.requirements[0]!.amount!.value = 25000000
    expect(evaluate(edited, G, T).replay.requirement_bundle_hash).not.toBe(
      evaluate(clauses, G, T).replay.requirement_bundle_hash,
    )
  })

  it('carries the decisive conflicts and the evidence behind them', () => {
    const report = evaluate(clauses, G, T)
    expect(report.replay.decisive_conflicts).toEqual(
      expect.arrayContaining(['amount.value', 'booking_entity']),
    )
    expect(report.replay.evidence_ids).toEqual(
      expect.arrayContaining(['credit-agreement-2.03-a', 'cap-010', 'cap-025']),
    )
  })
})
