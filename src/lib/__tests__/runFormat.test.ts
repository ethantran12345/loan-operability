import { describe, expect, it } from 'vitest'
import { evaluate } from '@/domain/evaluate'
import { TRANSACTION_TIME, agreement, cachedExtraction, capabilityGraph } from '@/domain/fixtures'
import { humanize } from '../format'
import { countDecisions, fieldRows, firstBlockingField, leafCount, modelCallText, recordLines, shortDate } from '../runFormat'

const clause = cachedExtraction('credit-agreement-2.03-a')
const report = evaluate([clause], capabilityGraph, TRANSACTION_TIME, agreement.agreement_version)
const result = report.clause_results[0]!.requirement_results[0]!

describe('fieldRows', () => {
  it('lands the nine fields in the order the process view promises', () => {
    expect(fieldRows(clause.requirements[0]!).map((r) => r.key)).toEqual([
      'operation', 'currency', 'amount', 'timing.settlement', 'timing.notice_cutoff',
      'timing.timezone', 'booking_entity', 'notice_channel', 'required_fields',
    ])
  })

  it('never fills in what the clause did not state', () => {
    const rows = Object.fromEntries(fieldRows(clause.requirements[0]!).map((r) => [r.key, r.value]))
    expect(rows['timing.timezone']).toBeNull()
    expect(rows.notice_channel).toBeNull()
    expect(rows.required_fields).toBeNull()
    expect(rows.amount).toBe('up to EUR 40,000,000')
  })
})

describe('recordLines', () => {
  it('is the replay record itself: only whitespace differs from JSON.stringify', () => {
    const lines = recordLines(report.replay)
    expect(JSON.parse(lines.join('\n'))).toEqual(report.replay)
    expect(lines).toHaveLength(Object.keys(report.replay).length + 2)
  })
})

describe('the path search counters', () => {
  it('count the real candidate paths and name each first failing field', () => {
    const counts = countDecisions(result.candidate_paths)
    expect(counts.PASS + counts.MANUAL + counts.FAIL).toBe(result.candidate_paths.length)
    for (const path of result.candidate_paths) {
      const field = firstBlockingField(path)
      if (path.decision === 'PASS') expect(field).toBeNull()
      else expect(path.checks.find((k) => k.verdict === path.decision)?.field ?? 'incomplete').toBe(field)
    }
  })
})

describe('firstBlockingField', () => {
  it('tags a FAIL path with its first FAIL, not an earlier MANUAL', () => {
    const decisive = result.candidate_paths.find((p) => p.path_id === result.selected_path_id)!
    expect(decisive.checks[0]!.verdict).toBe('MANUAL')
    expect(firstBlockingField(decisive)).toBe('amount.value')
  })
})

describe('leafCount', () => {
  it('counts every primitive, nulls included', () => {
    expect(leafCount({ a: 1, b: null, c: { d: 'x', e: [1, 2] } })).toBe(5)
  })
})

describe('modelCallText', () => {
  const diagnostics = { attempts: 1, calls: 1, upstream_ms: 5413, rejection: null }

  it('shows only the time the server measured for a live call', () => {
    expect(modelCallText({ clause: { ...clause, extraction_source: 'nemotron' }, fallback_reason: null, diagnostics })).toBe('5.4 s')
  })

  it('never reports a model time for a cached fixture', () => {
    expect(modelCallText({ clause, fallback_reason: 'timeout', diagnostics: { ...diagnostics, upstream_ms: 25010 } })).toBe(
      'no usable answer in 25.0 s · cached fixture shown',
    )
    expect(modelCallText({ clause, fallback_reason: 'api_unreachable' })).toBe('none made · cached fixture shown')
    expect(modelCallText(null)).toBe('not made yet')
  })
})

describe('copy helpers', () => {
  it('writes a registry date the way the header shows it, and leaves anything else alone', () => {
    expect(shortDate('2026-09-09')).toBe('9 Sep 2026')
    expect(shortDate('baseline')).toBe('baseline')
  })

  it('keeps the capitals of a place when it humanizes an id', () => {
    expect(humanize('new_york')).toBe('New York')
    expect(humanize('any_lending_office')).toBe('Any lending office')
  })
})
