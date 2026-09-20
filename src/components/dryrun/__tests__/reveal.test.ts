import { describe, expect, it } from 'vitest'
import { TRANSACTION_TIME, agreement, cachedExtraction, capabilityGraph } from '@/domain/fixtures'
import { evaluate } from '@/domain/evaluate'
import { applyRepairs, proposeRepairs } from '@/domain/repair'
import { cardTimeline, chipChange, chipMark, revealed, routeChecks, routesCounted, termChips } from '../reveal'

const decisive = (clauseId: string, repaired = false) => {
  const clause = cachedExtraction(clauseId)
  const first = evaluate([clause], capabilityGraph, TRANSACTION_TIME, agreement.agreement_version).clause_results[0]!.requirement_results[0]!
  const plan = proposeRepairs(clause.requirements[0]!, first, capabilityGraph)
  const requirement = repaired ? applyRepairs(clause.requirements[0]!, plan.proposals) : clause.requirements[0]!
  const result = repaired
    ? evaluate([{ ...clause, requirements: [requirement] }], capabilityGraph, TRANSACTION_TIME, agreement.agreement_version).clause_results[0]!.requirement_results[0]!
    : first
  return { requirement, plan, checks: result.candidate_paths.find((p) => p.path_id === result.selected_path_id)!.checks }
}

describe('termChips', () => {
  const { requirement, checks, plan } = decisive('credit-agreement-2.03-a')
  const chips = termChips(requirement)

  it('lands the terms of §2.03(a) in the promised order, amber where the clause is silent', () => {
    expect(chips.map((c) => c.text)).toEqual([
      'Fund draw', 'EUR', '40,000,000', 'Same day', 'Cutoff 11:00',
      'Timezone not stated', 'Any lending office', 'Channel not stated', 'Fields not stated',
    ])
    expect(chips.filter((c) => c.missing).map((c) => c.key)).toEqual(['timing.timezone', 'notice_channel', 'required_fields'])
  })

  it('omits what a notice clause has no use for instead of calling it missing', () => {
    const notice = termChips(decisive('credit-agreement-2.02-c').requirement)
    expect(notice.map((c) => c.text)).toEqual(['Receive notice', 'Email', '4 notice fields'])
  })

  it("puts the bank's side on the term it belongs to", () => {
    const marks = Object.fromEntries(chips.map((c) => [c.text, chipMark(c, checks)]))
    expect(marks['Fund draw']).toBeNull()
    expect(marks['EUR']).toMatchObject({ verdict: 'PASS', bank: null })
    expect(marks['Same day']).toMatchObject({ verdict: 'PASS', bank: null })
    expect(marks['40,000,000']).toMatchObject({ verdict: 'FAIL', bank: 'up to 25,000,000' })
    expect(marks['Cutoff 11:00']).toMatchObject({ verdict: 'FAIL', bank: '09:30 Europe/London' })
    expect(marks['Any lending office']).toMatchObject({ verdict: 'FAIL', bank: 'london only' })
    expect(chips.filter((c) => chipMark(c, checks)?.verdict === 'MANUAL').map((c) => c.text)).toEqual(['Channel not stated', 'Fields not stated'])
  })

  it('retypes every conflicting term from the repaired requirement, citing its capability, and then everything passes', () => {
    const after = decisive('credit-agreement-2.03-a', true)
    const repaired = termChips(after.requirement)
    const changes = chips.map((c) => chipChange(c, repaired.find((r) => r.key === c.key), plan))
    expect(changes.map((c) => c && `${c.to} · ${c.capability_id}`)).toEqual([
      null, null, '25,000,000 · cap-010', null, 'Cutoff 09:30 · cap-010',
      'Europe/London · cap-010', 'London · cap-025', 'Portal · cap-001', '4 notice fields · cap-001',
    ])
    expect(repaired.map((c) => chipMark(c, after.checks)?.verdict ?? null)).toEqual([null, ...Array(8).fill('PASS')])
  })

  it('shows a verdict no term carries as a route check, so a FAIL is never unexplained', () => {
    const c = decisive('credit-agreement-2.03-c')
    const cChips = termChips(c.requirement)
    expect(cChips.every((chip) => (chipMark(chip, c.checks)?.verdict ?? 'PASS') === 'PASS')).toBe(true)
    expect(routeChecks(cChips, c.checks).map((k) => `${k.verdict} ${k.field}`)).toEqual(['FAIL approval'])
    expect(routeChecks(chips, checks)).toEqual([])
  })
})

describe('pacing', () => {
  it('reveals in order and ends on the real totals', () => {
    const line = cardTimeline(9, 8, false, false)
    expect(line.chips).toBeLessThan(line.counter)
    expect(line.counter + line.counterMs).toBeLessThan(line.marks)
    expect(line.marks).toBeLessThan(line.pill)
    expect(revealed(line.chips, line.chips, line.chipEvery, 9)).toBe(1)
    expect(revealed(line.pill, line.chips, line.chipEvery, 9)).toBe(9)
    expect(routesCounted(line.counter - 1, line, 32)).toBe(0)
    expect(routesCounted(line.counter + line.counterMs / 2, line, 32)).toBe(16)
    expect(routesCounted(Infinity, line, 32)).toBe(32)
  })

  it('lands everything at once under reduced motion', () => {
    const line = cardTimeline(9, 8, true, true)
    expect(line.done).toBe(0)
    expect(revealed(0, line.chips, line.chipEvery, 9)).toBe(9)
    expect(routesCounted(0, line, 32)).toBe(32)
  })
})
