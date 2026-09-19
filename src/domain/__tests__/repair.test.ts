import { describe, expect, it } from 'vitest'
import { evaluateClause, evaluateRequirement } from '../evaluate'
import { TRANSACTION_TIME, cachedExtraction, capabilityGraph } from '../fixtures'
import { applyRepairs, proposeRepairs } from '../repair'

const G = capabilityGraph
const T = TRANSACTION_TIME

describe('signature loop — FAIL, repair, PASS', () => {
  const clause = cachedExtraction('credit-agreement-2.03-a')
  const req = clause.requirements[0]!
  const before = evaluateRequirement(req, G, T)
  const plan = proposeRepairs(req, before, G)
  const revised = applyRepairs(req, plan.proposals)
  const after = evaluateRequirement(revised, G, T)

  it('starts at FAIL', () => {
    expect(before.decision).toBe('FAIL')
  })

  it('proposes a change for every blocking field', () => {
    expect(plan.proposals.map((p) => p.field).sort()).toEqual([
      'amount.value',
      'booking_entity',
      'notice_channel',
      'required_fields',
      'timing.notice_cutoff',
    ])
  })

  it('ends at PASS on the same deterministic tests', () => {
    expect(after.decision).toBe('PASS')
    expect(after.conflicts).toHaveLength(0)
    expect(after.manual_flags).toHaveLength(0)
    expect(after.selected_path_id).toBe('cap-001+cap-010+cap-025')
  })

  it('re-runs the whole clause to PASS', () => {
    const revisedClause = { ...clause, requirements: [revised] }
    expect(evaluateClause(revisedClause, G, T).decision).toBe('PASS')
  })
})

describe('proposals are grounded, not invented', () => {
  const clause = cachedExtraction('credit-agreement-2.03-a')
  const req = clause.requirements[0]!
  const plan = proposeRepairs(req, evaluateRequirement(req, G, T), G)

  it('cites a real capability for every proposal', () => {
    const ids = new Set(G.capabilities.map((c) => c.capability_id))
    for (const p of plan.proposals) expect(ids.has(p.capability_id)).toBe(true)
  })

  it('takes the amount straight from the capability ceiling', () => {
    const amount = plan.proposals.find((p) => p.field === 'amount.value')!
    expect(amount.patch).toEqual({ kind: 'amount.value', value: 25000000 })
    const cap = G.capabilities.find((c) => c.capability_id === amount.capability_id)!
    expect(cap.constraints.max_amount).toBe(25000000)
  })

  it('takes the cutoff and its timezone straight from the capability', () => {
    const cutoff = plan.proposals.find((p) => p.field === 'timing.notice_cutoff')!
    expect(cutoff.patch).toEqual({
      kind: 'timing.cutoff',
      cutoff: '09:30',
      timezone: 'Europe/London',
    })
  })

  it('replaces the open booking promise with a named approved entity', () => {
    const entity = plan.proposals.find((p) => p.field === 'booking_entity')!
    expect(entity.from).toBe('any lending office')
    expect(entity.to).toBe('london')
    const cap = G.capabilities.find((c) => c.capability_id === entity.capability_id)!
    expect(cap.constraints.booking_entity).toContain('london')
  })

  it('never proposes a value the graph does not contain', () => {
    const graphNumbers = new Set<number>()
    for (const c of G.capabilities) {
      const k = c.constraints
      for (const n of [k.max_amount, k.amount_increment, k.max_observation_shift_days, k.max_fee_recipients, k.max_fee_currencies, k.min_service_level_business_days, k.notice_lead_business_days])
        if (typeof n === 'number') graphNumbers.add(n)
      for (const n of k.allowed_floor_bps ?? []) graphNumbers.add(n)
    }
    for (const p of plan.proposals) {
      if (p.patch.kind === 'amount.value') expect(graphNumbers.has(p.patch.value)).toBe(true)
      if (p.patch.kind === 'timing.service_level') expect(graphNumbers.has(p.patch.days)).toBe(true)
      if (p.patch.kind === 'interest.observation_shift') expect(graphNumbers.has(p.patch.days)).toBe(true)
    }
  })

  it('labels the narrative as a suggestion', () => {
    expect(plan.narrative).toMatch(/suggested drafting change/i)
    expect(plan.narrative).toMatch(/verified capability limits/i)
    expect(plan.narrative).toContain('25,000,000')
    expect(plan.narrative).toContain('09:30 Europe/London')
  })
})

describe('honesty about what drafting cannot fix', () => {
  it('offers no drafting change for a manual authentication step', () => {
    const clause = cachedExtraction('credit-agreement-2.02-c')
    const req = clause.requirements[0]!
    const plan = proposeRepairs(req, evaluateRequirement(req, G, T), G)
    expect(plan.proposals).toHaveLength(0)
    expect(plan.unrepairable.map((u) => u.field)).toEqual(
      expect.arrayContaining(['capability.outcome']),
    )
    expect(plan.narrative).toBeNull()
  })

  it('offers nothing when no complete path exists at all', () => {
    const req = cachedExtraction('credit-agreement-2.03-b').requirements[0]!
    const plan = proposeRepairs(req, evaluateRequirement(req, G, '2024-01-01T10:00:00Z'), G)
    expect(plan.proposals).toHaveLength(0)
    expect(plan.unrepairable[0]!.field).toBe('path')
  })

  it('does not propose anything for a clause that already passes', () => {
    const req = cachedExtraction('credit-agreement-2.03-b').requirements[0]!
    const plan = proposeRepairs(req, evaluateRequirement(req, G, T), G)
    expect(plan.proposals).toHaveLength(0)
  })
})

describe('repair is idempotent and does not overreach', () => {
  it('a second repair pass proposes nothing new', () => {
    const req = cachedExtraction('credit-agreement-2.03-a').requirements[0]!
    const first = proposeRepairs(req, evaluateRequirement(req, G, T), G)
    const revised = applyRepairs(req, first.proposals)
    const second = proposeRepairs(revised, evaluateRequirement(revised, G, T), G)
    expect(second.proposals).toHaveLength(0)
  })

  it('leaves the original requirement untouched', () => {
    const req = cachedExtraction('credit-agreement-2.03-a').requirements[0]!
    const plan = proposeRepairs(req, evaluateRequirement(req, G, T), G)
    applyRepairs(req, plan.proposals)
    expect(req.amount!.value).toBe(40000000)
    expect(req.booking_entity).toBe('any_lending_office')
  })
})
