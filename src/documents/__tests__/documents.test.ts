import { describe, expect, it } from 'vitest'
import { evaluate } from '../../domain/evaluate'
import { TRANSACTION_TIME, agreement, cachedExtraction, capabilityGraphs } from '../../domain/fixtures'
import type { CapabilityGraph } from '../../domain/types'
import { buildComparisonPacket, COMPARISON_QUESTION } from '../bundle'
import { clock12, evidenceForCheck, longDate, verifyCitations } from '../citations'
import { locateTerm, supportedElsewhere } from '../locate'
import { readPacket } from '../packet'
import { PacketFormatError, findParagraph, parseDocument } from '../parse'

const SAMPLE = `---
document_id: T-1
title: Test
kind: policy
version: 1
dated: 2026-01-01
notice: synthetic
---

<!-- page 1 -->

# Part One

## 1 First section

Plain paragraph one.

(a) Labelled paragraph.

<!-- page 2 -->

## 2.01 Second section

Another paragraph.
`

describe('parseDocument', () => {
  const doc = parseDocument(SAMPLE, 'sample.md')

  it('reads front matter, sections, pages and paragraph references', () => {
    expect(doc.meta).toMatchObject({ document_id: 'T-1', version: '1', kind: 'policy', dated: '2026-01-01' })
    expect(doc.pages).toBe(2)
    expect(doc.sections.map((s) => [s.id, s.title, s.page, s.article])).toEqual([
      ['1', 'First section', 1, 'Part One'],
      ['2.01', 'Second section', 2, 'Part One'],
    ])
    expect(doc.sections[0]!.paragraphs.map((p) => p.ref)).toEqual(['1 ¶1', '1(a)'])
    expect(findParagraph(doc, '1(a)')!.text).toBe('Labelled paragraph.')
  })

  it('keeps exact text at exact offsets, and hashes the raw file', () => {
    for (const s of doc.sections) for (const p of s.paragraphs) expect(doc.raw.slice(p.start, p.end)).toBe(p.text)
    expect(doc.sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(parseDocument(SAMPLE.replace('one.', 'two.')).sha256).not.toBe(doc.sha256)
  })

  it('refuses what it cannot read instead of guessing', () => {
    expect(() => parseDocument('%PDF-1.7 ...', 'scan.pdf')).toThrow(/PDF, DOCX/)
    expect(() => parseDocument('PK\u0003\u0004', 'a.docx')).toThrow(PacketFormatError)
    expect(() => parseDocument('no front matter')).toThrow(/front matter/)
    expect(() => parseDocument(SAMPLE.replace('version: 1\n', ''))).toThrow(/version/)
    expect(() => parseDocument(SAMPLE.replace('## 1 First section\n\n', ''))).toThrow(/before any/)
  })
})

describe('the synthetic packet', () => {
  it('reads one agreement and four policies per registry version, with exact offsets', () => {
    for (const v of [7, 8]) {
      const packet = readPacket(v)
      expect(packet.documents).toHaveLength(5)
      expect(packet.agreement.meta.kind).toBe('agreement')
      for (const d of packet.documents) {
        for (const s of d.sections) for (const p of s.paragraphs) expect(d.raw.slice(p.start, p.end)).toBe(p.text)
      }
    }
  })

  it('takes clause text from the document, and it is the text the cached extractions were recorded on', () => {
    const packet = readPacket(7)
    expect(packet.clauses).toHaveLength(agreement.clauses.length)
    for (const c of packet.clauses) {
      expect(packet.agreement.raw.slice(c.start, c.end)).toBe(c.source_text)
      expect(c.source_text).toBe(cachedExtraction(c.clause_id).source_text)
      const configured = agreement.clauses.find((x) => x.clause_id === c.clause_id)!
      expect(c.source_text).toBe(configured.source_text)
      expect(c.source_span).toEqual(configured.source_span)
      expect(cachedExtraction(c.clause_id).source_span).toEqual(c.source_span)
    }
    expect(packet.out_of_scope_sections).toBeGreaterThan(10)
  })

  it('differs between registry versions only in the approvals register', () => {
    const [a, b] = [readPacket(7), readPacket(8)]
    const changed = a.documents.filter((d, i) => d.sha256 !== b.documents[i]!.sha256).map((d) => d.meta.document_id)
    expect(changed).toEqual(['MCB-POL-007'])
    expect(b.policies.find((d) => d.meta.document_id === 'MCB-POL-007')!.meta.version).toBe('4')
  })

  it('never states a timezone rule that would silently settle 2.03(a)', () => {
    const packet = readPacket(7)
    expect(packet.agreement.raw).not.toMatch(/time of day|times? (?:are|is) to|references to (?:a )?time/i)
  })
})

describe('verifyCitations', () => {
  it('verifies every borrowing, booking and approval record against its cited passage, on both versions', () => {
    for (const v of [7, 8]) {
      const index = verifyCitations(capabilityGraphs[v]!, readPacket(v).policies)
      expect(index.mismatched).toBe(0)
      const unresolved = Object.values(index.records).filter((r) => r.status === 'not_in_packet').map((r) => r.record_id)
      // Interest and fee engines cite procedures that are not part of this packet.
      expect(unresolved.sort()).toEqual(['cap-014', 'cap-015', 'cap-022', 'cap-023'])
      expect(index.verified).toBe(16)
    }
  })

  it('cites exact spans of the policy text', () => {
    const packet = readPacket(7)
    const index = verifyCitations(capabilityGraphs[7]!, packet.policies)
    const eur = index.records['cap-010']!
    expect(eur.document_id).toBe('MCB-OPS-204')
    expect(eur.section?.title).toBe('EUR funding')
    const funding = packet.policies.find((d) => d.meta.document_id === 'MCB-OPS-204')!
    const max = eur.fields.find((f) => f.field === 'max_amount')!
    expect(max.spans.map((s) => s.text)).toEqual(['EUR 25,000,000'])
    for (const f of eur.fields) for (const s of f.spans) expect(funding.raw.slice(s.start, s.end)).toBe(s.text)
  })

  it('reports a mismatch when the registry and the policy disagree', () => {
    const graph = structuredClone(capabilityGraphs[7]!) as CapabilityGraph
    graph.capabilities.find((c) => c.capability_id === 'cap-010')!.constraints.max_amount = 30_000_000
    const index = verifyCitations(graph, readPacket(7).policies)
    expect(index.records['cap-010']!.status).toBe('mismatch')
    expect(index.records['cap-010']!.fields.find((f) => f.field === 'max_amount')!.verified).toBe(false)
    expect(index.mismatched).toBe(1)
  })

  it('does not accept a number that is part of a longer number', () => {
    const graph = structuredClone(capabilityGraphs[7]!) as CapabilityGraph
    // "5,000,000" is a suffix of the policy's "25,000,000" and must not match.
    graph.capabilities.find((c) => c.capability_id === 'cap-010')!.constraints.max_amount = 5_000_000
    expect(verifyCitations(graph, readPacket(7).policies).records['cap-010']!.status).toBe('mismatch')
  })

  it('follows the approvals register across versions: the v7 registry is not supported by the v8 register', () => {
    const v7OnV8 = verifyCitations(capabilityGraphs[7]!, readPacket(8).policies)
    expect(v7OnV8.records['apr-021']!.status).toBe('mismatch')
    const v8 = verifyCitations(capabilityGraphs[8]!, readPacket(8).policies)
    expect(v8.records['apr-021']!.fields.map((f) => f.spans[0]?.text)).toEqual(['25,000,000', '15 September 2026', 'No expiry date'])
  })

  it('renders registry values the way a procedure writes them', () => {
    expect(clock12('09:30')).toBe('9:30 A.M.')
    expect(clock12('16:00')).toBe('4:00 P.M.')
    expect(clock12('12:05')).toBe('12:05 P.M.')
    expect(longDate('2026-08-31')).toBe('31 August 2026')
  })
})

describe('evidence for findings', () => {
  const run = (clauseId: string, v: number) => {
    const packet = readPacket(v)
    const graph = capabilityGraphs[v]!
    const report = evaluate([cachedExtraction(clauseId)], graph, TRANSACTION_TIME, agreement.agreement_version)
    const result = report.clause_results[0]!.requirement_results[0]!
    const decisive = result.candidate_paths.find((p) => p.path_id === result.selected_path_id)!
    return { packet, graph, report, result, decisive, index: verifyCitations(graph, packet.policies) }
  }

  it('links the EUR 40M conflict to the agreement words and to the policy words', () => {
    const { packet, graph, decisive, index } = run('credit-agreement-2.03-a', 7)
    const clause = packet.clauses.find((c) => c.clause_id === 'credit-agreement-2.03-a')!
    const amount = decisive.checks.find((k) => k.field === 'amount.value')!
    expect(amount.verdict).toBe('FAIL')
    const term = locateTerm(clause.source_text, clause.start, amount.field)!
    expect(term.text).toBe('EUR 40,000,000')
    expect(packet.agreement.raw.slice(term.start, term.end)).toBe('EUR 40,000,000')
    const [passage] = evidenceForCheck(amount, index, graph)
    expect(passage!.document_id).toBe('MCB-OPS-204')
    expect(passage!.verified).toBe(true)
    expect(passage!.highlights.map((h) => h.text)).toEqual(['EUR 25,000,000'])
  })

  it('reports an unstated term as not located rather than inventing a span', () => {
    const { packet } = run('credit-agreement-2.03-a', 7)
    const clause = packet.clauses.find((c) => c.clause_id === 'credit-agreement-2.03-a')!
    expect(locateTerm(clause.source_text, clause.start, 'notice_channel')).toBeNull()
    expect(locateTerm(clause.source_text, clause.start, 'required_fields')).toBeNull()
    expect(locateTerm(clause.source_text, clause.start, 'timing.notice_cutoff')!.text).toBe('11:00 A.M.')
  })

  it('cites the procedure and then the register for the expired Treasury authority', () => {
    const v7 = run('credit-agreement-2.03-c', 7)
    const approval = v7.decisive.checks.find((k) => k.field === 'approval')!
    expect(approval.verdict).toBe('FAIL')
    const passages = evidenceForCheck(approval, v7.index, v7.graph)
    expect(passages.map((p) => [p.document_id, p.document_version, p.record_id])).toEqual([
      ['MCB-OPS-204', '5.1', 'cap-013'],
      ['MCB-POL-007', '3', 'apr-021'],
    ])
    expect(passages[1]!.highlights.map((h) => h.text)).toContain('31 August 2026')

    const v8 = run('credit-agreement-2.03-c', 8)
    expect(v8.report.decision).toBe('MANUAL')
    const renewed = evidenceForCheck(v8.decisive.checks.find((k) => k.field === 'approval')!, v8.index, v8.graph)
    expect(renewed[1]!.document_version).toBe('4')
    expect(renewed[1]!.highlights.map((h) => h.text)).toContain('15 September 2026')
  })

  it('finds terms another capability accepts alone, and says what that capability rejects', () => {
    const { result, graph } = run('credit-agreement-2.03-a', 7)
    const req = cachedExtraction('credit-agreement-2.03-a').requirements[0]!
    const elsewhere = supportedElsewhere(req, result, graph, TRANSACTION_TIME)
    const amount = elsewhere.find((e) => e.field === 'amount.value')!
    expect(amount.required).toBe('EUR 40,000,000')
    // The T+1 window takes EUR 40M, but it is not same-day. The USD window is never offered.
    expect(amount.capability_id).toBe('cap-012')
    expect(amount.blocked_by.map((b) => b.field)).toEqual(['timing.settlement', 'timing.notice_lead'])
    expect(elsewhere.map((e) => e.capability_id)).not.toContain('cap-009')
    // "Any lending office" is accepted by no booking entity, so it is not listed.
    expect(elsewhere.find((e) => e.field === 'booking_entity')).toBeUndefined()
    const pass = run('credit-agreement-2.03-b', 7)
    expect(supportedElsewhere(cachedExtraction('credit-agreement-2.03-b').requirements[0]!, pass.result, pass.graph, TRANSACTION_TIME)).toEqual([])
  })
})

describe('comparison packet', () => {
  it('carries every document, the registry and the question, and no verdict', () => {
    const packet = readPacket(7)
    const text = buildComparisonPacket(packet, capabilityGraphs[7]!, TRANSACTION_TIME)
    expect(text.startsWith(COMPARISON_QUESTION)).toBe(true)
    for (const d of packet.documents) expect(text).toContain(d.raw.trim())
    expect(text).toContain(JSON.stringify(capabilityGraphs[7], null, 2))
    expect(text).toContain('22 September 2026')
    expect(text).not.toMatch(/\b(PASS|FAIL|MANUAL)\b/)
  })
})
