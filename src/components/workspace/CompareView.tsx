import { ArrowUpRight, CircleCheck, CircleHelp } from 'lucide-react'
import { DECISION_TEXT } from '@/components/results/Verdict'
import { cn } from '@/lib/cn'
import type { EvidencePassage, Span } from '@/documents/citations'
import type { PacketDocument, ScopedClause } from '@/documents/packet'
import type { CheckResult, Requirement } from '@/domain/types'
import { bankSide, findingTitle, requiredSide } from '@/lib/findingText'
import { Marked, type MarkTone } from './Marked'

const VERDICT_TONE: Record<CheckResult['verdict'], MarkTone> = { FAIL: 'fail', MANUAL: 'manual', PASS: 'pass' }

/** The agreement passage and the policy passage behind one check, side by side. */
export function CompareView({
  check,
  requirement,
  clause,
  agreement,
  term,
  passages,
  onOpen,
}: {
  check: CheckResult
  requirement: Requirement
  clause: ScopedClause
  agreement: PacketDocument
  /** Where the clause states the term. null: the clause does not state it. */
  term: Span | null
  passages: EvidencePassage[]
  onOpen: (documentId: string, start: number) => void
}) {
  const bank = bankSide(check)
  return (
    <div data-scroll="compare" className="h-full overflow-y-auto bg-paper px-4 py-4">
      <div className="mx-auto max-w-[64rem]">
        <div className="rounded border border-rule bg-sheet px-4 py-3">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
            <span className={DECISION_TEXT[check.verdict]}>{check.verdict}</span>
            {check.verdict === 'PASS' ? `${check.field} is supported on this route` : findingTitle(check, requirement)}
          </p>
          <dl className="mt-1.5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex gap-2"><dt className="text-ink-faint">{requiredSide(check)}</dt><dd className="font-medium">{check.required}</dd></div>
            <div className="flex gap-2"><dt className="text-ink-faint">{bank.label}</dt><dd className="font-medium">{bank.value}</dd></div>
          </dl>
          <p className="mt-1.5 text-xs text-ink-soft">{check.reason}</p>
        </div>

        <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
          <Passage
            heading="Agreement"
            source={`${agreement.meta.document_id} · ${agreement.meta.version} · §${clause.source_span.section} · page ${clause.source_span.page}`}
            onOpen={() => onOpen(agreement.meta.document_id, clause.start)}
            footer={
              term
                ? null
                : requiredSide(check) === 'Agreement'
                  ? 'The clause does not state this term. Nothing is highlighted because there is nothing to quote.'
                  : 'This requirement comes from the bank route the clause needs, not from words in the clause.'
            }
          >
            <p>
              <Marked text={clause.source_text} offset={clause.start} spans={term ? [{ ...term, tone: VERDICT_TONE[check.verdict] }] : []} />
            </p>
          </Passage>

          <div className="space-y-3">
            {passages.length === 0 && (
              <p className="rounded border border-dashed border-rule bg-sheet px-4 py-6 text-sm text-ink-soft">
                No document in this packet supports capability record {check.capability_id}. The bank value comes from the
                bank's capability record alone.
              </p>
            )}
            {passages.map((p) => (
              <Passage
                key={`${p.record_id}-${p.section.id}`}
                heading="Bank policy"
                source={`${p.document_id} · version ${p.document_version} · §${p.section.id} ${p.section.title} · page ${p.section.page}`}
                onOpen={() => onOpen(p.document_id, p.paragraphs[0]!.start)}
                footer={
                  <span className={cn('inline-flex items-center gap-1', p.verified ? 'text-pass' : 'text-manual')}>
                    {p.verified ? <CircleCheck aria-hidden className="size-3.5" /> : <CircleHelp aria-hidden className="size-3.5" />}
                    {p.verified
                      ? `Capability record ${p.record_id}: the highlighted words match its stored values.`
                      : `Capability record ${p.record_id} cites this section, but its values were not all found in the text.`}
                  </span>
                }
              >
                {p.paragraphs.map((para) => (
                  <p key={para.start} className="mt-2 first:mt-0">
                    <Marked text={para.text} offset={para.start} spans={p.highlights.map((h) => ({ ...h, tone: 'evidence' as const }))} />
                  </p>
                ))}
              </Passage>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Passage({
  heading,
  source,
  onOpen,
  footer,
  children,
}: {
  heading: string
  source: string
  onOpen: () => void
  footer: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded border border-rule bg-sheet">
      <header className="flex items-start gap-2 border-b border-rule bg-rule-soft/60 px-3 py-1.5">
        <div className="min-w-0">
          <p className="text-xs font-semibold">{heading}</p>
          <p className="font-mono text-[0.68rem] text-ink-faint">{source}</p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium text-accent hover:bg-accent-soft"
        >
          Open in document
          <ArrowUpRight aria-hidden className="size-3.5" />
        </button>
      </header>
      <div className="px-4 py-3 font-serif text-[0.95rem] leading-relaxed text-pretty">{children}</div>
      {footer && <p className="border-t border-rule-soft px-3 py-1.5 text-[0.72rem] text-ink-soft">{footer}</p>}
    </section>
  )
}
