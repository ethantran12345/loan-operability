/**
 * Challenge mode, server side: give a general model the clause and the full
 * capability graph with no engine, and return what it said, verbatim.
 *
 * Runs server-side (api/challenge.ts, and the Vite dev middleware), so it imports
 * with relative '.js' paths like extract.ts.
 *
 * Nothing here grades anything: `gradeChallenge` does that, in the browser, from
 * the engine's own result. And nothing here ever writes a model answer. A run
 * that cannot be parsed is dropped. The only fallback is a recording of a real
 * call, served with the time it was recorded.
 */

import { z } from 'zod'
import { ModelAnswerSchema, buildChallengeBundle, type ChallengeBundle, type ModelAnswer } from '../domain/challenge.js'
import { agreement, capabilityGraphs } from '../domain/fixtures.js'
import recordedJson from '../fixtures/challenge-recorded.json' with { type: 'json' }
import { DEFAULT_MODEL, NVIDIA_CHAT_URL, hedged, parseModelJson } from './extract.js'

export const ChallengeRequestSchema = z.object({
  clause_id: z.string().min(1),
  graph_version: z.number().int().refine((v) => v in capabilityGraphs, 'Unknown capability graph version'),
  runs: z.number().int().min(1).max(3).default(2),
})

export type ChallengeRequest = z.infer<typeof ChallengeRequestSchema>

/** A real response, kept from a real call. Never written by hand. */
export interface ChallengeRecording {
  recorded_at: string
  model: string
  clause_id: string
  graph_version: number
  answers: ModelAnswer[]
  raw: string[]
  latency_ms: number[]
}

export const recordedChallenges = (recordedJson as unknown as { recordings: ChallengeRecording[] }).recordings

export type ChallengeResponse =
  | {
      model: string
      source: 'live' | 'recorded'
      /** Present only when `source` is 'recorded'. */
      recorded_at?: string
      answers: ModelAnswer[]
      /** The reply text each answer was parsed from, untouched. */
      raw: string[]
      latency_ms: number[]
      bundle: ChallengeBundle
    }
  | { source: 'unavailable'; reason: string }

export interface ChallengeOutcome {
  response: ChallengeResponse
  runs_requested: number
  /** HTTP calls launched, retries and hedged duplicates included. */
  calls: number
  upstream_ms: number
  /** Why each dropped run was dropped, in order. For logs, not the UI. */
  failures: string[]
}

export interface ChallengeDeps {
  apiKey: string | undefined
  fetch: typeof fetch
  model?: string
  /** Budget for one run, retry included. Runs are parallel, so also for the request. */
  timeoutMs?: number
  /** When to launch duplicate calls. Off by default here: see CHALLENGE_BUDGET_MS. */
  hedgeAfterMs?: number[]
  recordings?: ChallengeRecording[]
}

/**
 * Extraction's budget pattern, one budget per run with the retry inside it, at a
 * measured number. Reading the whole graph and listing paths is a ~1,500-token
 * reply, which the hosted endpoint took 31 to 39 s to produce when its queue was
 * short and more than 55 s when it was not; 25 s would never succeed. 110 s fits
 * the function's 120 s limit.
 *
 * Duplicate calls are not launched. Concurrent calls on one key starve each other
 * here (39 s alone, 133 s beside a twin), so a hedge slows the call it is hedging.
 */
export const CHALLENGE_BUDGET_MS = 110_000

type ChatMessage = { role: 'user' | 'assistant'; content: string }

/** The one message the model gets: the bundle, and nothing the engine worked out. */
export function challengeMessage(bundle: ChallengeBundle): string {
  return `${bundle.instructions}\n\nCLAUSE:\n${bundle.clause_text}\n\nCAPABILITY_GRAPH:\n${JSON.stringify(bundle.capability_graph)}`
}

type Parsed = { ok: true; answer: ModelAnswer } | { ok: false; error: string }

export function parseModelAnswer(content: string): Parsed {
  let parsed: unknown
  try {
    parsed = parseModelJson(content)
  } catch (err) {
    return { ok: false, error: `Reply was not valid JSON: ${(err as Error).message}` }
  }
  const result = ModelAnswerSchema.safeParse(parsed)
  if (result.success) return { ok: true, answer: result.data }
  const issues = result.error.issues
    .slice(0, 12)
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
  return { ok: false, error: `Schema validation failed:\n${issues.join('\n')}` }
}

type Run = { ok: true; answer: ModelAnswer; raw: string; latency_ms: number } | { ok: false; reason: string }

/**
 * Ask the model the same question `runs` times, in parallel, at temperature 0
 * exactly as extraction does. If the runs agree, the scorecard says so.
 *
 * Throws only for a clause_id that is not in the agreement.
 */
export async function runChallenge(input: ChallengeRequest, deps: ChallengeDeps): Promise<ChallengeOutcome> {
  const clause = agreement.clauses.find((c) => c.clause_id === input.clause_id)
  if (!clause) throw new Error(`No clause ${input.clause_id} in the agreement`)
  const graph = capabilityGraphs[input.graph_version]!
  const bundle = buildChallengeBundle(clause, graph, agreement.transaction_time)

  const started = Date.now()
  const failures: string[] = []
  let calls = 0

  const settle = (live: Run[]): ChallengeOutcome => {
    const good = live.filter((r) => r.ok)
    for (const r of live) if (!r.ok) failures.push(r.reason)
    const base = { runs_requested: input.runs, calls, upstream_ms: Date.now() - started, failures }
    if (good.length > 0) {
      return {
        ...base,
        response: {
          model,
          source: 'live',
          answers: good.map((r) => r.answer),
          raw: good.map((r) => r.raw),
          latency_ms: good.map((r) => r.latency_ms),
          bundle,
        },
      }
    }
    const recording = (deps.recordings ?? recordedChallenges).find(
      (r) => r.clause_id === input.clause_id && r.graph_version === input.graph_version,
    )
    if (recording) {
      return {
        ...base,
        response: {
          model: recording.model,
          source: 'recorded',
          recorded_at: recording.recorded_at,
          answers: recording.answers,
          raw: recording.raw,
          latency_ms: recording.latency_ms,
          bundle,
        },
      }
    }
    return { ...base, response: { source: 'unavailable', reason: [...new Set(failures)].join(', ') } }
  }

  const model = deps.model ?? DEFAULT_MODEL
  if (!deps.apiKey) return settle([{ ok: false, reason: 'no_api_key' }])

  const budgetMs = deps.timeoutMs ?? CHALLENGE_BUDGET_MS
  const hedgeAfterMs = deps.hedgeAfterMs ?? []

  const oneRun = async (): Promise<Run> => {
    const runStarted = Date.now()
    const elapsed = () => Date.now() - runStarted
    const messages: ChatMessage[] = [{ role: 'user', content: challengeMessage(bundle) }]

    const callModel = async (signal: AbortSignal) => {
      calls++
      const res = await deps.fetch(NVIDIA_CHAT_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${deps.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          max_tokens: 4096,
          stream: false,
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal,
      })
      if (!res.ok) return { status: res.status, content: '' }
      const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
      const raw = body.choices?.[0]?.message?.content
      return { status: 200, content: typeof raw === 'string' ? raw : '' }
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      const remainingMs = budgetMs - elapsed()
      if (remainingMs < 1_000) return { ok: false, reason: 'timeout' }

      let content: string
      try {
        const reply = await hedged(callModel, remainingMs, hedgeAfterMs)
        if (reply.status !== 200) return { ok: false, reason: `http_${reply.status}` }
        content = reply.content
      } catch {
        return { ok: false, reason: elapsed() >= budgetMs - 100 ? 'timeout' : 'network_error' }
      }

      const parsed = parseModelAnswer(content)
      if (parsed.ok) return { ok: true, answer: parsed.answer, raw: content, latency_ms: elapsed() }

      messages.push(
        { role: 'assistant', content: content || '(empty reply)' },
        { role: 'user', content: `That reply was rejected.\n${parsed.error}\n\nReturn the corrected JSON object only.` },
      )
    }
    return { ok: false, reason: 'invalid_output' }
  }

  return settle(await Promise.all(Array.from({ length: input.runs }, oneRun)))
}
