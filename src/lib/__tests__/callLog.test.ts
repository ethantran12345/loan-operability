import { afterEach, describe, expect, it, vi } from 'vitest'
import { cachedExtraction } from '@/domain/fixtures'
import { readPacket } from '@/documents/packet'
import { callLog, callLogEntry } from '../callLog'
import { requestExtraction, type Extraction } from '../extractClient'

const clause = readPacket(7).clauses[0]!
const cached = cachedExtraction(clause.clause_id)
const diagnostics = { attempts: 1, calls: 1, upstream_ms: 2400, rejection: null }

afterEach(() => vi.unstubAllGlobals())

describe('the Nemotron call log only ever shows a call that happened', () => {
  it('a live reply: the model id as asked, what was sent, what came back, what the server measured', () => {
    const live: Extraction = {
      clause: { ...cached, extraction_source: 'nemotron', model: 'nvidia/some-model:as-asked' },
      fallback_reason: null,
      diagnostics: { ...diagnostics, attempts: 2, calls: 3, rejection: 'The clause text never names a timezone' },
    }
    const e = callLogEntry({ clause, extraction: live })
    expect(e.call).toBe('answered')
    expect(e.model).toBe('nvidia/some-model:as-asked')
    expect(e.sent).toEqual({ clause_id: clause.clause_id, section: clause.source_span.section, chars: clause.source_text.length })
    expect(e.terms).toEqual({
      requirements: cached.requirements.length,
      confidence: cached.requirements.map((r) => r.confidence),
      ambiguities: cached.requirements.reduce((n, r) => n + r.ambiguities.length, 0),
      extraction_source: 'nemotron',
    })
    expect(e.measured).toEqual({ upstream_ms: 2400, attempts: 2, calls: 3, rejection: 'The clause text never names a timezone' })
    expect(e.recorded_from).toBeNull()
  })

  it('no key: cached, and no call, no model, nothing sent, nothing measured', () => {
    const e = callLogEntry({
      clause,
      extraction: { clause: { ...cached, extraction_source: 'fixture' }, fallback_reason: 'no_api_key', diagnostics: { attempts: 0, calls: 0, upstream_ms: 0, rejection: null } },
    })
    expect(e.call).toBe('none')
    expect([e.model, e.sent, e.measured]).toEqual([null, null, null])
    expect(e.terms.extraction_source).toBe('fixture')
  })

  it('/api/extract unreachable: the bundled fixture is logged as cached with no call', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    const extraction = await requestExtraction(clause, new AbortController().signal)
    const e = callLogEntry({ clause, extraction })
    expect(e.call).toBe('none')
    expect([e.model, e.sent, e.measured]).toEqual([null, null, null])
    expect(e.fallback_reason).toBe('api_unreachable')
    expect(e.asked?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('a call that came back unusable: logged as made, never as live, and the cached model is not passed off as the one asked', () => {
    const e = callLogEntry({
      clause,
      extraction: { clause: { ...cached, extraction_source: 'fixture', model: 'recorded/model' }, fallback_reason: 'http_429', diagnostics },
    })
    expect(e.call).toBe('unused')
    expect(e.model).toBeNull()
    expect(e.recorded_from).toBe('recorded/model')
    expect(e.sent?.chars).toBe(clause.source_text.length)
    expect(e.measured?.upstream_ms).toBe(2400)
    expect(e.terms.extraction_source).toBe('fixture')
  })

  it('is in the order the clauses were asked for, and leaves out a clause with no answer yet', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    const [a, b, c] = readPacket(7).clauses
    const signal = new AbortController().signal
    const second = await requestExtraction(b!, signal)
    const first = await requestExtraction(a!, signal)
    const log = callLog([
      { clause: a!, extraction: first },
      { clause: b!, extraction: second },
      { clause: c!, extraction: null },
    ])
    expect(log.map((e) => e.clause_id)).toEqual([b!.clause_id, a!.clause_id])
  })
})
