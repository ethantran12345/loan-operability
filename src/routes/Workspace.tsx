import { useEffect, useMemo, useState } from 'react'
import { ClipboardCopy, Download, RotateCcw } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { GRAPH_VERSIONS, changelogEntry } from '@/components/results/GraphVersion'
import { CompareView } from '@/components/workspace/CompareView'
import { DocumentTray } from '@/components/workspace/DocumentTray'
import { DocumentViewer, paragraphAnchor } from '@/components/workspace/DocumentViewer'
import { EMPTY_REVIEW, FindingsPanel, type EmployeeReview, type Focus } from '@/components/workspace/FindingsPanel'
import type { ToneSpan } from '@/components/workspace/Marked'
import { ProgressStrip, type StripStep } from '@/components/workspace/ProgressStrip'
import { TRANSACTION_TIME, capabilityGraph, capabilityGraphs } from '@/domain/fixtures'
import { applyRepairs } from '@/domain/repair'
import { buildComparisonPacket } from '@/documents/bundle'
import { evidenceForCheck } from '@/documents/citations'
import { locateTerm } from '@/documents/locate'
import { cn } from '@/lib/cn'
import { ms } from '@/lib/runFormat'
import { useReviewSession } from '@/lib/session'
import { decisivePath, firstResult, timedEvaluate, useAgreementReview } from '@/lib/useAgreementReview'

const BASE_VERSION = capabilityGraph.version
const TONE = { FAIL: 'fail', MANUAL: 'manual', PASS: 'pass' } as const

export function Workspace() {
  const navigate = useNavigate()
  const session = useReviewSession()
  const [search, setSearch] = useSearchParams()
  const asked = Number(search.get('v'))
  const version = asked in capabilityGraphs ? asked : BASE_VERSION
  const graph = capabilityGraphs[version]!
  const otherVersion = GRAPH_VERSIONS.find((v) => v !== version) ?? null

  const run = useAgreementReview(version)
  const { packet, citations, clauses } = run

  const [documentId, setDocumentId] = useState<string | null>(null)
  const [mode, setMode] = useState<'document' | 'compare'>('document')
  const [chosenClauseId, setChosenClauseId] = useState<string | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [reviews, setReviews] = useState<Record<string, EmployeeReview>>({})
  const [jump, setJump] = useState<{ anchor: string; n: number } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const selectedClauseId = chosenClauseId ?? clauses[0]?.clause.clause_id ?? null
  const doc = packet?.documents.find((d) => d.meta.document_id === documentId) ?? packet?.agreement ?? null

  // Navigation the employee asked for. Nothing else in this view moves the scroll position.
  useEffect(() => {
    if (!jump) return
    document.getElementById(jump.anchor)?.scrollIntoView({ block: 'center' })
  }, [jump])

  // The check in focus, with both sides of its evidence.
  const focused = useMemo(() => {
    if (!focus || !packet || !citations) return null
    const review = clauses.find((c) => c.clause.clause_id === focus.clauseId)
    const check = review?.evaluated && decisivePath(review.evaluated)?.checks[focus.checkIndex]
    if (!review || !review.extraction || !check) return null
    return {
      review,
      check,
      requirement: review.extraction.clause.requirements[0]!,
      term: locateTerm(review.clause.source_text, review.clause.start, check.field),
      passages: evidenceForCheck(check, citations, graph),
    }
  }, [focus, packet, citations, clauses, graph])

  const spans = useMemo<ToneSpan[]>(() => {
    if (!focused || !doc) return []
    if (doc.meta.kind === 'agreement') return focused.term ? [{ ...focused.term, tone: TONE[focused.check.verdict] }] : []
    return focused.passages
      .filter((p) => p.document_id === doc.meta.document_id)
      .flatMap((p) => p.highlights.map((h) => ({ ...h, tone: 'evidence' as const })))
  }, [focused, doc])

  const openAt = (docId: string, start: number) => {
    setDocumentId(docId)
    setMode('document')
    setJump((j) => ({ anchor: paragraphAnchor(docId, start), n: (j?.n ?? 0) + 1 }))
  }

  const selectClause = (clauseId: string) => {
    setChosenClauseId(clauseId)
    const review = clauses.find((c) => c.clause.clause_id === clauseId)
    if (review && packet) openAt(packet.agreement.meta.document_id, review.clause.start)
    if (focus?.clauseId !== clauseId) setFocus(null)
  }

  const patchReview = (clauseId: string, patch: Partial<EmployeeReview>) =>
    setReviews((r) => ({ ...r, [clauseId]: { ...(r[clauseId] ?? EMPTY_REVIEW), ...patch } }))

  const retest = (clauseId: string) => {
    const review = clauses.find((c) => c.clause.clause_id === clauseId)
    const employee = reviews[clauseId]
    if (!review?.extraction || !review.plan || !packet || !employee?.termsConfirmed || !employee.amendmentReviewed) return
    const chosen = review.plan.proposals.filter((_, i) => !employee.excluded.includes(i))
    const requirements = review.extraction.clause.requirements.map((r, i) => (i === 0 ? applyRepairs(r, chosen) : r))
    patchReview(clauseId, {
      retest: timedEvaluate({ ...review.extraction.clause, requirements }, graph, `${packet.agreement.meta.version}+proposed-amendment`),
    })
  }

  const reproduce = (clauseId: string) => {
    const e = clauses.find((c) => c.clause.clause_id === clauseId)?.evaluated
    if (!e) return
    const again = timedEvaluate(e.clause, e.graph, e.agreementVersion)
    patchReview(clauseId, { reproduced: { identical: JSON.stringify(again.report) === JSON.stringify(e.report), ms: again.ms } })
  }

  const openTechnical = (clauseId: string) => {
    const extraction = clauses.find((c) => c.clause.clause_id === clauseId)?.extraction
    if (!extraction) return
    session.submit({ clause: extraction.clause, fallback_reason: extraction.fallback_reason, edits: [] })
    navigate('/results')
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
  const downloadPacket = () => {
    const url = URL.createObjectURL(new Blob([chatPacket()], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `loan-operability-chat-packet.registry-v${version}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const rerun = () => {
    setReviews({})
    setFocus(null)
    setMode('document')
    run.rerun()
  }

  // Progress: every label below is a count or a time from the operation itself.
  const extracted = clauses.filter((c) => c.extraction)
  const live = extracted.filter((c) => c.extraction!.clause.extraction_source === 'nemotron').length
  const routes = clauses.reduce((n, c) => n + (c.evaluated ? firstResult(c.evaluated).candidate_paths.length : 0), 0)
  const engineMs = clauses.reduce((n, c) => n + (c.evaluated?.ms ?? 0), 0)
  const reviewed = clauses.filter((c) => reviews[c.clause.clause_id]?.termsConfirmed).length
  const steps: StripStep[] = [
    {
      label: 'Read documents',
      state: run.steps.read,
      detail: packet && citations
        ? `${packet.documents.length} files · ${citations.verified}/${citations.verified + citations.mismatched} citations verified · ${ms(packet.read_ms)}`
        : (run.readError ?? ''),
    },
    {
      label: 'Extract terms',
      state: run.steps.extract,
      detail: run.steps.extract === 'done'
        ? `${live} live · ${extracted.length - live} cached${run.extractedUnderVersion !== version ? ' · reused, no model call' : ''}`
        : run.steps.extract === 'running' ? `${extracted.length} of ${clauses.length} clauses` : '',
    },
    {
      label: 'Check routes',
      state: run.steps.check,
      detail: routes > 0 ? `${routes} routes · ${ms(engineMs)}` : '',
    },
    {
      label: 'Review findings',
      state: run.steps.check !== 'done' ? 'pending' : reviewed === clauses.length ? 'done' : 'waiting',
      detail: run.steps.check === 'done' ? `${reviewed} of ${clauses.length} reviewed by you` : '',
    },
  ]

  if (run.readError) {
    return <p className="m-6 rounded border border-fail-rule bg-fail-soft px-4 py-3 text-sm text-fail">The document packet could not be read: {run.readError}</p>
  }
  if (!packet || !doc) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-rule bg-sheet px-3 py-1.5">
        <ProgressStrip steps={steps} />
        <div className="ml-auto flex items-center gap-2">
          {copied && <span role="status" className="text-xs text-ink-soft">{copied}</span>}
          <ToolbarButton onClick={copyPacket} title="The same documents and registry, as one text to paste into a chat model">
            <ClipboardCopy aria-hidden className="size-3.5" />
            Copy chat packet
          </ToolbarButton>
          <ToolbarButton onClick={downloadPacket} title="Download the chat packet as a text file">
            <Download aria-hidden className="size-3.5" />
          </ToolbarButton>
          <div role="radiogroup" aria-label="Bank capability registry version" className="inline-flex rounded-md border border-rule bg-rule-soft p-0.5">
            {GRAPH_VERSIONS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={v === version}
                title={changelogEntry(capabilityGraphs[v]!).text}
                onClick={() => setSearch(v === BASE_VERSION ? {} : { v: String(v) }, { replace: true })}
                className={cn('rounded px-2 py-0.5 text-xs font-semibold', v === version ? 'bg-sheet text-ink shadow-sm' : 'text-ink-soft hover:text-ink')}
              >
                Registry {changelogEntry(capabilityGraphs[v]!).label}
              </button>
            ))}
          </div>
          <ToolbarButton onClick={rerun} title="Read the packet and extract the clauses again">
            <RotateCcw aria-hidden className="size-3.5" />
            Run again
          </ToolbarButton>
        </div>
      </div>
      {version !== BASE_VERSION && (
        <p className="border-b border-manual-rule bg-manual-soft px-3 py-1 text-xs text-manual">
          <span className="font-semibold">Bank change, {changelogEntry(graph).label}:</span> {changelogEntry(graph).text}{' '}
          The same extracted terms were re-checked. No document was re-extracted and no model was called.
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[15.5rem_minmax(0,1fr)_23rem] 2xl:grid-cols-[17rem_minmax(0,1fr)_27rem]">
        <aside className="min-h-0 border-r border-rule bg-sheet">
          <DocumentTray
            packet={packet}
            citations={citations}
            otherVersion={otherVersion}
            extracting={clauses.length - extracted.length}
            selectedId={mode === 'document' ? doc.meta.document_id : ''}
            onSelect={(id) => {
              setDocumentId(id)
              setMode('document')
            }}
          />
        </aside>

        <section aria-label="Document viewer" className="flex min-h-0 min-w-0 flex-col">
          <div role="tablist" className="flex items-center gap-1 border-b border-rule bg-rule-soft/70 px-3 pt-1.5">
            <Tab active={mode === 'document'} onClick={() => setMode('document')}>Document</Tab>
            <Tab active={mode === 'compare'} disabled={!focused} onClick={() => setMode('compare')}>Compare evidence</Tab>
            {!focused && <span className="pb-1 pl-2 text-[0.7rem] text-ink-faint">Select a finding to compare the agreement with the bank policy.</span>}
          </div>
          <div className="min-h-0 flex-1">
            {mode === 'compare' && focused ? (
              <CompareView
                check={focused.check}
                requirement={focused.requirement}
                clause={focused.review.clause}
                agreement={packet.agreement}
                term={focused.term}
                passages={focused.passages}
                onOpen={openAt}
              />
            ) : (
              <DocumentViewer
                doc={doc}
                clauses={clauses}
                selectedClauseId={selectedClauseId}
                spans={spans}
                outOfScope={packet.out_of_scope_sections}
                onSelectClause={setChosenClauseId}
              />
            )}
          </div>
        </section>

        <aside aria-label="Findings" className="min-h-0 border-l border-rule bg-paper">
          <FindingsPanel
            clauses={clauses}
            version={version}
            reviews={reviews}
            selectedClauseId={selectedClauseId}
            focus={focus}
            onSelectClause={selectClause}
            onFocus={(f) => {
              setFocus(f)
              setChosenClauseId(f.clauseId)
              setMode('compare')
            }}
            onReview={patchReview}
            onRetest={retest}
            onReproduce={reproduce}
            onRetryLive={(clauseId) => {
              // New terms invalidate the employee's review of the old ones.
              setReviews(({ [clauseId]: _stale, ...rest }) => rest)
              if (focus?.clauseId === clauseId) setFocus(null)
              run.retryLive(clauseId)
            }}
            onOpenTechnical={openTechnical}
          />
        </aside>
      </div>
    </div>
  )
}

function ToolbarButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn('inline-flex items-center gap-1 rounded-md border border-rule bg-sheet px-2 py-1 text-xs font-semibold text-ink-soft hover:border-ink-faint hover:text-ink', className)}
      {...props}
    />
  )
}

function Tab({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-t-md border border-b-0 px-3 py-1 text-xs font-semibold',
        active ? 'border-rule bg-sheet text-ink' : 'border-transparent text-ink-soft hover:text-ink',
        disabled && 'cursor-not-allowed opacity-50 hover:text-ink-soft',
      )}
    >
      {children}
    </button>
  )
}
