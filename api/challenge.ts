/**
 * POST /api/challenge — Vercel Function (Web-standard handler).
 *
 * Body:     { clause_id, graph_version: 7 | 8, runs?: 1..3 (default 2) }
 * Response: { model, source: 'live' | 'recorded', answers, raw, latency_ms, bundle }
 *           or { source: 'unavailable', reason }.
 *
 * There is no cached fallback here. A fabricated model answer would poison the
 * panel it feeds, so a run that cannot be parsed is dropped, and the only thing
 * served in place of a live call is a recording of a real one, labelled with the
 * time it was made. `x-challenge-source`, `x-challenge-runs`, `x-challenge-calls`
 * and `x-challenge-ms` say what served the reply and what it cost.
 */

import { ChallengeRequestSchema, runChallenge } from '../src/lib/challenge.js'

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }

  const input = ChallengeRequestSchema.safeParse(payload)
  if (!input.success) {
    return json({ error: 'Invalid challenge request', issues: input.error.issues }, 400)
  }

  try {
    const outcome = await runChallenge(input.data, {
      apiKey: process.env.NVIDIA_API_KEY,
      model: process.env.NEMOTRON_MODEL,
      fetch,
    })
    const { response } = outcome
    const runsOk = response.source === 'live' ? response.answers.length : 0
    // One structured line per request. Never the key, never the model's reply:
    // `rejections` holds the parser's and the schema's complaints, not the text.
    const log = {
      event: 'challenge',
      clause_id: input.data.clause_id,
      graph_version: input.data.graph_version,
      source: response.source,
      runs_requested: outcome.runs_requested,
      runs_ok: runsOk,
      calls: outcome.calls,
      upstream_ms: outcome.upstream_ms,
      failures: outcome.failures,
      rejections: outcome.rejections,
    }
    if (response.source === 'live') console.log(JSON.stringify(log))
    else console.warn(JSON.stringify(log))
    return json(response, 200, {
      'x-challenge-source': response.source,
      'x-challenge-runs': `${runsOk}/${outcome.runs_requested}`,
      'x-challenge-calls': String(outcome.calls),
      'x-challenge-ms': String(outcome.upstream_ms),
    })
  } catch (err) {
    // Only reachable for a clause_id that is not in the agreement.
    return json({ error: (err as Error).message }, 422)
  }
}
