import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../../../api/extract'
import { agreement, cachedExtraction } from '@/domain/fixtures'
import { ExtractedClauseSchema, type ExtractRequest } from '@/domain/schema'
import extractionsJson from '@/fixtures/extractions.json'
import { DEFAULT_MODEL, NVIDIA_CHAT_URL, extractClause, timezoneIsStated } from '../extract'

const failClause = agreement.clauses[0]!
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
    expect(out.fallback_reason).toBe('invalid_output')
    expect(out.clause.requirements[0]!.timing!.timezone).toBeNull()
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
    const parsed = ExtractedClauseSchema.strict().safeParse(await res.json())
    expect(parsed.success).toBe(true)
    expect(parsed.data!.extraction_source).toBe('nemotron')
  })

  it('rejects a malformed request with 400 rather than guessing', async () => {
    expect((await post('not json')).status).toBe(400)
    expect((await post({ clause_id: failClause.clause_id })).status).toBe(400)
  })
})
