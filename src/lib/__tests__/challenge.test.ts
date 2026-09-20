import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../../../api/challenge'
import { agreement, capabilityGraph, capabilityGraphV8 } from '@/domain/fixtures'
import recordedJson from '@/fixtures/challenge-recorded.json'
import { challengeMessage, runChallenge, type ChallengeRecording } from '../challenge'
import { DEFAULT_MODEL, NVIDIA_CHAT_URL } from '../extract'

const failClause = agreement.clauses[0]!

const completion = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** A stand-in reply for the mocked endpoint. Test-only: nothing like it ships. */
const reply = (verdict: 'PASS' | 'MANUAL' | 'FAIL') =>
  JSON.stringify({
    verdict,
    reasoning: 'stub',
    paths_considered: [{ capability_ids: ['cap-001', 'cap-010', 'cap-025'], verdict, reason: 'stub' }],
  })

/**
 * Runs are parallel, so replies are chosen by conversation, not by call order.
 * Every run opens with the same message: first turns are numbered as they arrive,
 * and a retry is matched to its run by the "#n" tag in the reply it is correcting.
 */
const mockModel = (answer: (run: number, turn: number) => Response | Error) => {
  let runs = 0
  return vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(init!.body as string) as { messages: { content: string }[] }
    const turn = (body.messages.length + 1) / 2
    const run = turn === 1 ? runs++ : Number(/#(\d+)/.exec(body.messages[1]!.content)?.[1])
    const out = answer(run, turn)
    if (out instanceof Error) throw out
    return out
  })
}

const bodyOf = (fn: ReturnType<typeof mockModel>, call: number) =>
  JSON.parse(fn.mock.calls[call]![1]!.body as string) as {
    model: string
    temperature: number
    chat_template_kwargs: { enable_thinking: boolean }
    messages: { role: string; content: string }[]
  }

const input = { clause_id: failClause.clause_id, graph_version: 7, runs: 2 }
const deps = (fetch: typeof globalThis.fetch) => ({ apiKey: 'test-key', fetch, hedgeAfterMs: [], recordings: [] })

describe('runChallenge', () => {
  it('two good runs: both answers, verbatim, from the same question at temperature 0', async () => {
    const fetch = mockModel((run) => completion(reply(run === 0 ? 'FAIL' : 'MANUAL')))
    const { response, calls } = await runChallenge(input, deps(fetch))

    expect(response.source).toBe('live')
    if (response.source !== 'live') return
    expect(response.model).toBe(DEFAULT_MODEL)
    expect(response.answers.map((a) => a.verdict)).toEqual(['FAIL', 'MANUAL'])
    expect(response.raw).toEqual([reply('FAIL'), reply('MANUAL')])
    expect(response.latency_ms).toHaveLength(2)
    expect(calls).toBe(2)

    expect(fetch.mock.calls[0]![0]).toBe(NVIDIA_CHAT_URL)
    for (const call of [0, 1]) {
      const body = bodyOf(fetch, call)
      expect(body.temperature).toBe(0)
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
      expect(body.messages).toHaveLength(1)
      expect(body.messages[0]!.content).toBe(challengeMessage(response.bundle))
    }
  })

  it('the model gets the clause, the transaction time and the whole graph file', async () => {
    const fetch = mockModel(() => completion(reply('FAIL')))
    const { response } = await runChallenge({ ...input, graph_version: 8, runs: 1 }, deps(fetch))
    if (response.source !== 'live') throw new Error('expected a live response')

    expect(response.bundle.capability_graph).toBe(capabilityGraphV8)
    const sent = bodyOf(fetch, 0).messages[0]!.content
    expect(sent).toContain(`CLAUSE:\n${failClause.source_text}`)
    expect(sent).toContain(`CAPABILITY_GRAPH:\n${JSON.stringify(capabilityGraphV8)}`)
    expect(sent).toContain(agreement.transaction_time)
    expect(sent).not.toContain(JSON.stringify(capabilityGraph))
  })

  it('one good run, one unparseable twice: one answer, the other dropped, not faked', async () => {
    const fetch = mockModel((run, turn) =>
      run === 0 ? completion(reply('FAIL')) : completion(turn === 1 ? 'I think it fails. #1' : 'Still prose.'),
    )
    const { response, failures, calls } = await runChallenge(input, deps(fetch))

    if (response.source !== 'live') throw new Error('expected a live response')
    expect(response.answers).toHaveLength(1)
    expect(response.raw).toEqual([reply('FAIL')])
    expect(failures).toEqual(['invalid_output'])
    expect(calls).toBe(3)
  })

  it('a schema-invalid reply is retried once with the Zod issue fed back', async () => {
    const fetch = mockModel((_run, turn) =>
      completion(turn === 1 ? JSON.stringify({ verdict: 'MAYBE', note: '#0' }) : reply('FAIL')),
    )
    const { response } = await runChallenge({ ...input, runs: 1 }, deps(fetch))

    if (response.source !== 'live') throw new Error('expected a live response')
    expect(response.answers).toHaveLength(1)
    const retry = bodyOf(fetch, 1).messages
    expect(retry).toHaveLength(3)
    expect(retry[2]!.content).toMatch(/rejected/)
    expect(retry[2]!.content).toMatch(/verdict/)
  })

  it('both runs fail: unavailable, with the reason and no answer of any kind', async () => {
    const fetch = mockModel(() => completion('', 500))
    const { response } = await runChallenge(input, deps(fetch))
    expect(response).toEqual({ source: 'unavailable', reason: 'http_500' })
  })

  it('no API key: unavailable, and the network is never touched', async () => {
    const fetch = mockModel(() => completion(reply('FAIL')))
    const { response } = await runChallenge(input, { ...deps(fetch), apiKey: undefined })
    expect(response).toEqual({ source: 'unavailable', reason: 'no_api_key' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a silent endpoint: unavailable as a timeout, inside the budget', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted')))),
    )
    const { response } = await runChallenge(input, { ...deps(fetch), timeoutMs: 1_200 })
    expect(response).toEqual({ source: 'unavailable', reason: 'timeout' })
  })

  it('live fails and a recording exists: served as recorded, with its timestamp', async () => {
    const recording: ChallengeRecording = {
      recorded_at: '2026-09-20T14:02:00.000Z',
      model: 'nvidia/some-model',
      clause_id: failClause.clause_id,
      graph_version: 7,
      answers: [{ verdict: 'FAIL', reasoning: 'stub', paths_considered: [], conflicts: [], proposed_fix: [], assumptions: [] }],
      raw: [reply('FAIL')],
      latency_ms: [1234],
    }
    const fetch = mockModel(() => new Error('socket hang up'))
    const { response } = await runChallenge(input, { ...deps(fetch), recordings: [recording] })

    expect(response.source).toBe('recorded')
    if (response.source !== 'recorded') return
    expect(response.recorded_at).toBe('2026-09-20T14:02:00.000Z')
    expect(response.model).toBe('nvidia/some-model')
    expect(response.raw).toEqual(recording.raw)
    expect(response.bundle.clause_id).toBe(failClause.clause_id)
  })

  it('a recording is never served over a live answer, nor for another graph version', async () => {
    const recording = { recorded_at: '2026-09-20T14:02:00.000Z', model: 'm', clause_id: failClause.clause_id, graph_version: 7, answers: [], raw: [], latency_ms: [] }
    const live = await runChallenge(input, { ...deps(mockModel(() => completion(reply('FAIL')))), recordings: [recording] })
    expect(live.response.source).toBe('live')
    const other = await runChallenge({ ...input, graph_version: 8 }, { ...deps(mockModel(() => completion('', 503))), recordings: [recording] })
    expect(other.response.source).toBe('unavailable')
  })
})

describe('the recorded fixture', () => {
  it('holds only entries that say when and from what they were recorded', () => {
    for (const r of (recordedJson as unknown as { recordings: ChallengeRecording[] }).recordings) {
      expect(Number.isNaN(Date.parse(r.recorded_at))).toBe(false)
      expect(r.model).toBeTruthy()
      expect(agreement.clauses.some((c) => c.clause_id === r.clause_id)).toBe(true)
      expect([7, 8]).toContain(r.graph_version)
      expect(r.raw).toHaveLength(r.answers.length)
    }
  })
})

describe('POST /api/challenge', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const post = (body: unknown) =>
    POST(new Request('http://localhost/api/challenge', { method: 'POST', body: JSON.stringify(body) }))

  it('with a key and good replies: 200, live, runs default to 2, and the key is never logged', async () => {
    vi.stubEnv('NVIDIA_API_KEY', 'secret-test-key')
    vi.stubEnv('NEMOTRON_MODEL', '')
    vi.stubGlobal('fetch', mockModel(() => completion(reply('FAIL'))))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const res = await post({ clause_id: failClause.clause_id, graph_version: 7 })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-challenge-source')).toBe('live')
    expect(res.headers.get('x-challenge-runs')).toBe('2/2')
    const body = (await res.json()) as { source: string; answers: unknown[]; bundle: { clause_id: string } }
    expect(body.source).toBe('live')
    expect(body.answers).toHaveLength(2)
    expect(body.bundle.clause_id).toBe(failClause.clause_id)
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-test-key')
  })

  it('rejects an unknown graph version, too many runs, and an unknown clause', async () => {
    expect((await post({ clause_id: failClause.clause_id, graph_version: 9 })).status).toBe(400)
    expect((await post({ clause_id: failClause.clause_id, graph_version: 7, runs: 4 })).status).toBe(400)
    expect((await post({ clause_id: 'nope', graph_version: 7 })).status).toBe(422)
  })
})
