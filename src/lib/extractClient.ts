import { cachedExtraction, type AgreementClause } from '@/domain/fixtures'
import { ExtractedClauseSchema } from '@/domain/schema'
import type { ExtractedClause } from '@/domain/types'

/**
 * Why a cached fixture is on screen. The server reports its own reason in the
 * `x-extraction-fallback` header; 'api_unreachable' is the browser's, for when
 * /api/extract itself could not be reached or returned something unusable.
 */
export type FallbackReason =
  | 'no_api_key'
  | 'network_error'
  | 'invalid_output'
  | 'api_unreachable'
  | `http_${number}`

export interface Extraction {
  clause: ExtractedClause
  fallback_reason: FallbackReason | null
}

const localFixture = (clauseId: string): Extraction => ({
  clause: { ...cachedExtraction(clauseId), extraction_source: 'fixture' },
  fallback_reason: 'api_unreachable',
})

/**
 * Ask /api/extract for a clause. The demo must work with no backend at all, so
 * anything short of a valid ExtractedClause falls back to the cached fixture
 * bundled with the app, and says so.
 */
export async function requestExtraction(
  clause: AgreementClause,
  signal: AbortSignal,
): Promise<Extraction> {
  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clause_id: clause.clause_id,
        clause_type: clause.clause_type,
        source_text: clause.source_text,
        source_span: clause.source_span,
      }),
      signal,
    })
    if (!res.ok) return localFixture(clause.clause_id)

    const parsed = ExtractedClauseSchema.safeParse(await res.json())
    if (!parsed.success) return localFixture(clause.clause_id)

    const header = res.headers.get('x-extraction-fallback')
    const fallback_reason =
      parsed.data.extraction_source === 'nemotron'
        ? null
        : ((header && header !== 'none' ? header : 'invalid_output') as FallbackReason)
    return { clause: parsed.data, fallback_reason }
  } catch (err) {
    if (signal.aborted) throw err
    return localFixture(clause.clause_id)
  }
}

/** One honest sentence about where the extraction on screen came from. */
export function sourceDetail(e: Extraction): string {
  if (e.clause.extraction_source === 'nemotron') {
    return `Extracted live by ${e.clause.model ?? 'Nemotron'} for this request.`
  }
  const cached = `Cached extraction${e.clause.model ? ` (recorded from ${e.clause.model})` : ''}.`
  const reason = e.fallback_reason
  if (reason === 'no_api_key') return `${cached} No live call was made: NVIDIA_API_KEY is not set.`
  if (reason === 'network_error') return `${cached} The live call to Nemotron did not complete.`
  if (reason === 'invalid_output')
    return `${cached} Nemotron's output failed schema validation twice, so it was discarded.`
  if (reason === 'api_unreachable') return `${cached} /api/extract could not be reached.`
  if (reason?.startsWith('http_'))
    return `${cached} Nemotron answered with HTTP ${reason.slice(5)}, so its reply was not used.`
  return cached
}
