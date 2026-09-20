import { useEffect, useState } from 'react'
import { Check, ChevronRight, User, X } from 'lucide-react'
import { Elapsed, PathSearch, Typewriter } from '@/components/run/parts'
import { Id } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Marked, type MarkTone } from '@/components/workspace/Marked'
import { GRAPH_VERSIONS, changelogEntry } from '@/components/results/GraphVersion'
import { evidenceForCheck, longDate, type CitationIndex, type EvidencePassage, type Span } from '@/documents/citations'
import { diffWording, locateTerm, type WordingSide } from '@/documents/locate'
import { TRANSACTION_TIME, capabilityGraphs } from '@/domain/fixtures'
import type { RepairProposal } from '@/domain/repair'
import type { CapabilityGraph, CheckResult } from '@/domain/types'
import { cn } from '@/lib/cn'
import { OUTCOME_HEADLINE, bankSide, fieldLabel, findingTitle, requiredSide } from '@/lib/findingText'
import { isOperational, resolutionFor, type Resolution } from '@/lib/resolution'
import { sourceDetail } from '@/lib/extractClient'
import { seconds, shortDate } from '@/lib/runFormat'
import { decisivePath, firstResult, type ClauseReview, type Evaluated } from '@/lib/useAgreementReview'
import { VerdictPill } from './AgreementPane'
import { cardPlan, revealed, routesCounted, type ChipChange, type ChipMark, type TermChip } from './reveal'

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
function Pair({ check }: { check: CheckResult }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4">
      {[
        { label: agreementLabel(check), value: check.required },
        { label: 'Bank supports', value: bankValue(check) },
      ].map((side) => (
        <div key={side.label} className="min-w-0">
          <dt className="text-xs text-ink-faint">{side.label}</dt>
          <dd className="text-sm leading-snug font-semibold text-pretty">{side.value}</dd>
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
  /** A passage that can be opened in the reader. The agreement's is already there: hovering the card marks it. */
  link?: string
  onOpen?: () => void
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
      {link && (
        <button type="button" onClick={onOpen} className="mt-1 text-[0.72rem] text-ink-soft underline underline-offset-2 hover:text-ink">
          {link}
        </button>
      )}
    </div>
  )
}

/** One side of a wording change, read like a line of a diff: a sign, the words, the changed words marked. */
function DiffSide({ sign, side, tone, fallback }: { sign: '−' | '+'; side: WordingSide | null; tone: MarkTone; fallback: string }) {
  return (
    <p className="flex min-w-0 gap-1.5">
      <span aria-hidden className={cn('font-mono text-xs leading-snug', tone === 'pass' ? 'text-pass' : 'text-fail')}>{sign}</span>
      {side ? (
        <span className="min-w-0 font-serif text-[0.82rem] leading-snug text-pretty">
          {side.lead && '…'}
          <Marked text={side.text} offset={0} spans={[{ ...side.mark, tone }]} />
          {side.more && '…'}
        </span>
      ) : (
        <span className="min-w-0 text-[0.72rem] leading-snug text-ink-soft">{fallback}</span>
      )}
    </p>
  )
}

/** The proposals as changes to the clause's own wording, one row per field, each naming the capability its value came from. */
function WordingDiffs({ clauseText, proposals }: { clauseText: string; proposals: RepairProposal[] }) {
  return (
    <div data-testid="wording-diff" className="mt-1.5">
      <p className="grid grid-cols-2 gap-x-4 text-xs text-ink-faint">
        <span>Current wording</span>
        <span>Proposed wording</span>
      </p>
      <ol className="mt-1 space-y-2">
        {proposals.map((p) => {
          const diff = diffWording(clauseText, p)
          return (
            <li key={p.field} data-diff={p.field} className="border-t border-rule-soft pt-1.5">
              <p className="mb-0.5 flex items-center gap-1.5 text-xs text-ink-soft">
                {fieldLabel(p.field)}
                <Id title={p.rationale} className="whitespace-nowrap">{p.capability_id}</Id>
              </p>
              <div className="grid grid-cols-2 gap-x-4">
                <DiffSide sign="−" side={diff.before} tone="fail" fallback="Not stated in the clause." />
                <DiffSide sign="+" side={diff.after} tone="pass" fallback={p.to} />
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

const SLOT_LABEL = 'text-xs font-semibold'
const OPERATIONAL_TAG = 'rounded-full border border-rule bg-rule-soft px-2 py-0 text-[0.68rem] font-semibold whitespace-nowrap text-ink-soft'

/**
 * The top slot of a finding no redraft can fix: what does resolve it, called what it is.
 * A lapsed authority is the bank's state to change; a human step is a person's to take. Neither is wording.
 */
function OperationalFix({ resolution, requirement, onSwitchVersion }: {
  resolution: Exclude<Resolution, { kind: 'redraft' }>
  requirement: Parameters<typeof findingTitle>[1]
  onSwitchVersion: (version: number) => void
}) {
  if (resolution.kind === 'escalate') return <p data-testid="next-action" className="text-sm">{resolution.action}</p>

  if (resolution.kind === 'person') {
    return (
      <div data-testid="resolution" data-resolution="person">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={SLOT_LABEL}>Resolution · a person's step</span>
          <span className={cn(OPERATIONAL_TAG, 'ml-auto')}>Operational, not a redraft</span>
        </p>
        <ul className="mt-1.5 space-y-1">
          {resolution.steps.map((step, i) => (
            <li key={i} data-step className="text-sm leading-snug text-pretty">
              <span className="font-semibold">{step.text.charAt(0).toUpperCase() + step.text.slice(1)}</span>
              <span className="text-ink-soft">
                {step.owner && ` · ${step.owner}`}
                {step.sla_business_days != null && ` · ${step.sla_business_days} business ${step.sla_business_days === 1 ? 'day' : 'days'}`}
              </span>
              {step.lapsed_under && (
                <span className="block text-xs text-ink-soft">
                  This authority is in force under the bank capabilities tested here. Under v{step.lapsed_under.version} it expired {longDate(step.lapsed_under.expired)}, and the clause failed.
                </span>
              )}
            </li>
          ))}
        </ul>
        <p data-testid="next-action" className="mt-2 text-sm">{resolution.action}</p>
      </div>
    )
  }

  const { lapsed, demonstration: demo } = resolution
  const entry = demo && changelogEntry(capabilityGraphs[demo.version]!)
  const dated = entry?.label.match(/^(v\d+) \((.+)\)$/)
  return (
    <div data-testid="resolution" data-resolution="bank_state">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={SLOT_LABEL}>Resolution · the bank's approved state</span>
        <span className={cn(OPERATIONAL_TAG, 'ml-auto')}>Operational, not a redraft</span>
      </p>
      {lapsed.map((a) => (
        <p key={a.approval_id} data-lapsed={a.approval_id} className="mt-1.5 text-sm leading-snug text-pretty">
          {a.document_id ? `${a.document_id}'s delegated ${a.role} authority` : `The delegated ${a.role} authority`} (<Id>{a.approval_id}</Id>) expired{' '}
          <span className="font-semibold">{a.expired}</span>. Renewing it resolves this.
        </p>
      ))}
      <p data-testid="next-action" className="mt-1 text-sm text-ink-soft">{resolution.action}</p>
      {demo && GRAPH_VERSIONS.includes(demo.version) && (
        <div data-testid="bank-state-demo" className="mt-2.5 rounded-md border border-rule bg-paper/60 px-3 py-2">
          <p className="text-xs leading-snug text-pretty text-ink-soft">
            <span className="font-semibold text-ink">Demonstration.</span> Bank capabilities {dated ? `${dated[1]} (${shortDate(dated[2]!)})` : `v${demo.version}`} record the renewal, in force from{' '}
            {longDate(demo.effective_from)}. Switching changes the bank's approved state. It does not fix the contract: the agreement is unchanged, and no wording is proposed.
          </p>
          <p data-testid="demo-outcome" className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-snug text-ink-soft">
            The same clause under v{demo.version}: <VerdictPill decision={demo.decision} arrive={false} />
            {demo.remaining.length > 0 && <span>{demo.remaining.map((k) => findingTitle(k, requirement).toLowerCase()).join(', ')}</span>}
          </p>
          <Button variant="secondary" data-control="switch-capabilities" className="mt-2 min-h-8 px-3 text-xs" onClick={() => onSwitchVersion(demo.version)}>
            Change the bank's approved state to v{demo.version} and re-check
          </Button>
        </div>
      )}
    </div>
  )
}

/** Where a card is in its reveal. Times are real; only the reveal of finished work is paced. */
export interface CardPacing {
  /** ms since this card's response landed and its reveal began. null: still waiting on the model. */
  t: number | null
  /** performance.now() when the extraction was asked for: the waiting counter runs from here. */
  askedAt: number
  /** ms since Apply and re-test. null: no re-test on this card. */
  repairT: number | null
  /** prefers-reduced-motion: everything lands at once. */
  still: boolean
}

const MARK_ICON = { PASS: Check, MANUAL: User, FAIL: X } as const
const MARK_TEXT = { PASS: 'text-pass', MANUAL: 'text-manual', FAIL: 'text-fail' } as const
const MARK_SURFACE = {
  PASS: 'border-pass-rule bg-sheet',
  MANUAL: 'border-manual-rule bg-manual-soft',
  FAIL: 'border-fail-rule bg-fail-soft',
} as const

/** One extracted term. The verdict mark and the bank's side land on it; a re-test retypes it in place. */
function Chip({ chip, mark, change, still }: { chip: TermChip; mark: ChipMark | null; change: ChipChange | null; still: boolean }) {
  const Icon = mark && MARK_ICON[mark.verdict]
  return (
    <span
      data-chip={chip.key}
      data-mark={mark?.verdict}
      title={chip.note}
      className={cn(
        'inline-flex max-w-full animate-rise-in flex-col rounded-md border px-2 py-0.5 text-xs leading-tight transition-colors duration-200',
        mark ? MARK_SURFACE[mark.verdict] : chip.missing ? 'border-manual-rule bg-manual-soft' : 'border-rule bg-paper/60',
      )}
    >
      <span className={cn('flex flex-wrap items-center gap-x-1 font-semibold', !mark && chip.missing && 'text-manual')}>
        {change ? (
          <>
            <span className="relative font-normal text-ink-faint">
              {chip.text}
              <span aria-hidden className="absolute inset-x-0 top-1/2 h-px origin-left animate-draw bg-ink-faint" />
            </span>
            <span className="sr-only">changes to</span>
            <Typewriter text={change.to} durationMs={still ? 0 : 450} />
            <span className="font-mono text-[0.68rem] font-normal text-ink-soft">· {change.capability_id}</span>
          </>
        ) : (
          chip.text
        )}
        {Icon && mark && !mark.bank && <Icon key={mark.verdict} aria-label={mark.verdict} strokeWidth={3} className={cn('size-3 shrink-0 animate-verdict-in', MARK_TEXT[mark.verdict])} />}
      </span>
      {Icon && mark?.bank && (
        <span className={cn('flex animate-rise-in items-start gap-1 text-[0.7rem] text-pretty', MARK_TEXT[mark.verdict])}>
          <Icon aria-label={mark.verdict} strokeWidth={3} className="mt-px size-3 shrink-0" />
          {mark.bank}
        </span>
      )}
    </span>
  )
}

/** A check the route itself demands (an approval, a manual step). The engine's, so it arrives with the marks. */
function RouteChip({ check }: { check: CheckResult }) {
  const Icon = MARK_ICON[check.verdict]
  return (
    <span data-chip={check.field} data-mark={check.verdict} className={cn('inline-flex max-w-full animate-rise-in flex-col rounded-md border border-dashed px-2 py-0.5 text-xs leading-tight', MARK_SURFACE[check.verdict])}>
      <span className="font-semibold">Route needs {check.required}</span>
      <span className={cn('flex items-start gap-1 text-[0.7rem] text-pretty', MARK_TEXT[check.verdict])}>
        <Icon aria-label={check.verdict} strokeWidth={3} className="mt-px size-3 shrink-0" />
        {check.supported}
      </span>
    </span>
  )
}

function ReadingBar() {
  return (
    <span aria-hidden className="relative block h-0.5 w-12 overflow-hidden rounded-full bg-rule">
      <span className="absolute inset-0 animate-pulse rounded-full bg-accent/60" />
    </span>
  )
}

/** Before the model has answered: the section, the clause's own headline, and the real wait so far. */
function WaitingCard({ review, askedAt }: { review: ClauseReview; askedAt: number }) {
  // Requests leave one at a time. Until this clause's has left, nothing is reading it, and the card says so.
  const [now, setNow] = useState(() => performance.now())
  const queued = now < askedAt
  useEffect(() => {
    if (!queued) return
    const timer = setInterval(() => setNow(performance.now()), 100)
    return () => clearInterval(timer)
  }, [queued])
  return (
    <li data-clause={review.clause.clause_id} data-stage={queued ? 'queued' : 'reading'} className="rounded-lg border border-rule bg-sheet px-3.5 py-3">
      <span className="flex items-center gap-2">
        <ReadingBar />
        <span className="font-serif text-sm font-semibold">§{review.clause.source_span.section}</span>
        <span className="ml-auto text-xs text-ink-faint">
          {queued ? (
            <>
              Next in line · asked in <span className="font-mono tabular-nums">{((askedAt - now) / 1000).toFixed(1)} s</span>
            </>
          ) : (
            <>
              Nemotron reading · <Elapsed since={askedAt} />
            </>
          )}
        </span>
      </span>
      <span className="mt-1 block text-sm text-ink-soft">{review.clause.headline}</span>
    </li>
  )
}

interface FindingCardProps {
  review: ClauseReview
  graph: CapabilityGraph
  citations: CitationIndex
  expanded: boolean
  retest: Evaluated | null
  onToggle: () => void
  /** The cursor or keyboard focus arrived on, or left, this card. */
  onHover: (over: boolean) => void
  onApply: () => void
  /** Re-check the same terms against another bank capabilities version. Changes the bank's state, never the contract. */
  onSwitchVersion: (version: number) => void
  onOpenProcedure: (checkIndex: number, passage: EvidencePassage) => void
  pacing: CardPacing
}

export function FindingCard(props: FindingCardProps) {
  const { pacing } = props
  if (pacing.t === null || !props.review.extraction || !props.review.evaluated) {
    return <WaitingCard review={props.review} askedAt={pacing.askedAt} />
  }
  return <LandedCard {...props} pacing={pacing} t={pacing.t} />
}

function LandedCard({
  review,
  graph,
  citations,
  expanded,
  retest,
  onToggle,
  onHover,
  onApply,
  onSwitchVersion,
  onOpenProcedure,
  pacing,
  t,
}: FindingCardProps & { t: number }) {
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
  const hasFix = plan !== null && plan.proposals.length > 0
  const resolution = plan ? resolutionFor({ evaluated, otherVersion: review.otherVersion, plan }, citations, TRANSACTION_TIME) : null
  // What a redraft cannot clear, said beside the redraft, so the redraft is never read as clearing it.
  const beyondWording = hasFix ? checks.filter((k) => k.verdict !== 'PASS' && isOperational(k)) : []

  // The reveal. Everything below is finished work; `t` only decides how much of it is on screen yet.
  const { chips, marks, route, retry, line, repair } = cardPlan(review, retest, pacing.still)
  const rt = repair ? (pacing.repairT ?? Infinity) : null
  const stamped = t >= line.pill
  const ready = t >= line.done
  const flipped = repair !== null && rt !== null && rt >= repair.line.pill
  const remarking = repair !== null && rt !== null && rt >= repair.line.marks
  const chipsShown = revealed(t, line.chips, line.chipEvery, chips.length)
  const marksShown = revealed(t, line.marks, line.markEvery, marks.filter(Boolean).length + route.length)
  const reMarksShown = repair && rt !== null ? revealed(rt, repair.line.marks, repair.line.markEvery, repair.marks.filter(Boolean).length + repair.route.length) : 0
  const changesShown = repair && rt !== null ? revealed(rt, repair.line.chips, repair.line.chipEvery, repair.changes.filter(Boolean).length) : 0
  const paths = result.candidate_paths.length
  const rePaths = retest ? firstResult(retest).candidate_paths.length : 0
  const recounting = repair !== null && rt !== null && rt >= repair.line.counter
  const counted = recounting ? routesCounted(rt!, repair!.line, rePaths) : routesCounted(t, line, paths)
  const countedOf = recounting ? rePaths : paths
  const live = extraction!.clause.extraction_source === 'nemotron'
  const upstream = extraction!.diagnostics?.upstream_ms
  let markOrdinal = 0
  let reMarkOrdinal = 0
  let changeOrdinal = 0
  const shownRoute = remarking ? repair!.route.slice(0, Math.max(0, reMarksShown - repair!.marks.filter(Boolean).length)) : route.slice(0, Math.max(0, marksShown - marks.filter(Boolean).length))

  return (
    <li
      data-clause={clause.clause_id}
      data-stage={!stamped ? (counted === 0 ? 'terms' : marksShown === 0 ? 'routes' : 'marks') : repair && !flipped ? 'retesting' : 'checked'}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className={cn('rounded-lg border bg-sheet', expanded ? 'border-ink-faint' : 'border-rule')}
    >
      <button type="button" data-control="card" aria-expanded={expanded} disabled={!ready} onClick={onToggle} className="block w-full rounded-lg px-3.5 py-3 text-left disabled:cursor-default">
        <span className="flex items-center gap-2">
          {stamped ? (
            <VerdictPill decision={flipped ? retest!.report.decision : decision} from={flipped ? decision : undefined} arrive={!pacing.still} />
          ) : (
            <ReadingBar />
          )}
          <span className="font-serif text-sm font-semibold">§{clause.source_span.section}</span>
          {counted > 0 && (
            <span data-testid="route-counter" className="font-mono text-[0.7rem] whitespace-nowrap text-ink-faint tabular-nums">
              {counted < countedOf ? `searching routes · ${counted} of ${countedOf}` : `${countedOf} ${countedOf === 1 ? 'route' : 'routes'}`}
            </span>
          )}
          <span
            data-testid="source-badge"
            title={`${sourceDetail(extraction!)}${review.reused ? ' This session had already asked for this clause; the time is the model call the server measured.' : ''}`}
            className={cn(
              'ml-auto rounded-full border px-2 py-0 text-[0.68rem] font-semibold whitespace-nowrap',
              live ? 'border-accent/25 bg-accent-soft text-accent' : extraction!.other_text ? 'border-fail-rule bg-fail-soft text-fail' : 'border-rule bg-rule-soft text-ink-soft',
            )}
          >
            {live ? `Live Nemotron${upstream ? ` · ${seconds(upstream)}` : ''}` : extraction!.other_text ? 'Cached · not this text' : 'Cached'}
          </span>
          <ChevronRight aria-hidden className={cn('size-4 shrink-0 text-ink-faint transition-transform', expanded && 'rotate-90', !ready && 'invisible')} />
        </span>
        <span className="mt-1 flex items-baseline gap-2 text-sm text-ink-soft">
          <span className="min-w-0">{!stamped ? clause.headline : decision === 'PASS' || !lead ? OUTCOME_HEADLINE.PASS : findingTitle(lead, requirement)}</span>
          {/* The card is the button, so this is its label for a finding that has a fix: one click opens it on the redraft. */}
          {ready && hasFix && !retest && !expanded && (
            <span data-testid="review-fix" className="ml-auto shrink-0 text-xs whitespace-nowrap text-ink-soft underline underline-offset-2">Review fix</span>
          )}
        </span>
        {retry !== null && (
          <span data-testid="guard-retry" title={retry || undefined} className="mt-1.5 block animate-rise-in truncate text-xs text-manual">
            First reading rejected{retry && ` (${retry})`} · asked again
          </span>
        )}
        <span className="mt-2 flex flex-wrap items-start gap-1">
          {chips.slice(0, chipsShown).map((chip, i) => {
            const original = marks[i] ?? null
            const again = repair?.marks[i] ?? null
            const mark = again && remarking && reMarkOrdinal++ < reMarksShown ? again : original && markOrdinal++ < marksShown ? original : null
            const change = repair?.changes[i] ?? null
            return <Chip key={chip.key} chip={chip} mark={mark} change={change && changeOrdinal++ < changesShown ? change : null} still={pacing.still} />
          })}
          {shownRoute.map((check, i) => (
            <RouteChip key={`${check.field}-${i}`} check={check} />
          ))}
          {chipsShown === chips.length && (
            <span
              data-testid="confidence"
              title={`How sure the model was of the terms it read out of this clause`}
              className="ml-auto flex items-center gap-1.5 self-center py-1 pl-1 font-mono text-[0.7rem] whitespace-nowrap text-ink-faint tabular-nums"
            >
              <span aria-hidden className="relative block h-0.5 w-7 overflow-hidden rounded-full bg-rule-soft">
                <span className="absolute inset-y-0 left-0 origin-left animate-draw rounded-full bg-accent/70" style={{ width: `${requirement.confidence * 100}%` }} />
              </span>
              model {Math.round(requirement.confidence * 100)}%
            </span>
          )}
        </span>
      </button>

      {/* A re-check under other bank capabilities replays the card. The panel waits for the verdict it explains. */}
      {expanded && ready && (
        <div className="space-y-5 border-t border-rule-soft px-5 pt-4 pb-5">
          {/* What to do comes first. The button, then its outcome, sit in one slot at the top of the panel. */}
          {hasFix ? (
            <div data-testid="fix">
              <div className="flex min-h-8 items-center gap-3">
                <p className="shrink-0 text-xs font-semibold">
                  {flipped ? 'Redraft tested' : `Proposed redraft · ${plan.proposals.length} ${plan.proposals.length === 1 ? 'change' : 'changes'}`}
                </p>
                {retest && !flipped ? (
                  <p data-testid="retesting" className="ml-auto text-sm whitespace-nowrap text-ink-soft">Re-testing…</p>
                ) : retest ? (
                  <p data-testid="retest" className="ml-auto min-w-0 text-sm leading-snug text-pretty text-ink-soft">
                    {retest.report.decision === 'PASS'
                      ? 'With these changes the clause passes. The agreement file is unchanged.'
                      : `Still ${retest.report.decision} after these changes: ${left.map((k) => fieldLabel(k.field).toLowerCase()).join(', ')}.`}
                  </p>
                ) : (
                  <Button data-control="apply" className="ml-auto min-h-8 px-3" onClick={onApply}>Apply and re-test</Button>
                )}
              </div>
              <WordingDiffs clauseText={clause.source_text} proposals={plan.proposals} />
              {!retest && <p className="mt-2 text-xs text-ink-faint">Suggested drafting from the bank's verified limits. Not approval.</p>}
              {beyondWording.length > 0 && (
                <p data-testid="beyond-wording" className="mt-2 text-xs text-ink-soft">
                  No redraft clears {beyondWording.map((k) => findingTitle(k, requirement).toLowerCase()).join(', ')}. That is operational, not wording.
                </p>
              )}
            </div>
          ) : (
            resolution && resolution.kind !== 'redraft' && <OperationalFix resolution={resolution} requirement={requirement} onSwitchVersion={onSwitchVersion} />
          )}

          {conflicts.length === 0 ? (
            <p className="text-sm text-ink-soft">All {checks.length} checks pass on one route. No action needed.</p>
          ) : (
            <div>
              <p className="mb-2 text-xs font-semibold">{decision === 'FAIL' ? 'Why it fails' : 'Why it needs a person'}</p>
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
                                ? 'The clause does not state this.'
                                : "Set by the bank's route, not the clause's wording."
                          }
                        />
                        <div className="min-w-0 space-y-2">
                          {passages.length === 0 && (
                            <p className="text-[0.72rem] leading-snug text-ink-soft">
                              No procedure in the packet covers this. The value is from the bank's capability record.
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
                                link="Open the procedure"
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
            </div>
          )}
          {alsoOpen.length > 0 && (
            <p className="text-sm text-ink-soft">
              Also needs a person: {alsoOpen.map((x) => findingTitle(x.check, requirement).toLowerCase()).join(', ')}.
            </p>
          )}

          <div>
            <button
              type="button"
              aria-expanded={routes}
              onClick={() => setRoutes((v) => !v)}
              className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
            >
              {routes ? 'Hide the routes checked' : 'Show the routes checked'}
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
