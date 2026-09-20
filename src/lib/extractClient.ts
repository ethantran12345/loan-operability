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
  | 'timeout'
  | 'network_error'
  | 'invalid_output'
  | 'api_unreachable'
  | `http_${number}`

/** What /api/extract reported about its own call, from the `x-extraction-*` headers. */
export interface ExtractionDiagnostics {
  /** Rounds with the model: 1, or 2 when a reply was rejected and asked again. */
  attempts: number
  calls: number
  /** Wall-clock time the server spent waiting on the model. */
  upstream_ms: number
  /** Why the first rejected reply was rejected, when one was. */
  rejection: string | null
}

export interface Extraction {
  clause: ExtractedClause
  fallback_reason: FallbackReason | null
  /** Absent when /api/extract never answered and the bundled fixture is shown. */
  diagnostics?: ExtractionDiagnostics
}

const localFixture = (clauseId: string): Extraction => ({
  clause: { ...cachedExtraction(clauseId), extraction_source: 'fixture' },
  fallback_reason: 'api_unreachable',
})

/** Longer than the server's own budget, so the server's reason wins when it has one. */
const CLIENT_TIMEOUT_MS = 35_000

const inFlight = new Map<string, Promise<Extraction>>()

/**
 * The extraction for a clause, requested at most once per page load. Review calls
 * this for every clause as the agreement renders, so NVIDIA's queue is waited out
 * while the reader is still reading. The result is no less live for being early:
 * it is this session's own call, and it is labelled by what actually served it.
 *
 * `fresh` drops the remembered result and asks again.
 */
export function extractionFor(clause: AgreementClause, fresh = false): Promise<Extraction> {
  const known = inFlight.get(clause.clause_id)
  if (known && !fresh) return known
  const request = requestExtraction(clause, AbortSignal.timeout(CLIENT_TIMEOUT_MS))
  inFlight.set(clause.clause_id, request)
  return request
}

/** True when asking again could plausibly produce a live result. */
export function canRetryLive(e: Extraction): boolean {
  return e.clause.extraction_source === 'fixture' && e.fallback_reason !== 'no_api_key'
}

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
    const count = (name: string) => Number(res.headers.get(name) ?? 0) || 0
    const diagnostics: ExtractionDiagnostics = {
      attempts: count('x-extraction-attempts'),
      calls: count('x-extraction-calls'),
      upstream_ms: count('x-extraction-ms'),
      rejection: res.headers.get('x-extraction-rejection'),
    }
    return { clause: parsed.data, fallback_reason, diagnostics }
  } catch {
    return localFixture(clause.clause_id)
  }
}

/** One honest sentence about where the extraction on screen came from. */
export function sourceDetail(e: Extraction): string {
  if (e.clause.extraction_source === 'nemotron') {
    return `Extracted live by ${e.clause.model ?? 'Nemotron'} during this session.`
  }
  const cached = `Cached extraction${e.clause.model ? ` (recorded from ${e.clause.model})` : ''}.`
  const reason = e.fallback_reason
  if (reason === 'no_api_key') return `${cached} No live call was made: NVIDIA_API_KEY is not set.`
  if (reason === 'timeout')
    return `${cached} Nemotron did not answer within the time limit, so no live result is shown.`
  if (reason === 'network_error') return `${cached} The live call to Nemotron did not complete.`
  if (reason === 'invalid_output')
    return `${cached} Nemotron's output failed schema validation twice, so it was discarded.`
  if (reason === 'api_unreachable') return `${cached} /api/extract could not be reached.`
  if (reason?.startsWith('http_'))
    return `${cached} Nemotron answered with HTTP ${reason.slice(5)}, so its reply was not used.`
  return cached
}
