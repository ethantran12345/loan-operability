import { useState } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { PathSearch } from '@/components/run/parts'
import { Id } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Marked, type MarkTone } from '@/components/workspace/Marked'
import { evidenceForCheck, type CitationIndex, type EvidencePassage, type Span } from '@/documents/citations'
import { locateTerm } from '@/documents/locate'
import type { CapabilityGraph, CheckResult } from '@/domain/types'
import { cn } from '@/lib/cn'
import { OUTCOME_HEADLINE, bankSide, findingTitle, nextAction, requiredSide } from '@/lib/findingText'
import { humanize } from '@/lib/format'
import { decisivePath, firstResult, type ClauseReview, type Evaluated } from '@/lib/useAgreementReview'
import { VerdictPill } from './AgreementPane'

const TONE: Record<CheckResult['verdict'], MarkTone> = { FAIL: 'fail', MANUAL: 'manual', PASS: 'pass' }
const EDGE: Record<CheckResult['verdict'], string> = { FAIL: 'border-l-fail', MANUAL: 'border-l-manual', PASS: 'border-l-pass' }

/** The check a collapsed card leads with: the hardest conflict, or for a PASS the amount. */
export function leadCheck(checks: CheckResult[]): CheckResult | undefined {
  return (
    checks.find((k) => k.verdict === 'FAIL') ??
    checks.find((k) => k.verdict === 'MANUAL') ??
    checks.find((k) => k.field === 'amount.value') ??
    checks[0]
  )
}

const agreementLabel = (check: CheckResult) => (requiredSide(check) === 'Agreement' ? 'Agreement says' : 'Route needs')
const bankValue = (check: CheckResult) => (check.field === 'amount.value' ? `up to ${bankSide(check).value}` : bankSide(check).value)

/** The product in one glance: what the agreement says, against what the bank supports. */
function Pair({ check, large = false }: { check: CheckResult; large?: boolean }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4">
      {[
        { label: agreementLabel(check), value: check.required },
        { label: 'Bank supports', value: bankValue(check) },
      ].map((side) => (
        <div key={side.label} className="min-w-0">
          <dt className="text-xs text-ink-faint">{side.label}</dt>
          {/* The weight is for a value that reads at a glance; a sentence stays at body size. */}
          <dd className={cn('leading-snug font-semibold text-pretty', large && side.value.length <= 28 ? 'text-[1.05rem]' : 'text-sm')}>{side.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The words around the marked spans, so a passage fits a card. Offsets stay in document coordinates. */
function excerpt(text: string, offset: number, spans: Span[], pad = 70) {
  const inside = spans.filter((s) => s.start >= offset && s.end <= offset + text.length)
  if (inside.length === 0) return { text: text.length > 220 ? `${text.slice(0, text.lastIndexOf(' ', 220))}…` : text, offset, lead: false }
  let from = Math.max(0, Math.min(...inside.map((s) => s.start)) - offset - pad)
  let to = Math.min(text.length, Math.max(...inside.map((s) => s.end)) - offset + pad)
  if (from > 0) from = text.indexOf(' ', from) + 1
  if (to < text.length) to = text.lastIndexOf(' ', to)
  return { text: `${text.slice(from, to)}${to < text.length ? '…' : ''}`, offset: offset + from, lead: from > 0 }
}

function Passage({ heading, source, text, offset, spans, tone, note, link, onOpen }: {
  heading: string
  source: string
  text: string | null
  offset: number
  spans: Span[]
  tone: MarkTone
  note?: string
  link: string
  onOpen: () => void
}) {
  const cut = text === null ? null : excerpt(text, offset, spans)
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold">{heading}</p>
      <p className="text-[0.7rem] leading-snug text-ink-faint">{source}</p>
      {cut && (
        <p className="mt-1 font-serif text-[0.82rem] leading-snug text-pretty">
          {cut.lead && '…'}
          <Marked text={cut.text} offset={cut.offset} spans={spans.map((s) => ({ ...s, tone }))} />
        </p>
      )}
      {note && <p className="mt-1 text-[0.72rem] leading-snug text-ink-soft">{note}</p>}
      <button type="button" onClick={onOpen} className="mt-1 text-[0.72rem] text-ink-soft underline underline-offset-2 hover:text-ink">
        {link}
      </button>
    </div>
  )
}

export function FindingCard({
  review,
  graph,
  citations,
  expanded,
  retest,
  onToggle,
  onApply,
  onOpenAgreement,
  onOpenProcedure,
}: {
  review: ClauseReview
  graph: CapabilityGraph
  citations: CitationIndex
  expanded: boolean
  retest: Evaluated | null
  onToggle: () => void
  onApply: () => void
  onOpenAgreement: (checkIndex: number) => void
  onOpenProcedure: (checkIndex: number, passage: EvidencePassage) => void
}) {
  const [routes, setRoutes] = useState(false)
  const { clause, extraction, plan } = review
  const evaluated = review.evaluated!
  const result = firstResult(evaluated)
  const requirement = extraction!.clause.requirements[0]!
  const checks = decisivePath(evaluated)?.checks ?? []
  const lead = leadCheck(checks)
  const decision = evaluated.report.decision
  // The pairs are the checks that decide the verdict: the conflicts of a FAIL, the open
  // questions of a MANUAL. A FAIL's open questions follow in one line. The index stays the check's own.
  const indexed = checks.map((check, index) => ({ check, index }))
  const conflicts = indexed.filter((x) => x.check.verdict === decision && decision !== 'PASS')
  const alsoOpen = indexed.filter((x) => x.check.verdict !== 'PASS' && x.check.verdict !== decision)
  const left = retest ? (decisivePath(retest)?.checks ?? []).filter((k) => k.verdict !== 'PASS') : []

  return (
    <li data-clause={clause.clause_id} className={cn('rounded-lg border bg-sheet', expanded ? 'border-ink-faint' : 'border-rule')}>
      <button type="button" data-control="card" aria-expanded={expanded} onClick={onToggle} className="block w-full rounded-lg p-5 text-left">
        <span className="flex items-center gap-2">
          <VerdictPill decision={retest?.report.decision ?? decision} from={retest ? decision : undefined} />
          <span className="font-serif text-sm font-semibold">§{clause.source_span.section}</span>
          <ChevronRight aria-hidden className={cn('ml-auto size-4 text-ink-faint transition-transform', expanded && 'rotate-90')} />
        </span>
        <span className="mt-2 block text-sm text-ink-soft">
          {decision === 'PASS' || !lead ? OUTCOME_HEADLINE.PASS : findingTitle(lead, requirement)}
        </span>
        {lead && <span className="mt-3 block"><Pair check={lead} large /></span>}
      </button>

      {expanded && (
        <div className="space-y-5 border-t border-rule-soft px-5 pt-4 pb-5">
          {conflicts.length === 0 ? (
            <p className="text-sm text-ink-soft">All {checks.length} checks pass on one route. No action needed.</p>
          ) : (
            <ol className="space-y-4">
              {conflicts.map(({ check, index }) => {
                const passages = evidenceForCheck(check, citations, graph)
                const term = locateTerm(clause.source_text, clause.start, check.field)
                return (
                  <li key={index} data-pair className={cn('border-l-2 pl-3', EDGE[check.verdict])}>
                    <p className="mb-1.5 text-sm font-semibold">{findingTitle(check, requirement)}</p>
                    <Pair check={check} />
                    <div className="mt-2.5 grid grid-cols-2 gap-x-4">
                      <Passage
                        heading="Agreement"
                        source={`§${clause.source_span.section} · page ${clause.source_span.page}`}
                        text={term ? clause.source_text : null}
                        offset={clause.start}
                        spans={term ? [term] : []}
                        tone={TONE[check.verdict]}
                        note={
                          term
                            ? undefined
                            : requiredSide(check) === 'Agreement'
                              ? 'The clause does not state this term, so there is nothing to quote.'
                              : 'This comes from the bank route the clause needs, not from words in the clause.'
                        }
                        link="Open in agreement"
                        onOpen={() => onOpenAgreement(index)}
                      />
                      <div className="min-w-0 space-y-2">
                        {passages.length === 0 && (
                          <p className="text-[0.72rem] leading-snug text-ink-soft">
                            No procedure in the packet is cited for this. The bank value comes from the registry record alone.
                          </p>
                        )}
                        {passages.map((p) => {
                          const para = p.paragraphs.find((x) => p.highlights.some((h) => h.start >= x.start && h.end <= x.start + x.text.length)) ?? p.paragraphs[0]
                          return (
                            <Passage
                              key={`${p.record_id}-${p.section.id}`}
                              heading="Bank procedure"
                              source={`${p.document_id} ${p.document_version} · §${p.section.id} ${p.section.title}`}
                              text={para?.text ?? null}
                              offset={para?.start ?? 0}
                              spans={p.highlights}
                              tone={TONE[check.verdict]}
                              link="Open in procedure"
                              onOpen={() => onOpenProcedure(index, p)}
                            />
                          )
                        })}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
          {alsoOpen.length > 0 && (
            <p className="text-sm text-ink-soft">
              Also open: {alsoOpen.map((x) => findingTitle(x.check, requirement).toLowerCase()).join(', ')}.
            </p>
          )}

          {plan && plan.proposals.length > 0 ? (
            <div>
              <p className="text-xs font-semibold">{retest ? 'Changes applied in the re-test' : 'Proposed changes'}</p>
              <ul className="mt-1.5 space-y-1.5">
                {plan.proposals.map((p) => (
                  <li key={p.field} className="text-sm">
                    <span className="text-ink-soft">{humanize(p.field)}: </span>
                    <span className="text-ink-soft line-through">{p.from}</span> <ArrowRight aria-hidden className="inline size-3 text-ink-faint" />{' '}
                    <span className="font-semibold">{p.to}</span> <Id className="whitespace-nowrap">{p.capability_id}</Id>
                  </li>
                ))}
              </ul>
              {retest ? (
                <p data-testid="retest" className="mt-3 text-sm text-ink-soft">
                  {retest.report.decision === 'PASS'
                    ? 'With these changes the clause fits one complete route. The agreement itself is unchanged until it is redrafted.'
                    : `Still ${retest.report.decision} after these changes: ${left.map((k) => humanize(k.field).toLowerCase()).join(', ')}.`}
                </p>
              ) : (
                <>
                  <Button data-control="apply" className="mt-3 w-full" onClick={onApply}>Apply fix and re-test</Button>
                  <p className="mt-1.5 text-xs text-ink-faint">Suggested drafting from the bank's verified limits. Not approval.</p>
                </>
              )}
            </div>
          ) : (
            decision !== 'PASS' && plan && <p className="text-sm">{nextAction(result, plan)}</p>
          )}

          <div>
            <button
              type="button"
              aria-expanded={routes}
              onClick={() => setRoutes((v) => !v)}
              className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
            >
              {routes ? 'Hide route search' : 'Show route search'}
            </button>
            {routes && (
              <div className="mt-3">
                <PathSearch paths={result.candidate_paths} selectedId={result.selected_path_id} shown={result.candidate_paths.length} dense narrow animate={false} />
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
