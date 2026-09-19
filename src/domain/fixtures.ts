// Relative paths and import attributes, not the '@/' alias: /api/extract runs this
// file as plain Node ESM on Vercel, where the Vite alias does not exist.
import graphJson from '../fixtures/capability-graph.v7.json' with { type: 'json' }
import agreementJson from '../fixtures/agreement.json' with { type: 'json' }
import extractionsJson from '../fixtures/extractions.json' with { type: 'json' }
import type { CapabilityGraph, ClauseType, ExtractedClause, SourceSpan } from './types'

export const capabilityGraph = graphJson as unknown as CapabilityGraph

export interface AgreementClause {
  clause_id: string
  clause_type: ClauseType
  scenario: 'PASS' | 'MANUAL' | 'FAIL'
  headline: string
  source_span: SourceSpan
  source_text: string
}

export interface Agreement {
  agreement_version: string
  document: string
  title: string
  disclaimer: string
  transaction_time: string
  clauses: AgreementClause[]
}

export const agreement = agreementJson as unknown as Agreement

const extractionMap = extractionsJson as unknown as Record<string, ExtractedClause>

/** The cached extraction for a clause. Also the fallback when Nemotron is unreachable. */
export function cachedExtraction(clauseId: string): ExtractedClause {
  const hit = extractionMap[clauseId]
  if (!hit) throw new Error(`No cached extraction for clause ${clauseId}`)
  return structuredClone(hit)
}

export const TRANSACTION_TIME = agreement.transaction_time
