import { useCallback, useEffect, useMemo, useState } from 'react'
import { evaluate } from '@/domain/evaluate'
import { TRANSACTION_TIME, capabilityGraphs } from '@/domain/fixtures'
import { proposeRepairs, type RepairPlan } from '@/domain/repair'
import type { CandidatePath, CapabilityGraph, EvaluationReport, ExtractedClause, RequirementResult } from '@/domain/types'
import { verifyCitations, type CitationIndex } from '@/documents/citations'
import { readPacket, readPacketFrom, type Packet, type PacketFile, type ScopedClause } from '@/documents/packet'
import { askedAtFor, extractionFor, type Extraction } from './extractClient'

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
  /** performance.now() when this clause's request left, or is due to: requests leave one at a time. null before it is asked for. */
  askedAt: number | null
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
  /** Ask the model again for one clause. The result is labelled by what actually served it. */
  retryLive: (clauseId: string) => void
}

interface Settled {
  extraction: Extraction
  reused: boolean
}

/**
 * The document review, as real operations in order: read and verify the packet,
 * extract the clauses in scope, evaluate each against the registry. Each step's
 * state is derived from the work itself; nothing is paced or simulated.
 * With `enabled` false the packet is read (so the agreement can be shown) but
 * no clause is extracted until the caller turns it on.
 * `files` is the packet the analyst handed over. Null means nothing readable has
 * been handed over yet, so nothing is read. Left out, the bundled sample is read.
 */
export function useAgreementReview(version: number, enabled = true, files?: PacketFile[] | null): ReviewRun {
  const [run, setRun] = useState(0)
  const [read, setRead] = useState<{ packet: Packet; citations: CitationIndex } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [settled, setSettled] = useState<Record<string, Settled>>({})
  const [extractedUnderVersion, setExtractedUnderVersion] = useState<number | null>(null)
  const graph = capabilityGraphs[version]!

  // 1. Read documents. Re-read when the registry version changes, because the
  // policy packet in force changes with it.
  useEffect(() => {
    if (files === null) {
      setRead(null)
      setReadError(null)
      return
    }
    try {
      const packet = files ? readPacketFrom(files, version) : readPacket(version)
      setRead({ packet, citations: verifyCitations(graph, packet.policies) })
      setReadError(null)
    } catch (err) {
      setRead(null)
      setReadError((err as Error).message)
    }
  }, [version, graph, run, files])

  // 2. Extract terms: once per run, not per registry version.
  // Every clause is asked for here, and extractionFor lets the requests leave one at a time,
  // in the order the agreement states the clauses: the first clause on the page is the first asked.
  const clauses = read?.packet.clauses
  const clauseKey = clauses ? `${read.packet.agreement.sha256}|${clauses.map((c) => c.clause_id).join('|')}` : ''
  useEffect(() => {
    if (!clauses || !enabled) return
    let current = true
    setSettled({})
    setExtractedUnderVersion(version)
    for (const c of [...clauses].sort((x, y) => x.start - y.start)) {
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
  }, [clauseKey, run, enabled])

  // 3. Check routes: pure evaluation of whatever has been extracted so far.
  const reviews = useMemo<ClauseReview[]>(() => {
    if (!read) return []
    const otherGraph = Object.values(capabilityGraphs).find((g) => g.version !== version) ?? null
    return read.packet.clauses.map((clause) => {
      const hit = settled[clause.clause_id]
      const askedAt = askedAtFor(clause)
      if (!hit) return { clause, extraction: null, askedAt, reused: false, evaluated: null, otherVersion: null, plan: null }
      const evaluated = timedEvaluate(hit.extraction.clause, graph, read.packet.agreement.meta.version)
      const req = hit.extraction.clause.requirements[0]!
      return {
        clause,
        extraction: hit.extraction,
        askedAt,
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

  const retryLive = useCallback(
    (clauseId: string) => {
      const clause = clauses?.find((c) => c.clause_id === clauseId)
      if (!clause) return
      setSettled(({ [clauseId]: _dropped, ...rest }) => rest)
      void extractionFor(clause, true).then((extraction) =>
        setSettled((s) => ({ ...s, [clauseId]: { extraction, reused: false } })),
      )
    },
    [clauses],
  )

  return {
    packet: read?.packet ?? null,
    citations: read?.citations ?? null,
    readError,
    clauses: reviews,
    steps,
    extractedUnderVersion,
    rerun,
    retryLive,
  }
}
