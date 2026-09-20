import { afterEach, describe, expect, it, vi } from 'vitest'
import { agreement } from '@/domain/fixtures'
import { readPacket } from '@/documents/packet'
import { requestExtraction, sourceDetail } from '../extractClient'

const unreachable = () => vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
afterEach(() => vi.unstubAllGlobals())

describe('a cached extraction is only ever vouched for against the text it was recorded from', () => {
  it('the sample agreement: every cached fixture matches its clause, word for word', async () => {
    unreachable()
    for (const clause of readPacket(7).clauses) {
      const e = await requestExtraction(clause, new AbortController().signal)
      expect(e.clause.extraction_source).toBe('fixture')
      expect(e.other_text).toBeUndefined()
    }
    expect(readPacket(7).clauses).toHaveLength(agreement.clauses.length)
  })

  it('an agreement that reads differently: the cache is served, and called what it is', async () => {
    unreachable()
    const clause = readPacket(7).clauses[0]!
    const e = await requestExtraction({ ...clause, source_text: `${clause.source_text} As amended.` }, new AbortController().signal)
    expect(e.other_text).toBe(true)
    expect(sourceDetail(e)).toContain('do not describe this file')
  })
})
