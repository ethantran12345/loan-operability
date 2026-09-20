import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readPacket } from '@/documents/packet'

// extractClient keeps its turn-taking per page load, so each test loads it fresh.
const load = () => import('../extractClient')

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** A fetch that never reaches the API, and records when each request left. */
function recordingFetch() {
  const left: number[] = []
  vi.stubGlobal('fetch', vi.fn(() => {
    left.push(performance.now())
    return Promise.reject(new Error('offline'))
  }))
  return left
}

describe('requests to /api/extract leave one at a time', () => {
  it('a run asks for every clause at once, and the requests leave 1.5 s apart', async () => {
    const { extractionFor, askedAtFor, REQUEST_SPACING_MS } = await load()
    const left = recordingFetch()
    const clauses = readPacket(7).clauses
    const started = performance.now()
    const all = Promise.all(clauses.map((c) => extractionFor(c)))

    expect(REQUEST_SPACING_MS).toBe(1_500)
    // The first request does not wait for anything.
    expect(left).toEqual([started])
    await vi.advanceTimersByTimeAsync(REQUEST_SPACING_MS * clauses.length)
    expect(left).toEqual(clauses.map((_, i) => started + i * REQUEST_SPACING_MS))
    // The time a card counts its wait from is the time its request really left.
    expect(clauses.map(askedAtFor)).toEqual(left)

    const results = await all
    // Order asked is order left, and a clause that waited its turn is labelled like any other.
    expect(results.map((e) => e.asked!.seq)).toEqual(clauses.map((_, i) => i + 1))
    expect(results.every((e) => e.clause.extraction_source === 'fixture' && e.fallback_reason === 'api_unreachable')).toBe(true)
  })

  it('a remembered result is handed back without taking a turn', async () => {
    const { extractionFor } = await load()
    const left = recordingFetch()
    const [first, second] = readPacket(7).clauses
    const once = extractionFor(first!)
    expect(extractionFor(first!)).toBe(once)
    await once
    // Nothing queued behind the remembered clause: the next new request is one spacing after the first, not two.
    void extractionFor(second!)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(left).toHaveLength(2)
    expect(left[1]! - left[0]!).toBe(1_500)
  })

  it('Try live again takes a turn too, and leaves at once when nothing left recently', async () => {
    const { extractionFor } = await load()
    const left = recordingFetch()
    const clause = readPacket(7).clauses[0]!
    await extractionFor(clause)
    await vi.advanceTimersByTimeAsync(10_000)
    const again = performance.now()
    await extractionFor(clause, true)
    expect(left).toEqual([left[0], again])
  })

  it('the time limit is the same 35 s, counted from when the request leaves', async () => {
    const { extractionFor } = await load()
    recordingFetch()
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const clauses = readPacket(7).clauses
    const all = Promise.all(clauses.map((c) => extractionFor(c)))
    expect(timeout).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_500 * clauses.length)
    await all
    expect(timeout.mock.calls).toEqual(clauses.map(() => [35_000]))
  })
})
