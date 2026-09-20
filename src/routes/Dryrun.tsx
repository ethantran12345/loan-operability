import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AgreementPane } from '@/components/dryrun/AgreementPane'
import { DemoDrawer } from '@/components/dryrun/DemoDrawer'
import { FindingCard } from '@/components/dryrun/FindingCard'
import { changelogEntry } from '@/components/results/GraphVersion'
import { paragraphAnchor } from '@/components/workspace/DocumentViewer'
import type { ToneSpan } from '@/components/workspace/Marked'
import { mostSevere } from '@/domain/evaluate'
import { TRANSACTION_TIME, agreement, capabilityGraph, capabilityGraphs } from '@/domain/fixtures'
import { applyRepairs } from '@/domain/repair'
import { buildComparisonPacket } from '@/documents/bundle'
import { evidenceForCheck, type EvidencePassage } from '@/documents/citations'
import { locateTerm } from '@/documents/locate'
import { extractionFor } from '@/lib/extractClient'
import { countDecisions, ms } from '@/lib/runFormat'
import { useReviewSession } from '@/lib/session'
import { decisivePath, firstResult, timedEvaluate, useAgreementReview, type Evaluated } from '@/lib/useAgreementReview'

const BASE_VERSION = capabilityGraph.version
const TONE = { FAIL: 'fail', MANUAL: 'manual', PASS: 'pass' } as const

type Phase = 'idle' | 'reading' | 'extracting' | 'checking' | 'done'
const NEXT: Record<Phase, Phase> = { idle: 'idle', reading: 'extracting', extracting: 'checking', checking: 'done', done: 'done' }

/**
 * Each label on the run button names a real operation, and the button never
 * moves on before that operation has finished. Reading and checking finish in
 * milliseconds, so a label is held at least this long to be readable.
 */
const LABEL_HOLD_MS = 650

/** A run this page load has already finished, so coming back from a demo view does not ask for it again. */
let ranThisLoad = false

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** The product: one agreement, its findings, and five controls. Everything for a judge is in the Demo drawer. */
export function Dryrun() {
  const navigate = useNavigate()
  const session = useReviewSession()
  const [search, setSearch] = useSearchParams()
  const asked = Number(search.get('v'))
  const version = asked in capabilityGraphs ? asked : BASE_VERSION
  const graph = capabilityGraphs[version]!

  const [phase, setPhase] = useState<Phase>(ranThisLoad ? 'done' : 'idle')
  const run = useAgreementReview(version, phase !== 'idle')
  const { packet, citations } = run
  // Findings follow the document, not the fixture's listing order.
  const clauses = useMemo(() => [...run.clauses].sort((a, b) => a.clause.start - b.clause.start), [run.clauses])

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ clauseId: string; checkIndex: number } | null>(null)
  const [procedure, setProcedure] = useState<EvidencePassage | null>(null)
  const [retests, setRetests] = useState<Record<string, Evaluated>>({})
  const [jump, setJump] = useState<{ anchor: string; card: string | null; n: number } | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const closeDrawer = useCallback(() => setDrawer(false), [])

  // The run button's state machine: advance only when the operation it names is done.
  const since = useRef(0)
  const ready =
    (phase === 'reading' && run.steps.read === 'done') ||
    (phase === 'extracting' && run.steps.extract === 'done') ||
    (phase === 'checking' && run.steps.check === 'done')
  useEffect(() => {
    if (!ready) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const wait = still ? 0 : Math.max(0, LABEL_HOLD_MS - (performance.now() - since.current))
    const timer = setTimeout(() => {
      since.current = performance.now()
      setPhase((p) => NEXT[p])
    }, wait)
    return () => clearTimeout(timer)
  }, [ready, phase])
  useEffect(() => {
    if (phase === 'done') ranThisLoad = true
  }, [phase])

  // Navigation the analyst asked for. Nothing else moves the scroll position.
  useEffect(() => {
    if (!jump) return
    document.getElementById(jump.anchor)?.scrollIntoView({ block: 'center' })
    if (jump.card) document.querySelector(`[data-clause="${jump.card}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [jump])

  const begin = (next: Phase) => {
    since.current = performance.now()
    setPhase(next)
  }
  const reset = () => {
    setRetests({})
    setFocus(null)
    setProcedure(null)
  }
  const start = () => begin('reading')
  const runAgain = () => {
    reset()
    setExpandedId(null)
    run.rerun()
    begin('reading')
  }

  const done = phase === 'done'
  const doc = (procedure && packet?.documents.find((d) => d.meta.document_id === procedure.document_id)) || packet?.agreement || null

  const spans = useMemo<ToneSpan[]>(() => {
    if (!focus || !packet || !citations || !doc) return []
    const review = clauses.find((c) => c.clause.clause_id === focus.clauseId)
    const check = review?.evaluated && decisivePath(review.evaluated)?.checks[focus.checkIndex]
    if (!review || !check) return []
    if (doc.meta.kind === 'agreement') {
      const term = locateTerm(review.clause.source_text, review.clause.start, check.field)
      return term ? [{ ...term, tone: TONE[check.verdict] }] : []
    }
    return evidenceForCheck(check, citations, graph)
      .filter((p) => p.document_id === doc.meta.document_id)
      .flatMap((p) => p.highlights.map((h) => ({ ...h, tone: TONE[check.verdict] })))
  }, [focus, packet, citations, doc, clauses, graph])

  const goTo = (docId: string, start: number, card: string | null) =>
    setJump((j) => ({ anchor: paragraphAnchor(docId, start), card, n: (j?.n ?? 0) + 1 }))

  /** From the document: open that finding. From a card: toggle it, and show its clause. */
  const selectClause = (clauseId: string, from: 'document' | 'card') => {
    const review = clauses.find((c) => c.clause.clause_id === clauseId)
    if (!review || !packet) return
    const closing = from === 'card' && expandedId === clauseId
    setExpandedId(closing ? null : clauseId)
    if (focus?.clauseId !== clauseId || closing) setFocus(null)
    if (closing) return
    setProcedure(null)
    goTo(packet.agreement.meta.document_id, review.clause.start, from === 'document' ? clauseId : null)
  }

  const applyFix = (clauseId: string) => {
    const review = clauses.find((c) => c.clause.clause_id === clauseId)
    if (!review?.extraction || !review.plan || !packet) return
    const requirements = review.extraction.clause.requirements.map((r, i) => (i === 0 ? applyRepairs(r, review.plan!.proposals) : r))
    const retest = timedEvaluate({ ...review.extraction.clause, requirements }, graph, `${packet.agreement.meta.version}+proposed-amendment`)
    setRetests((r) => ({ ...r, [clauseId]: retest }))
    // Bring the card's pills into view: FAIL → PASS is the point of the re-test.
    requestAnimationFrame(() => document.querySelector(`[data-clause="${clauseId}"]`)?.scrollIntoView({ block: 'start' }))
  }

  const switchVersion = (v: number) => {
    setDrawer(false)
    if (v === version) return
    reset()
    setSearch(v === BASE_VERSION ? {} : { v: String(v) }, { replace: true })
    // Same extracted terms, re-checked against the other registry. No model call.
    if (done) begin('checking')
  }

  const currentClauseId = expandedId ?? agreement.clauses[0]!.clause_id
  const withSubmission = async (to: string) => {
    const review = clauses.find((c) => c.clause.clause_id === currentClauseId)
    if (!review) return
    // Results works on extracted terms. Before a run there are none yet, so ask for them now.
    if (!review.extraction) setBusy(`Extracting §${review.clause.source_span.section} first…`)
    const extraction = review.extraction ?? (await extractionFor(review.clause))
    session.submit({ clause: extraction.clause, fallback_reason: extraction.fallback_reason, edits: [] })
    navigate(to)
  }

  const chatPacket = () => (packet ? buildComparisonPacket(packet, graph, TRANSACTION_TIME) : '')
  const copyPacket = async () => {
    const text = chatPacket()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(`Copied ${text.length.toLocaleString('en-US')} characters`)
    } catch {
      setCopied('Copy was blocked. Use the download instead.')
    }
  }

  const decided = clauses.flatMap((c) => (c.evaluated ? [c.evaluated.report.decision] : []))
  const exportRecord = () => {
    if (!packet || !done) return
    const record = {
      product: 'Dryrun',
      notice: `${agreement.disclaimer} ${graph.disclaimer}`,
      agreement: { document_id: packet.agreement.meta.document_id, version: packet.agreement.meta.version, sha256: packet.agreement.sha256 },
      registry_version: version,
      transaction_time: TRANSACTION_TIME,
      decision: mostSevere(decided),
      clauses: clauses.map((c) => ({
        clause_id: c.clause.clause_id,
        section: c.clause.source_span.section,
        decision: c.evaluated!.report.decision,
        extraction_source: c.extraction!.clause.extraction_source,
        replay: c.evaluated!.report.replay,
        retest: retests[c.clause.clause_id]
          ? {
              proposals: c.plan?.proposals.map(({ field, from, to, capability_id }) => ({ field, from, to, capability_id })),
              decision: retests[c.clause.clause_id]!.report.decision,
              replay: retests[c.clause.clause_id]!.report.replay,
            }
          : null,
      })),
    }
    download(`dryrun-record.registry-v${version}.json`, JSON.stringify(record, null, 2), 'application/json')
  }

  if (run.readError) {
    return <p className="m-6 rounded border border-fail-rule bg-fail-soft px-4 py-3 text-sm text-fail">The document packet could not be read: {run.readError}</p>
  }
  if (!packet || !citations || !doc) return null

  const extracted = clauses.filter((c) => c.extraction)
  const live = extracted.filter((c) => c.extraction!.clause.extraction_source === 'nemotron').length
  const routes = clauses.reduce((n, c) => n + (c.evaluated ? firstResult(c.evaluated).candidate_paths.length : 0), 0)
  const counts = countDecisions(decided.map((decision) => ({ decision })))
  const entry = changelogEntry(graph).label.match(/^(v\d+) \((.+)\)$/)
  const running =
    phase === 'reading'
      ? `Reading ${packet.documents.length} documents…`
      : phase === 'extracting'
        ? `Extracting ${clauses.length} clauses…`
        : `Checking ${routes} routes…`
  const retested = Object.fromEntries(Object.entries(retests).map(([id, e]) => [id, e.report.decision]))
  const diagnostics = done
    ? `${packet.documents.length} files read in ${ms(packet.read_ms)} · ${citations.verified}/${citations.verified + citations.mismatched} citations verified · ${live} live, ${extracted.length - live} cached · ${routes} routes in ${ms(clauses.reduce((n, c) => n + (c.evaluated?.ms ?? 0), 0))}`
    : null

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper">
      <header className="flex shrink-0 items-center gap-4 border-b border-rule bg-sheet px-5 py-2.5">
        <p className="flex items-baseline gap-2.5 whitespace-nowrap">
          <span className="text-[0.95rem] font-semibold tracking-tight">Dryrun</span>
          <span className="text-xs text-ink-faint">Dry-run the loan before you sign.</span>
        </p>
        <div className="ml-auto flex items-center gap-4 whitespace-nowrap">
          {phase === 'idle' ? (
            <button type="button" data-control="run" onClick={start} className="rounded-md bg-ink px-4 py-1.5 text-sm font-semibold text-sheet hover:bg-ink-soft">
              Run dry run
            </button>
          ) : !done ? (
            <p role="status" data-testid="run-state" className="flex items-center gap-2 rounded-md bg-rule-soft px-4 py-1.5 text-sm font-semibold text-ink-soft">
              {running}
              {phase === 'extracting' && extracted.length > 0 && (
                <span className="font-normal">
                  {live > 0 && `${live} live`}
                  {live > 0 && extracted.length > live && ' · '}
                  {extracted.length > live && `${extracted.length - live} cached`}
                </span>
              )}
            </p>
          ) : (
            <p role="status" data-testid="run-state" className="text-sm">
              <span className="font-semibold">
                {counts.FAIL + counts.MANUAL} {counts.FAIL + counts.MANUAL === 1 ? 'finding' : 'findings'} · {counts.FAIL} fail · {counts.MANUAL}{' '}
                {counts.MANUAL === 1 ? 'needs' : 'need'} a person · {counts.PASS} pass
              </span>{' '}
              <button type="button" data-control="run" onClick={runAgain} className="ml-1.5 text-ink-soft underline underline-offset-2 hover:text-ink">
                Run again
              </button>
            </p>
          )}
          <p data-testid="registry-label" className="text-xs text-ink-faint">
            Registry {entry ? `${entry[1]} · ${entry[2]}` : `v${version}`} · {citations.verified}/{citations.verified + citations.mismatched} citations verified
          </p>
          <button
            type="button"
            data-control="demo"
            aria-haspopup="dialog"
            onClick={() => setDrawer(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-ink-soft hover:bg-rule-soft hover:text-ink"
          >
            <FlaskConical aria-hidden className="size-4" />
            Demo tools
          </button>
        </div>
      </header>

      <main id="main" className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_28.75rem]">
        <section aria-label={doc.meta.kind === 'agreement' ? 'The agreement' : 'Bank procedure'} className="min-h-0 min-w-0">
          <AgreementPane
            doc={doc}
            clauses={clauses}
            verdicts={done}
            retested={retested}
            selectedClauseId={expandedId}
            spans={spans}
            onSelectClause={(id) => selectClause(id, 'document')}
            onBack={
              procedure
                ? () => {
                    setProcedure(null)
                    const back = clauses.find((c) => c.clause.clause_id === (focus?.clauseId ?? expandedId))
                    if (back) goTo(packet.agreement.meta.document_id, back.clause.start, null)
                  }
                : null
            }
          />
        </section>

        <aside aria-label="Findings" data-scroll="findings" className="min-h-0 overflow-y-auto border-l border-rule px-5 py-6">
          {done ? (
            <ul className="space-y-4">
              {clauses.map((c) => {
                const id = c.clause.clause_id
                // Only while "Try live again" has this clause's extraction in flight.
                if (!c.evaluated || !c.extraction) {
                  return <li key={id} className="rounded-lg border border-rule bg-sheet p-5 text-sm text-ink-soft">Extracting §{c.clause.source_span.section} again…</li>
                }
                return (
                  <FindingCard
                    key={id}
                    review={c}
                    graph={graph}
                    citations={citations}
                    expanded={expandedId === id}
                    retest={retests[id] ?? null}
                    onToggle={() => selectClause(id, 'card')}
                    onApply={() => applyFix(id)}
                    onOpenAgreement={(checkIndex) => {
                      setFocus({ clauseId: id, checkIndex })
                      setProcedure(null)
                      goTo(packet.agreement.meta.document_id, c.clause.start, null)
                    }}
                    onOpenProcedure={(checkIndex, passage) => {
                      setFocus({ clauseId: id, checkIndex })
                      setProcedure(passage)
                      goTo(passage.document_id, passage.paragraphs[0]!.start, null)
                    }}
                  />
                )
              })}
            </ul>
          ) : (
            <p className="text-sm leading-relaxed text-ink-soft">
              Run a dry run to check this agreement against the bank's verified capabilities
            </p>
          )}
        </aside>
      </main>

      <footer className="flex shrink-0 items-center gap-4 border-t border-rule bg-sheet px-5 py-1.5 text-xs text-ink-faint">
        <p className="min-w-0 truncate" title={`${agreement.disclaimer} ${capabilityGraph.disclaimer}`}>
          <span className="font-semibold text-ink-soft">Synthetic data</span> built for a hackathon demonstration. Not a real credit agreement, not
          any real bank's operations, and not legal or financial advice.
        </p>
        <button
          type="button"
          data-control="export"
          disabled={!done}
          title={done ? 'Download the replay record of this run as JSON' : 'Run a dry run first'}
          onClick={exportRecord}
          className="ml-auto shrink-0 text-ink-soft underline underline-offset-2 hover:text-ink disabled:cursor-not-allowed disabled:text-ink-faint disabled:no-underline"
        >
          Export record
        </button>
      </footer>

      {drawer && (
        <DemoDrawer
          version={version}
          clauses={clauses}
          diagnostics={diagnostics}
          copied={copied}
          busy={busy}
          onClose={closeDrawer}
          onVersion={switchVersion}
          onCopyPacket={copyPacket}
          onDownloadPacket={() => download(`dryrun-chat-packet.registry-v${version}.txt`, chatPacket(), 'text/plain')}
          onChallenge={() => void withSubmission('/results#challenge-title')}
          onWatchRun={() => navigate(`/run/${currentClauseId}${version === BASE_VERSION ? '' : `?v=${version}`}`)}
          onTechnical={() => void withSubmission('/results')}
          onWorkspace={() => navigate(`/workspace${version === BASE_VERSION ? '' : `?v=${version}`}`)}
          onRetryLive={(clauseId) => {
            // New terms invalidate a re-test of the old ones.
            setRetests(({ [clauseId]: _stale, ...rest }) => rest)
            if (focus?.clauseId === clauseId) setFocus(null)
            run.retryLive(clauseId)
          }}
        />
      )}
    </div>
  )
}
