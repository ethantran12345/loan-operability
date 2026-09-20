import { z } from 'zod'
import { ModelAnswerSchema } from '@/domain/challenge'
import { agreement } from '@/domain/fixtures'
import type { ChallengeResponse } from '@/lib/challenge'
import { extractionFor } from '@/lib/extractClient'

/** The kill switch: VITE_CHALLENGE_MODE=off removes the panel and its calls entirely. */
export const CHALLENGE_MODE_ON = import.meta.env.VITE_CHALLENGE_MODE !== 'off'

/** Longer than the server's own budget, so the server's reason wins when it has one. */
const CLIENT_TIMEOUT_MS = 105_000

const ServedSchema = z.object({
  model: z.string(),
  source: z.enum(['live', 'recorded']),
  recorded_at: z.string().optional(),
  answers: z.array(ModelAnswerSchema).min(1),
  raw: z.array(z.string()),
  latency_ms: z.array(z.number()),
  bundle: z.object({
    transaction_time: z.string(),
    clause_id: z.string(),
    clause_text: z.string(),
    capability_graph: z.unknown(),
    instructions: z.string(),
  }),
})

const UnavailableSchema = z.object({ source: z.literal('unavailable'), reason: z.string() })

/** Run 1 as soon as it lands, then the same answer with run 2 beside it (null if run 2 did not land). */
export interface ChallengeRuns {
  first: Promise<ChallengeResponse>
  both: Promise<ChallengeResponse | null>
}

const inFlight = new Map<string, ChallengeRuns>()

/**
 * The model's answers for one clause on one graph version, requested at most once
 * per page load. Results asks for the clause on screen as soon as it renders, so
 * the model's queue is waited out while the reader is reading the verdict.
 *
 * The two runs are asked for one after the other, one run per request. Concurrent
 * calls on one key starve each other on the hosted endpoint (39 s alone, 133 s
 * beside a twin), so asking in turn shows the first answer sooner and gets the
 * second one at all.
 *
 * Nothing is asked until the page's own extraction calls have settled, for the
 * same reason: a challenge launched into that burst was starved by it.
 *
 * `fresh` drops the remembered answers and asks again.
 */
export function challengeFor(clauseId: string, graphVersion: number, fresh = false): ChallengeRuns {
  const key = `${clauseId}@v${graphVersion}`
  const known = inFlight.get(key)
  if (known && !fresh) return known
  const ask = () => requestChallenge(clauseId, graphVersion, AbortSignal.timeout(CLIENT_TIMEOUT_MS))
  // Review already asked for every clause, so this joins those calls and makes none.
  const quiet = Promise.allSettled(agreement.clauses.map((c) => extractionFor(c)))
  const first = quiet.then(ask)
  const both = first.then(async (a) => {
    if (a.source !== 'live') return null
    const b = await ask()
    if (b.source !== 'live') return null
    return {
      ...a,
      answers: [...a.answers, ...b.answers],
      raw: [...a.raw, ...b.raw],
      latency_ms: [...a.latency_ms, ...b.latency_ms],
    }
  })
  const runs = { first, both }
  inFlight.set(key, runs)
  return runs
}

/**
 * Ask /api/challenge. Anything short of a well-formed response is reported as
 * unavailable: there is no local stand-in for what a model said.
 */
export async function requestChallenge(
  clauseId: string,
  graphVersion: number,
  signal: AbortSignal,
): Promise<ChallengeResponse> {
  try {
    const res = await fetch('/api/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clause_id: clauseId, graph_version: graphVersion, runs: 1 }),
      signal,
    })
    if (!res.ok) return { source: 'unavailable', reason: `api_http_${res.status}` }
    const body: unknown = await res.json()
    const unavailable = UnavailableSchema.safeParse(body)
    if (unavailable.success) return unavailable.data
    const served = ServedSchema.safeParse(body)
    if (!served.success) return { source: 'unavailable', reason: 'invalid_response' }
    return served.data as ChallengeResponse
  } catch {
    return { source: 'unavailable', reason: 'api_unreachable' }
  }
}

/** One calm sentence for when there is no model answer to show. */
export function unavailableDetail(reason: string): string {
  if (reason.includes('no_api_key')) return 'No model call was made: NVIDIA_API_KEY is not set.'
  if (reason.includes('timeout')) return 'The model did not answer within the time limit.'
  if (reason.includes('invalid_output')) return 'The model replied, but not in the requested format, twice.'
  if (reason.startsWith('api_')) return '/api/challenge could not be reached.'
  return `The model could not be reached (${reason}).`
}
