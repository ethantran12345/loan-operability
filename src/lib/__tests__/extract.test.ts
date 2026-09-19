import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../../../api/extract'
import { evaluate } from '@/domain/evaluate'
import { TRANSACTION_TIME, agreement, cachedExtraction, capabilityGraph } from '@/domain/fixtures'
import { ExtractedClauseSchema, type ExtractRequest } from '@/domain/schema'
import extractionsJson from '@/fixtures/extractions.json'
import {
  DEFAULT_MODEL,
  NVIDIA_CHAT_URL,
  bankFieldFor,
  extractClause,
  noticeContentsAreStated,
  timezoneIsStated,
} from '../extract'

const failClause = agreement.clauses[0]!
const manualClause = agreement.clauses[1]!
const passClause = agreement.clauses[2]!

const requestFor = (c: (typeof agreement.clauses)[number]): ExtractRequest => ({
  clause_id: c.clause_id,
  clause_type: c.clause_type,
  source_text: c.source_text,
  source_span: c.source_span,
})

/** A chat-completions response whose message content is `content`. */
const completion = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** What a well-behaved model returns for a clause: the cached requirements. */
const goodReply = (clauseId: string) =>
  JSON.stringify({ requirements: cachedExtraction(clauseId).requirements })

const mockFetch = (...responses: (Response | Error)[]) => {
  const fn = vi.fn<typeof fetch>()
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r)
    else fn.mockResolvedValueOnce(r)
  }
  return fn
}

const bodyOf = (fn: ReturnType<typeof mockFetch>, call: number) =>
  JSON.parse(fn.mock.calls[call]![1]!.body as string) as {
    model: string
    temperature: number
    chat_template_kwargs: { enable_thinking: boolean }
    messages: { role: string; content: string }[]
  }

describe('schema', () => {
  it('accepts every cached extraction, so the fixture and the live path share one shape', () => {
    const { note: _note, ...clauses } = extractionsJson as Record<string, unknown>
    expect(Object.keys(clauses)).toHaveLength(3)
    for (const clause of Object.values(clauses)) {
      expect(ExtractedClauseSchema.safeParse(clause).success).toBe(true)
    }
  })

  it('rejects a cutoff that is not 24-hour HH:MM', () => {
    const clause = cachedExtraction(failClause.clause_id)
    clause.requirements[0]!.timing!.notice_cutoff = '11:00 AM'
    expect(ExtractedClauseSchema.safeParse(clause).success).toBe(false)
  })
})

describe('extractClause', () => {
  it('good JSON: serves the live result and labels it nemotron', async () => {
    const fetch = mockFetch(completion(goodReply(passClause.clause_id)))
    const out = await extractClause(requestFor(passClause), { apiKey: 'test-key', fetch })

    expect(out.fallback_reason).toBeNull()
    expect(out.attempts).toBe(1)
    expect(out.clause.extraction_source).toBe('nemotron')
    expect(out.clause.model).toBe(DEFAULT_MODEL)
    expect(out.clause.requirements).toEqual(cachedExtraction(passClause.clause_id).requirements)
    expect(ExtractedClauseSchema.safeParse(out.clause).success).toBe(true)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![0]).toBe(NVIDIA_CHAT_URL)
    const headers = fetch.mock.calls[0]![1]!.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer test-key')
    expect(bodyOf(fetch, 0).temperature).toBe(0)
    expect(bodyOf(fetch, 0).chat_template_kwargs).toEqual({ enable_thinking: false })
  })

  it('takes clause identity and text from the request, never from the model', async () => {
    const reply = JSON.stringify({
      clause_id: 'something-else',
      source_text: 'A rewritten sentence.',
      requirements: cachedExtraction(passClause.clause_id).requirements,
    })
    const out = await extractClause(requestFor(passClause), {
      apiKey: 'test-key',
      fetch: mockFetch(completion(reply)),
    })
    expect(out.clause.clause_id).toBe(passClause.clause_id)
    expect(out.clause.source_text).toBe(passClause.source_text)
  })

  it('tolerates a code fence and a think block around the JSON', async () => {
    const reply = `<think>working</think>\n\`\`\`json\n${goodReply(passClause.clause_id)}\n\`\`\``
    const out = await extractClause(requestFor(passClause), {
      apiKey: 'test-key',
      fetch: mockFetch(completion(reply)),
    })
    expect(out.clause.extraction_source).toBe('nemotron')
  })

  it('malformed then good: retries once with the validation error fed back', async () => {
    const fetch = mockFetch(
      completion('Sure! Here is the extraction you asked for.'),
      completion(goodReply(passClause.clause_id)),
    )
    const out = await extractClause(requestFor(passClause), { apiKey: 'test-key', fetch })

    expect(out.clause.extraction_source).toBe('nemotron')
    expect(out.attempts).toBe(2)
    expect(fetch).toHaveBeenCalledTimes(2)

    const retry = bodyOf(fetch, 1).messages
    expect(retry.at(-2)).toEqual({
      role: 'assistant',
      content: 'Sure! Here is the extraction you asked for.',
    })
    expect(retry.at(-1)!.role).toBe('user')
    expect(retry.at(-1)!.content).toContain('not valid JSON')
  })

  it('schema-invalid then good: the Zod issue path reaches the retry prompt', async () => {
    const bad = cachedExtraction(passClause.clause_id).requirements
    ;(bad[0] as { operation: string }).operation = 'wire_money'
    const fetch = mockFetch(
      completion(JSON.stringify({ requirements: bad })),
      completion(goodReply(passClause.clause_id)),
    )
    const out = await extractClause(requestFor(passClause), { apiKey: 'test-key', fetch })

    expect(out.clause.extraction_source).toBe('nemotron')
    expect(bodyOf(fetch, 1).messages.at(-1)!.content).toContain('requirements.0.operation')
  })

  it('malformed twice: serves the cached fixture and stops calling the model', async () => {
    const fetch = mockFetch(completion('not json'), completion('{"requirements": []}'))
    const out = await extractClause(requestFor(failClause), { apiKey: 'test-key', fetch })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(out.fallback_reason).toBe('invalid_output')
    expect(out.clause).toEqual(cachedExtraction(failClause.clause_id))
    expect(out.clause.extraction_source).toBe('fixture')
  })

  it('non-200: serves the fixture without a retry', async () => {
    const fetch = mockFetch(completion('unauthorized', 401))
    const out = await extractClause(requestFor(failClause), { apiKey: 'bad-key', fetch })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(out.fallback_reason).toBe('http_401')
    expect(out.clause.extraction_source).toBe('fixture')
  })

  it('network error: serves the fixture', async () => {
    const fetch = mockFetch(new TypeError('fetch failed'))
    const out = await extractClause(requestFor(failClause), { apiKey: 'test-key', fetch })

    expect(out.fallback_reason).toBe('network_error')
    expect(out.clause.extraction_source).toBe('fixture')
  })

  it('no API key: serves the fixture and never touches the network', async () => {
    const fetch = mockFetch()
    const out = await extractClause(requestFor(failClause), { apiKey: undefined, fetch })

    expect(fetch).not.toHaveBeenCalled()
    expect(out.fallback_reason).toBe('no_api_key')
    expect(out.attempts).toBe(0)
    expect(out.clause).toEqual(cachedExtraction(failClause.clause_id))
  })

  it('a guessed timezone is rejected, not passed to the evaluator', async () => {
    // The 2.03(a) clause says "11:00 A.M." and names no zone. A model that fills
    // in London has guessed, and the guess would erase the headline finding.
    const guessed = cachedExtraction(failClause.clause_id).requirements
    guessed[0]!.timing!.timezone = 'Europe/London'
    const fetch = mockFetch(
      completion(JSON.stringify({ requirements: guessed })),
      completion(JSON.stringify({ requirements: guessed })),
    )
    const out = await extractClause(requestFor(failClause), { apiKey: 'test-key', fetch })

    expect(bodyOf(fetch, 1).messages.at(-1)!.content).toContain('never names a timezone')
    expect(bodyOf(fetch, 1).messages.at(-1)!.content).toContain('timing.timezone "Europe/London"')
    expect(out.fallback_reason).toBe('invalid_output')
    expect(out.rejections).toHaveLength(2)
    expect(out.clause.extraction_source).toBe('fixture')
    expect(out.clause.requirements[0]!.timing!.timezone).toBeNull()
  })

  it('the evaluator never sees the guessed timezone: 2.03(a) stays a FAIL on every reading', async () => {
    const guessed = cachedExtraction(failClause.clause_id).requirements
    guessed[0]!.timing!.timezone = 'America/New_York'
    const reply = completion(JSON.stringify({ requirements: guessed }))
    const out = await extractClause(requestFor(failClause), {
      apiKey: 'test-key',
      fetch: mockFetch(reply.clone(), reply.clone()),
    })

    const report = evaluate([out.clause], capabilityGraph, TRANSACTION_TIME, agreement.agreement_version)
    expect(JSON.stringify(out.clause)).not.toContain('America/New_York')
    expect(report.decision).toBe('FAIL')
    const conflicts = report.clause_results[0]!.requirement_results[0]!.conflicts.map((c) => c.field)
    expect(conflicts).toEqual(['amount.value', 'timing.notice_cutoff', 'booking_entity'])
  })

  it('a missing timezone left out of the ambiguities is sent back, not silently accepted', async () => {
    const silent = cachedExtraction(failClause.clause_id).requirements
    silent[0]!.ambiguities = ['Notice channel not specified in clause']
    const fetch = mockFetch(
      completion(JSON.stringify({ requirements: silent })),
      completion(goodReply(failClause.clause_id)),
    )
    const out = await extractClause(requestFor(failClause), { apiKey: 'test-key', fetch })

    expect(bodyOf(fetch, 1).messages.at(-1)!.content).toContain('notice_cutoff "11:00" has timezone null')
    expect(out.clause.extraction_source).toBe('nemotron')
    expect(out.clause.requirements[0]!.ambiguities.join(' ')).toMatch(/time ?zone/i)
  })

  it('a guessed timezone corrected on the retry is accepted as live output', async () => {
    const guessed = cachedExtraction(failClause.clause_id).requirements
    guessed[0]!.timing!.timezone = 'Europe/London'
    const fetch = mockFetch(
      completion(JSON.stringify({ requirements: guessed })),
      completion(goodReply(failClause.clause_id)),
    )
    const out = await extractClause(requestFor(failClause), { apiKey: 'test-key', fetch })

    expect(out.clause.extraction_source).toBe('nemotron')
    expect(out.attempts).toBe(2)
    expect(out.clause.requirements[0]!.timing!.timezone).toBeNull()
  })

  it('invented notice fields are rejected: an unknown must not become a PASS', async () => {
    // 2.03(a) never says what a Borrowing Notice must specify. A model that lists
    // the customary fields would erase a MANUAL gap the evaluator has to report.
    const invented = cachedExtraction(failClause.clause_id).requirements
    invented[0]!.required_fields = ['facility_id', 'amount', 'currency', 'value_date']
    const reply = completion(JSON.stringify({ requirements: invented }))
    const fetch = mockFetch(reply.clone(), reply.clone())
    const out = await extractClause(requestFor(failClause), { apiKey: 'test-key', fetch })

    expect(bodyOf(fetch, 1).messages.at(-1)!.content).toContain('never says what a notice must specify')
    expect(out.fallback_reason).toBe('invalid_output')
    expect(out.clause.requirements[0]!.required_fields).toBeNull()
  })

  it('stated notice fields are accepted', async () => {
    for (const clause of [manualClause, passClause]) {
      const out = await extractClause(requestFor(clause), {
        apiKey: 'test-key',
        fetch: mockFetch(completion(goodReply(clause.clause_id))),
      })
      expect(out.clause.extraction_source).toBe('nemotron')
      expect(out.clause.requirements[0]!.required_fields).toEqual([
        'facility_id',
        'amount',
        'currency',
        'value_date',
      ])
    }
  })
})

describe('hollow requirements', () => {
  it('a requirement that states nothing is rejected rather than evaluated', async () => {
    const hollow = {
      requirement_id: 'req-002',
      operation: 'fund_draw',
      currency: null,
      amount: null,
      timing: {
        settlement: 'unspecified',
        notice_cutoff: null,
        timezone: null,
        notice_lead_business_days: null,
        service_level_business_days: null,
      },
      booking_entity: null,
      notice_channel: null,
      required_fields: null,
      interest: null,
      fee: null,
      mandatory: false,
      confidence: 0,
      ambiguities: [],
    }
    const fetch = mockFetch(
      completion(JSON.stringify({ requirements: [hollow] })),
      completion(goodReply(manualClause.clause_id)),
    )
    const out = await extractClause(requestFor(manualClause), { apiKey: 'test-key', fetch })

    expect(bodyOf(fetch, 1).messages.at(-1)!.content).toContain('state nothing the clause says: req-002')
    expect(out.attempts).toBe(2)
    expect(out.clause.requirements[0]!.notice_channel).toBe('email')
  })
})

describe('notice field names', () => {
  it('a near-miss field name is sent back for correction, not compared as a missing field', async () => {
    const misnamed = cachedExtraction(manualClause.clause_id).requirements
    misnamed[0]!.required_fields = ['facility', 'principal_amount', 'currency', 'requested_value_date']
    const fetch = mockFetch(
      completion(JSON.stringify({ requirements: misnamed })),
      completion(goodReply(manualClause.clause_id)),
    )
    const out = await extractClause(requestFor(manualClause), { apiKey: 'test-key', fetch })

    const feedback = bodyOf(fetch, 1).messages.at(-1)!.content
    expect(feedback).toContain('"facility" must be written "facility_id"')
    expect(feedback).toContain('"principal_amount" must be written "amount"')
    expect(feedback).toContain('"requested_value_date" must be written "value_date"')
    expect(feedback).not.toContain('"currency" must')
    expect(out.clause.extraction_source).toBe('nemotron')
    expect(out.attempts).toBe(2)
  })

  it('leaves the bank\'s own names and genuinely new fields alone', () => {
    expect(bankFieldFor('facility_id')).toBeNull()
    expect(bankFieldFor('interest_period')).toBeNull()
    expect(bankFieldFor('facility')).toBe('facility_id')
  })
})

describe('time budget and hedging', () => {
  afterEach(() => vi.useRealTimers())

  /** A call that never answers, but does honour its abort signal. */
  const stalled = (_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })

  it('a silent endpoint: duplicates are launched, then the fixture is served as a timeout', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn<typeof globalThis.fetch>(stalled)
    const pending = extractClause(requestFor(failClause), {
      apiKey: 'test-key',
      fetch,
      timeoutMs: 20_000,
      hedgeAfterMs: [5_000, 10_000],
    })
    await vi.advanceTimersByTimeAsync(20_000)
    const out = await pending

    expect(out.fallback_reason).toBe('timeout')
    expect(out.calls).toBe(3)
    expect(out.upstream_ms).toBe(20_000)
    expect(out.clause.extraction_source).toBe('fixture')
    for (const call of fetch.mock.calls) expect(call[1]!.signal!.aborted).toBe(true)
  })

  it('a stalled first call: the duplicate answers and is served as live output', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(stalled)
      .mockResolvedValueOnce(completion(goodReply(passClause.clause_id)))
    const pending = extractClause(requestFor(passClause), {
      apiKey: 'test-key',
      fetch,
      hedgeAfterMs: [5_000],
    })
    await vi.advanceTimersByTimeAsync(5_000)
    const out = await pending

    expect(out.clause.extraction_source).toBe('nemotron')
    expect(out.fallback_reason).toBeNull()
    expect(out.attempts).toBe(1)
    expect(out.calls).toBe(2)
    expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true)
  })

  it('a throttled duplicate does not sink a call that is still running', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(completion(goodReply(passClause.clause_id))), 8_000),
          ),
      )
      .mockResolvedValueOnce(completion('slow down', 429))
    const pending = extractClause(requestFor(passClause), {
      apiKey: 'test-key',
      fetch,
      hedgeAfterMs: [5_000],
    })
    await vi.advanceTimersByTimeAsync(8_000)
    const out = await pending

    expect(out.clause.extraction_source).toBe('nemotron')
    expect(out.calls).toBe(2)
  })

  it('a fast reply launches no duplicate', async () => {
    const fetch = mockFetch(completion(goodReply(passClause.clause_id)))
    const out = await extractClause(requestFor(passClause), { apiKey: 'test-key', fetch })
    expect(out.calls).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('noticeContentsAreStated', () => {
  it('is true only for the clauses that say what a notice must specify', () => {
    expect(noticeContentsAreStated(failClause.source_text)).toBe(false)
    expect(noticeContentsAreStated(manualClause.source_text)).toBe(true)
    expect(noticeContentsAreStated(passClause.source_text)).toBe(true)
  })
})

describe('timezoneIsStated', () => {
  it('accepts a zone only when the clause names it', () => {
    expect(timezoneIsStated(passClause.source_text, 'Europe/London')).toBe(true)
    expect(timezoneIsStated(failClause.source_text, 'Europe/London')).toBe(false)
    expect(timezoneIsStated(failClause.source_text, 'America/New_York')).toBe(false)
    expect(timezoneIsStated('by 11:00 a.m. New York City time', 'America/New_York')).toBe(true)
    expect(timezoneIsStated('by 11:00 a.m. EST', 'America/New_York')).toBe(true)
  })
})

describe('POST /api/extract', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const post = (body: unknown) =>
    POST(
      new Request('http://localhost/api/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    )

  it('with NVIDIA_API_KEY unset: 200, the fixture, and the reason in a header', async () => {
    vi.stubEnv('NVIDIA_API_KEY', '')
    const fetch = mockFetch()
    vi.stubGlobal('fetch', fetch)

    const res = await post(requestFor(failClause))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-extraction-source')).toBe('fixture')
    expect(res.headers.get('x-extraction-fallback')).toBe('no_api_key')
    expect(await res.json()).toEqual(cachedExtraction(failClause.clause_id))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('with a key and an upstream 500: still 200 with the fixture', async () => {
    vi.stubEnv('NVIDIA_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockFetch(completion('upstream exploded', 500)))

    const res = await post(requestFor(failClause))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-extraction-fallback')).toBe('http_500')
    expect(((await res.json()) as { extraction_source: string }).extraction_source).toBe('fixture')
  })

  it('with a key and a good reply: the body is exactly an ExtractedClause', async () => {
    vi.stubEnv('NVIDIA_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockFetch(completion(goodReply(passClause.clause_id))))

    const res = await post(requestFor(passClause))
    expect(res.headers.get('x-extraction-fallback')).toBe('none')
    expect(res.headers.get('x-extraction-attempts')).toBe('1')
    expect(res.headers.get('x-extraction-calls')).toBe('1')
    expect(res.headers.get('x-extraction-ms')).toMatch(/^\d+$/)
    const parsed = ExtractedClauseSchema.strict().safeParse(await res.json())
    expect(parsed.success).toBe(true)
    expect(parsed.data!.extraction_source).toBe('nemotron')
  })

  it('rejects a malformed request with 400 rather than guessing', async () => {
    expect((await post('not json')).status).toBe(400)
    expect((await post({ clause_id: failClause.clause_id })).status).toBe(400)
  })
})
