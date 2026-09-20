import { describe, expect, it } from 'vitest'
import { TRANSACTION_TIME, agreement, cachedExtraction, capabilityGraphs } from '@/domain/fixtures'
import { applyRepairs, proposeRepairs } from '@/domain/repair'
import { verifyCitations } from '@/documents/citations'
import { readPacket } from '@/documents/packet'
import { resolutionFor } from '../resolution'
import { decisivePath, firstResult, timedEvaluate } from '../useAgreementReview'

/** A clause as the product reviews it: the real evaluation under one version, and under the other. */
function review(clauseId: string, version: number) {
  const other = version === 7 ? 8 : 7
  const clause = cachedExtraction(clauseId)
  const evaluated = timedEvaluate(clause, capabilityGraphs[version]!, agreement.agreement_version)
  const otherVersion = timedEvaluate(clause, capabilityGraphs[other]!, agreement.agreement_version)
  const plan = proposeRepairs(clause.requirements[0]!, firstResult(evaluated), capabilityGraphs[version]!)
  const citations = verifyCitations(capabilityGraphs[version]!, readPacket(version).policies)
  return { clause, evaluated, otherVersion, plan, resolution: resolutionFor({ evaluated, otherVersion, plan }, citations, TRANSACTION_TIME) }
}

describe('every finding answers "what do I do about this", and the three answers are kept apart', () => {
  it('a wording problem is a redraft, and nothing else is', () => {
    const kinds = agreement.clauses.map((c) => [c.source_span.section, review(c.clause_id, 7).resolution?.kind ?? null])
    expect(kinds).toEqual([
      ['2.03(a)', 'redraft'],
      ['2.02(c)', 'person'],
      ['2.03(b)', null],
      ['2.03(c)', 'bank_state'],
    ])
  })

  it('§2.03(c): the expired authority is named from the register and the policy that records it, with no drafting fix', () => {
    const { plan, resolution } = review('credit-agreement-2.03-c', 7)
    expect(plan.proposals).toHaveLength(0)
    if (resolution?.kind !== 'bank_state') throw new Error('expected a bank-state resolution')
    expect(resolution.lapsed).toEqual([{ role: 'treasury', approval_id: 'apr-021', expired: '2026-08-31', document_id: 'MCB-POL-007' }])
    expect(resolution.action).toMatch(/^No drafting change fixes this/)
  })

  it('§2.03(c): the v8 demonstration states what the real v8 evaluation returns, with no special case', () => {
    const { clause, resolution } = review('credit-agreement-2.03-c', 7)
    if (resolution?.kind !== 'bank_state' || !resolution.demonstration) throw new Error('expected a demonstration')
    const real = timedEvaluate(clause, capabilityGraphs[8]!, agreement.agreement_version)
    expect(resolution.demonstration.version).toBe(8)
    expect(resolution.demonstration.effective_from).toBe('2026-09-15')
    expect(resolution.demonstration.decision).toBe(real.report.decision)
    expect(resolution.demonstration.remaining).toEqual(decisivePath(real)!.checks.filter((k) => k.verdict !== 'PASS'))
    // The expired-authority failure is gone under v8, on the engine's own evaluation.
    expect(decisivePath(real)!.checks.some((k) => k.verdict === 'FAIL')).toBe(false)
  })

  it('§2.03(c) after the switch: the engine asks for a treasury sign-off, so the answer becomes a person, still never a redraft', () => {
    const { plan, resolution } = review('credit-agreement-2.03-c', 8)
    expect(plan.proposals).toHaveLength(0)
    if (resolution?.kind !== 'person') throw new Error('expected a human step')
    expect(resolution.steps).toEqual([
      { text: 'treasury sign-off', owner: 'treasury', sla_business_days: 1, lapsed_under: { version: 7, expired: '2026-08-31' } },
    ])
  })

  it('§2.02(c): names the manual step, and says no drafting change removes it', () => {
    const { plan, resolution } = review('credit-agreement-2.02-c', 7)
    expect(plan.proposals).toHaveLength(0)
    if (resolution?.kind !== 'person') throw new Error('expected a human step')
    expect(resolution.steps[0]).toEqual({
      text: 'Callback authentication of an emailed borrowing notice against the authorised-signatory list',
      owner: 'loan operations',
      sla_business_days: 1,
      lapsed_under: null,
    })
    expect(resolution.steps.map((s) => s.text)).toEqual(expect.arrayContaining(['loan operations sign-off', 'product owner sign-off']))
    expect(resolution.action).toBe('Refer to loan operations before signing. No drafting change removes this step.')
  })

  it('no bank-state demonstration is offered when the other version does not renew the authority', () => {
    const clause = cachedExtraction('credit-agreement-2.03-c')
    const evaluated = timedEvaluate(clause, capabilityGraphs[7]!, agreement.agreement_version)
    const plan = proposeRepairs(clause.requirements[0]!, firstResult(evaluated), capabilityGraphs[7]!)
    const citations = verifyCitations(capabilityGraphs[7]!, readPacket(7).policies)
    const same = resolutionFor({ evaluated, otherVersion: evaluated, plan }, citations, TRANSACTION_TIME)
    const alone = resolutionFor({ evaluated, otherVersion: null, plan }, citations, TRANSACTION_TIME)
    for (const r of [same, alone]) expect(r?.kind === 'bank_state' && r.demonstration).toBeNull()
  })

  it('a redraft never touches an approval or a manual step: applying every proposal leaves them as they were', () => {
    for (const c of agreement.clauses) {
      const { clause, evaluated, plan } = review(c.clause_id, 7)
      const operational = (e: typeof evaluated) => (decisivePath(e)?.checks ?? []).filter((k) => ['approval', 'capability.outcome'].includes(k.field) && k.verdict !== 'PASS')
      const redrafted = { ...clause, requirements: clause.requirements.map((r, i) => (i === 0 ? applyRepairs(r, plan.proposals) : r)) }
      if (plan.proposals.length === 0) expect(redrafted).toEqual(clause)
      else expect(operational(timedEvaluate(redrafted, capabilityGraphs[7]!, 'x'))).toEqual(operational(evaluated))
    }
  })
})
