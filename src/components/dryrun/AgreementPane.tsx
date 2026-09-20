import { ArrowRight } from 'lucide-react'
import { Badge, decisionTone } from '@/components/ui/badge'
import { paragraphAnchor } from '@/components/workspace/DocumentViewer'
import { Marked, type ToneSpan } from '@/components/workspace/Marked'
import type { PacketDocument } from '@/documents/packet'
import type { Decision } from '@/domain/types'
import { cn } from '@/lib/cn'
import type { ClauseReview } from '@/lib/useAgreementReview'

/** A verdict pill. With `from`, the earlier verdict stays beside it: FAIL → PASS. `arrive` animates it in. */
export function VerdictPill({
  decision,
  from,
  arrive = from !== undefined,
  className,
}: {
  decision: Decision
  from?: Decision
  arrive?: boolean
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {from && (
        <>
          <Badge tone={decisionTone(from)} className="px-2 py-0 opacity-60">{from}</Badge>
          <ArrowRight aria-hidden className="size-3 text-ink-faint" />
        </>
      )}
      {/* Keyed on the verdict so a re-test remounts the pill and the arrival animation plays once. */}
      <Badge key={decision} tone={decisionTone(decision)} className={cn('px-2 py-0', arrive && 'animate-verdict-in')}>
        {decision}
      </Badge>
    </span>
  )
}

/**
 * The document on the left. For the agreement, the clauses in scope carry their
 * verdict in the margin once a run has finished, and the pill is the way to the
 * finding. A bank procedure is only ever shown because a finding cited it.
 */
export function AgreementPane({
  doc,
  clauses,
  found,
  swept,
  stamped,
  still,
  retested,
  selectedClauseId,
  spans,
  onSelectClause,
  onBack,
  backLabel = 'Back to the agreement',
}: {
  doc: PacketDocument
  clauses: ClauseReview[]
  /** Clauses the run has found so far: outlined in place. Empty before a run: a plain document. */
  found: ReadonlySet<string>
  /** Clauses whose extraction has landed: the highlight sweeps across them once. */
  swept: ReadonlySet<string>
  /** Clauses whose verdict has been stamped on their card: the same pill, the same moment, in the margin. */
  stamped: ReadonlySet<string>
  still: boolean
  /** clause_id -> the verdict of its re-tested fix. */
  retested: Record<string, Decision>
  selectedClauseId: string | null
  spans: ToneSpan[]
  onSelectClause: (clauseId: string) => void
  /** Present when a procedure is open: the way back to the agreement. */
  onBack: (() => void) | null
  backLabel?: string
}) {
  const isAgreement = doc.meta.kind === 'agreement'
  const byStart = new Map(isAgreement ? clauses.map((c) => [c.clause.start, c]) : [])
  let page = 0
  let article: string | null = null

  return (
    <div data-scroll="document" className="h-full overflow-y-auto px-6 py-6">
      <article className="relative mx-auto max-w-[47rem] rounded border border-rule bg-sheet py-8 pr-10 pl-24 shadow-sm">
        <p className="text-xs text-ink-faint">
          {onBack && (
            <>
              <button type="button" onClick={onBack} className="text-ink-soft underline underline-offset-2 hover:text-ink">
                {backLabel}
              </button>
              {' · '}
            </>
          )}
          {doc.meta.title} · version {doc.meta.version} · dated {doc.meta.dated}
        </p>
        {doc.sections.map((s) => {
          const newArticle = s.article !== article
          article = s.article
          return (
            <section key={s.id}>
              {s.page !== page && (page = s.page) && <PageRule page={s.page} of={doc.pages} />}
              {newArticle && s.article && (
                <h3 className="mt-5 mb-2 text-center font-serif text-[0.95rem] font-semibold tracking-wide uppercase">{s.article}</h3>
              )}
              <h4 className="mt-4 font-serif text-[0.98rem] font-semibold">
                {s.id.startsWith('0.') ? '' : `${s.id} `}
                {s.title}
              </h4>
              {s.paragraphs.map((p) => {
                const review = byStart.get(p.start)
                const pageBreak = p.page !== page ? ((page = p.page), true) : false
                const id = review?.clause.clause_id
                const decision = id !== undefined && stamped.has(id) ? review?.evaluated?.report.decision : undefined
                const outlined = id !== undefined && found.has(id) && !decision
                const selected = id !== undefined && id === selectedClauseId
                return (
                  <div key={p.start}>
                    {pageBreak && <PageRule page={p.page} of={doc.pages} />}
                    <div
                      id={paragraphAnchor(doc.meta.document_id, p.start)}
                      onClick={decision && id ? () => onSelectClause(id) : undefined}
                      className={cn(
                        'relative mt-2 scroll-mt-6',
                        decision && 'cursor-pointer',
                        selected && decision && '-mx-2 rounded bg-rule-soft/70 px-2',
                        outlined && '-mx-2 animate-rise-in rounded px-2 outline outline-1 outline-accent/70',
                      )}
                      data-found={outlined || undefined}
                    >
                      {id !== undefined && swept.has(id) && (
                        // One pass, left to right, then it fades: the clause this response was about.
                        <span aria-hidden data-sweep={id} className="pointer-events-none absolute -inset-x-2 inset-y-0 origin-left animate-draw rounded bg-mark/70 mix-blend-multiply" />
                      )}
                      {decision && id && (
                        <button
                          type="button"
                          data-doc-pill={id}
                          aria-label={`§${review.clause.source_span.section}: ${retested[id] ?? decision}. Show this finding.`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectClause(id)
                          }}
                          className={cn('absolute top-0.5 flex w-[4.75rem] justify-end rounded-full', selected ? '-left-[5rem]' : '-left-[5.5rem]')}
                        >
                          <VerdictPill decision={retested[id] ?? decision} arrive={!still} />
                        </button>
                      )}
                      <p className="font-serif text-[0.95rem] leading-relaxed text-pretty">
                        {p.label && <span className="mr-1.5">({p.label})</span>}
                        <Marked text={p.text} offset={p.start} spans={spans} />
                      </p>
                    </div>
                  </div>
                )
              })}
            </section>
          )
        })}
      </article>
    </div>
  )
}

function PageRule({ page, of }: { page: number; of: number }) {
  return (
    <div className="my-5 flex items-center gap-3 text-[0.68rem] text-ink-faint">
      <span className="h-px flex-1 bg-rule" />
      Page {page} of {of}
      <span className="h-px flex-1 bg-rule" />
    </div>
  )
}
