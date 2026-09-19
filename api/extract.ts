/**
 * POST /api/extract — Vercel Function (Web-standard handler).
 *
 * Body:     { clause_id, clause_type, source_text, source_span }
 * Response: an ExtractedClause, exactly as typed in src/domain/types.ts.
 *
 * The body never carries anything beyond the ExtractedClause. Why a fixture was
 * served travels in the `x-extraction-fallback` header, so the UI can be honest
 * about it without widening the domain type.
 *
 * This never 500s into the demo: every model, network or auth failure resolves
 * to the cached fixture with `extraction_source: 'fixture'`.
 */

import { ExtractRequestSchema } from '../src/domain/schema.js'
import { extractClause } from '../src/lib/extract.js'

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

  const input = ExtractRequestSchema.safeParse(payload)
  if (!input.success) {
    return json({ error: 'Invalid extract request', issues: input.error.issues }, 400)
  }

  try {
    const outcome = await extractClause(input.data, {
      apiKey: process.env.NVIDIA_API_KEY,
      model: process.env.NEMOTRON_MODEL,
      fetch,
    })
    if (outcome.fallback_reason) {
      console.warn(`[extract] ${input.data.clause_id}: fixture served (${outcome.fallback_reason})`)
    }
    return json(outcome.clause, 200, {
      'x-extraction-source': outcome.clause.extraction_source,
      'x-extraction-fallback': outcome.fallback_reason ?? 'none',
    })
  } catch (err) {
    // Only reachable for a clause with no cached fixture to fall back to.
    return json({ error: (err as Error).message }, 422)
  }
}
