import { useCallback, useEffect, useMemo, useState } from 'react'
import { evaluate } from '@/domain/evaluate'
import { TRANSACTION_TIME, capabilityGraphs } from '@/domain/fixtures'
import { proposeRepairs, type RepairPlan } from '@/domain/repair'
import type { CandidatePath, CapabilityGraph, EvaluationReport, ExtractedClause, RequirementResult } from '@/domain/types'
import { verifyCitations, type CitationIndex } from '@/documents/citations'
import { readPacket, type Packet, type ScopedClause } from '@/documents/packet'
import { extractionFor, type Extraction } from './extractClient'

/** One real evaluation: its inputs, its report, and how long `evaluate()` took. */
export interface Evaluated {
  clause: ExtractedClause
  graph: CapabilityGraph
  agreementVersion: string
  report: EvaluationReport
  ms: number
}

export function timedEvaluate(clause: ExtractedClause, graph: CapabilityGraph, agreementVersion: string): Evaluated {
  const started = performance.now()
  const report = evaluate([clause], graph, TRANSACTION_TIME, agreementVersion)
  return { clause, graph, agreementVersion, report, ms: performance.now() - started }
}

export const firstResult = (e: Evaluated): RequirementResult => e.report.clause_results[0]!.requirement_results[0]!
export const decisivePath = (e: Evaluated): CandidatePath | undefined => {
  const r = firstResult(e)
  return r.candidate_paths.find((p) => p.path_id === r.selected_path_id)
}

export interface ClauseReview {
  clause: ScopedClause
  extraction: Extraction | null
  /** True when this session had already extracted the clause before this run asked. */
  reused: boolean
  evaluated: Evaluated | null
  /** The same extracted terms against the other registry version. No model call. */
  otherVersion: Evaluated | null
  plan: RepairPlan | null
}

export type StepState = 'pending' | 'running' | 'done' | 'error'

export interface ReviewRun {
  packet: Packet | null
  citations: CitationIndex | null
  readError: string | null
  clauses: ClauseReview[]
  steps: { read: StepState; extract: StepState; check: StepState }
  /** Registry version the extraction ran under; a later version switch reuses it. */
  extractedUnderVersion: number | null
  rerun: () => void
}

interface Settled {
  extraction: Extraction
  reused: boolean
}

/**
 * The document review, as real operations in order: read and verify the packet,
 * extract the clauses in scope, evaluate each against the registry. Each step's
 * state is derived from the work itself; nothing is paced or simulated.
 */
export function useAgreementReview(version: number): ReviewRun {
  const [run, setRun] = useState(0)
  const [read, setRead] = useState<{ packet: Packet; citations: CitationIndex } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [settled, setSettled] = useState<Record<string, Settled>>({})
  const [extractedUnderVersion, setExtractedUnderVersion] = useState<number | null>(null)
  const graph = capabilityGraphs[version]!

  // 1. Read documents. Re-read when the registry version changes, because the
  // policy packet in force changes with it.
  useEffect(() => {
    try {
      const packet = readPacket(version)
      setRead({ packet, citations: verifyCitations(graph, packet.policies) })
      setReadError(null)
    } catch (err) {
      setRead(null)
      setReadError((err as Error).message)
    }
  }, [version, graph, run])

  // 2. Extract terms: once per run, not per registry version.
  const clauses = read?.packet.clauses
  const clauseKey = clauses?.map((c) => `${c.clause_id}:${c.source_text.length}`).join('|') ?? ''
  useEffect(() => {
    if (!clauses) return
    let current = true
    setSettled({})
    setExtractedUnderVersion(version)
    for (const c of clauses) {
      const asked = performance.now()
      void extractionFor(c, run > 0).then((extraction) => {
        if (!current) return
        const waited = performance.now() - asked
        const reused = waited < 150 && (extraction.diagnostics?.upstream_ms ?? 0) > 300
        setSettled((s) => ({ ...s, [c.clause_id]: { extraction, reused } }))
      })
    }
    return () => {
      current = false
    }
    // Deliberately not keyed on `version`: a registry change must not re-extract.
  }, [clauseKey, run])

  // 3. Check routes: pure evaluation of whatever has been extracted so far.
  const reviews = useMemo<ClauseReview[]>(() => {
    if (!read) return []
    const otherGraph = Object.values(capabilityGraphs).find((g) => g.version !== version) ?? null
    return read.packet.clauses.map((clause) => {
      const hit = settled[clause.clause_id]
      if (!hit) return { clause, extraction: null, reused: false, evaluated: null, otherVersion: null, plan: null }
      const evaluated = timedEvaluate(hit.extraction.clause, graph, read.packet.agreement.meta.version)
      const req = hit.extraction.clause.requirements[0]!
      return {
        clause,
        extraction: hit.extraction,
        reused: hit.reused,
        evaluated,
        otherVersion: otherGraph ? timedEvaluate(hit.extraction.clause, otherGraph, read.packet.agreement.meta.version) : null,
        plan: proposeRepairs(req, firstResult(evaluated), graph),
      }
    })
  }, [read, settled, graph, version])

  const extractedCount = reviews.filter((r) => r.extraction).length
  const total = reviews.length
  const steps = {
    read: readError ? ('error' as const) : read ? ('done' as const) : ('running' as const),
    extract: !read ? ('pending' as const) : extractedCount === total ? ('done' as const) : ('running' as const),
    check: !read || extractedCount === 0 ? ('pending' as const) : extractedCount === total ? ('done' as const) : ('running' as const),
  }

  const rerun = useCallback(() => setRun((n) => n + 1), [])

  return {
    packet: read?.packet ?? null,
    citations: read?.citations ?? null,
    readError,
    clauses: reviews,
    steps,
    extractedUnderVersion,
    rerun,
  }
}
