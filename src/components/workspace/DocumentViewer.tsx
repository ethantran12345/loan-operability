import { Download } from 'lucide-react'
import { decisionTone, Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'
import type { PacketDocument } from '@/documents/packet'
import type { ClauseReview } from '@/lib/useAgreementReview'
import { Marked, type ToneSpan } from './Marked'

export const paragraphAnchor = (documentId: string, start: number) => `p-${documentId}-${start}`

function download(doc: PacketDocument) {
  const url = URL.createObjectURL(new Blob([doc.raw], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = doc.file
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * One packet document as it was read: pages, sections, exact paragraph text.
 * Serif is used for the document body only. Clauses in review scope carry their
 * status in the margin; marked spans are the evidence for the selected finding.
 */
export function DocumentViewer({
  doc,
  clauses,
  selectedClauseId,
  spans,
  outOfScope,
  onSelectClause,
}: {
  doc: PacketDocument
  clauses: ClauseReview[]
  selectedClauseId: string | null
  spans: ToneSpan[]
  outOfScope: number
  onSelectClause: (clauseId: string) => void
}) {
  const isAgreement = doc.meta.kind === 'agreement'
  const byStart = new Map(isAgreement ? clauses.map((c) => [c.clause.start, c]) : [])
  let page = 0
  let article: string | null = null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule bg-sheet px-4 py-2">
        <h2 className="text-sm font-semibold">{doc.meta.title}</h2>
        <span className="font-mono text-[0.7rem] text-ink-faint">
          {doc.meta.document_id} · version {doc.meta.version} · dated {doc.meta.dated} · {doc.sha256.slice(0, 19)}…
        </span>
        <button
          type="button"
          onClick={() => download(doc)}
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-ink-soft hover:bg-rule-soft hover:text-ink"
        >
          <Download aria-hidden className="size-3.5" />
          {doc.file}
        </button>
      </div>

      <div data-scroll="viewer" className="min-h-0 flex-1 overflow-y-auto bg-paper px-4 py-4">
        <article className="mx-auto max-w-[46rem] rounded border border-rule bg-sheet px-8 py-7 shadow-sm">
          <p className="mb-4 rounded border border-manual-rule bg-manual-soft px-2.5 py-1.5 text-[0.72rem] leading-snug text-manual">
            {doc.meta.notice}
          </p>
          {isAgreement && (
            <p className="mb-5 text-[0.72rem] leading-snug text-ink-soft">
              {clauses.length} clauses are in review scope (Article II borrowing mechanics) and are outlined below.
              The other {outOfScope} paragraphs were read and are shown, but are not extracted or checked.
            </p>
          )}
          {doc.sections.map((s) => {
            const newArticle = s.article !== article
            article = s.article
            return (
              <section key={s.id} className="font-serif">
                {s.page !== page && (page = s.page) && <PageRule page={s.page} of={doc.pages} />}
                {newArticle && s.article && (
                  <h3 className="mt-5 mb-2 text-center text-[0.95rem] font-semibold tracking-wide uppercase">{s.article}</h3>
                )}
                <h4 className="mt-4 text-[0.98rem] font-semibold">
                  {s.id.startsWith('0.') ? '' : `${s.id} `}
                  {s.title}
                </h4>
                {s.paragraphs.map((p) => {
                  const review = byStart.get(p.start)
                  const pageBreak = p.page !== page ? ((page = p.page), true) : false
                  const body = (
                    <>
                      {p.label && <span className="mr-1.5">({p.label})</span>}
                      <Marked text={p.text} offset={p.start} spans={spans} />
                    </>
                  )
                  return (
                    <div key={p.start}>
                      {pageBreak && <PageRule page={p.page} of={doc.pages} />}
                      {review ? (
                        <ScopedParagraph
                          id={paragraphAnchor(doc.meta.document_id, p.start)}
                          review={review}
                          active={review.clause.clause_id === selectedClauseId}
                          onSelect={() => onSelectClause(review.clause.clause_id)}
                        >
                          {body}
                        </ScopedParagraph>
                      ) : (
                        <p id={paragraphAnchor(doc.meta.document_id, p.start)} className="mt-2 scroll-mt-6 text-[0.95rem] leading-relaxed text-pretty">
                          {body}
                        </p>
                      )}
                    </div>
                  )
                })}
              </section>
            )
          })}
        </article>
      </div>
    </div>
  )
}

function PageRule({ page, of }: { page: number; of: number }) {
  return (
    <div className="my-5 flex items-center gap-3 font-sans text-[0.68rem] text-ink-faint">
      <span className="h-px flex-1 bg-rule" />
      Page {page} of {of}
      <span className="h-px flex-1 bg-rule" />
    </div>
  )
}

function ScopedParagraph({
  id,
  review,
  active,
  onSelect,
  children,
}: {
  id: string
  review: ClauseReview
  active: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  const decision = review.evaluated?.report.decision
  return (
    <div
      id={id}
      className={cn(
        'relative mt-2 scroll-mt-6 overflow-hidden rounded border-l-2 py-1.5 pr-2 pl-3',
        active ? 'border-accent bg-accent-soft/60' : 'border-ink-faint/40 bg-rule-soft/40',
      )}
    >
      <div className="mb-1 flex items-center gap-2 font-sans">
        <button type="button" onClick={onSelect} className="text-[0.7rem] font-semibold text-accent hover:underline">
          In review scope · §{review.clause.source_span.section}
        </button>
        {decision ? (
          <Badge tone={decisionTone(decision)} className="px-1.5 py-0 text-[0.65rem]">{decision}</Badge>
        ) : (
          <span className="text-[0.7rem] text-accent">extracting terms…</span>
        )}
      </div>
      <p className="text-[0.95rem] leading-relaxed text-pretty">{children}</p>
      {/* Decorative, and only while this clause's extraction call is really in flight. */}
      {!review.extraction && (
        <div aria-hidden className="document-scan pointer-events-none absolute inset-x-0 h-8 border-b border-accent/60 bg-gradient-to-b from-transparent to-accent/10" />
      )}
    </div>
  )
}
