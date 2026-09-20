import type { Extraction } from './extractClient'

/**
 * What happened between this session and the model for one clause.
 * 'answered': a reply came back and its terms are the ones on screen.
 * 'unused': a call was made, and nothing usable came back, so cached terms are shown.
 * 'none': no call to the model is on record. There is nothing to log, and nothing is.
 */
export type CallState = 'answered' | 'unused' | 'none'

export interface CallLogEntry {
  clause_id: string
  section: string
  call: CallState
  /**
   * The model id exactly as the API was asked for it. The server reports it only on a
   * reply that was used, so an unused call has none to show rather than a likely one.
   */
  model: string | null
  /** What went to the model. null when no call was made. Never the key, never a header: the browser holds neither. */
  sent: { clause_id: string; section: string; chars: number } | null
  /** The terms on screen. With `call` 'answered' they are the model's reply; otherwise they are the cached fixture's. */
  terms: { requirements: number; confidence: number[]; ambiguities: number; extraction_source: 'nemotron' | 'fixture' }
  /** The model the cached terms were recorded from, when they are cached. */
  recorded_from: string | null
  /** The server's own measurements of its call. null when no call was made. */
  measured: { upstream_ms: number; attempts: number; calls: number; rejection: string | null } | null
  /** Why cached terms are shown, in the server's or the browser's own word for it. */
  fallback_reason: string | null
  asked: { seq: number; at: string } | null
}

interface Asked {
  clause: { clause_id: string; source_text: string; source_span: { section: string } }
  extraction: Extraction | null
}

/** One clause's entry, from the extraction result and the diagnostics the server sent with it. Nothing else. */
export function callLogEntry({ clause, extraction: e }: Asked & { extraction: Extraction }): CallLogEntry {
  const live = e.clause.extraction_source === 'nemotron'
  const d = e.diagnostics
  const called = live || (d !== undefined && d.calls > 0)
  return {
    clause_id: clause.clause_id,
    section: clause.source_span.section,
    call: live ? 'answered' : called ? 'unused' : 'none',
    model: live ? (e.clause.model ?? null) : null,
    sent: called ? { clause_id: clause.clause_id, section: clause.source_span.section, chars: clause.source_text.length } : null,
    terms: {
      requirements: e.clause.requirements.length,
      confidence: e.clause.requirements.map((r) => r.confidence),
      ambiguities: e.clause.requirements.reduce((n, r) => n + r.ambiguities.length, 0),
      extraction_source: e.clause.extraction_source,
    },
    recorded_from: live ? null : (e.clause.model ?? null),
    measured: called && d ? { upstream_ms: d.upstream_ms, attempts: d.attempts, calls: d.calls, rejection: d.rejection } : null,
    fallback_reason: e.fallback_reason,
    asked: e.asked ?? null,
  }
}

/** The session's entries in the order the clauses were asked for. A clause not answered yet has no entry. */
export function callLog(clauses: Asked[]): CallLogEntry[] {
  return clauses
    .flatMap((c) => (c.extraction ? [callLogEntry({ clause: c.clause, extraction: c.extraction })] : []))
    .sort((a, b) => (a.asked?.seq ?? Infinity) - (b.asked?.seq ?? Infinity))
}

/** What an unused call came back with, in plain words. */
export function unusedReply(reason: string | null): string {
  if (reason === 'timeout') return 'no reply within the time limit'
  if (reason === 'network_error') return 'the call did not complete'
  if (reason === 'invalid_output') return 'two replies, both rejected'
  if (reason?.startsWith('http_')) return `HTTP ${reason.slice(5)}`
  return 'nothing usable'
}

/** Why no call was made, in plain words. */
export function noCallReason(reason: string | null): string {
  if (reason === 'no_api_key') return 'NVIDIA_API_KEY is not set'
  if (reason === 'api_unreachable') return '/api/extract could not be reached'
  return 'the server reported no call'
}
