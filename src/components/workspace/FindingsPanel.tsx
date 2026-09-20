import { ArrowRight, Check, ChevronRight, DatabaseZap, Radio, RefreshCw, UserCheck } from 'lucide-react'
import { DECISION_TEXT } from '@/components/results/Verdict'
import { Badge, Id, decisionTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { mostSevere } from '@/domain/evaluate'
import type { CheckResult, Decision } from '@/domain/types'
import { supportedElsewhere } from '@/documents/locate'
import { cn } from '@/lib/cn'
import { sourceDetail } from '@/lib/extractClient'
import { OUTCOME_HEADLINE, bankSide, findingTitle, nextAction, requiredSide } from '@/lib/findingText'
import { humanize } from '@/lib/format'
import { countDecisions, fieldRows, ms } from '@/lib/runFormat'
import { decisivePath, firstResult, type ClauseReview, type Evaluated } from '@/lib/useAgreementReview'

/** The employee's demo review of one clause. Browser state only. */
export interface EmployeeReview {
  termsConfirmed: boolean
  amendmentReviewed: boolean
  /** Indexes of proposed changes the employee chose to leave out of the re-test. */
  excluded: number[]
  retest: Evaluated | null
  reproduced: { identical: boolean; ms: number } | null
}

export const EMPTY_REVIEW: EmployeeReview = {
  termsConfirmed: false,
  amendmentReviewed: false,
  excluded: [],
  retest: null,
  reproduced: null,
}

export interface Focus {
  clauseId: string
  checkIndex: number
}

interface Props {
  clauses: ClauseReview[]
  version: number
  reviews: Record<string, EmployeeReview>
  selectedClauseId: string | null
  focus: Focus | null
  onSelectClause: (clauseId: string) => void
  onFocus: (focus: Focus) => void
  onReview: (clauseId: string, patch: Partial<EmployeeReview>) => void
  onRetest: (clauseId: string) => void
  onReproduce: (clauseId: string) => void
  onOpenTechnical: (clauseId: string) => void
}

export function FindingsPanel(props: Props) {
  const { clauses, version } = props
  const decided = clauses.flatMap((c) => (c.evaluated ? [c.evaluated.report.decision] : []))
  const complete = decided.length === clauses.length && clauses.length > 0
  const overall = complete ? mostSevere(decided) : null
  const counts = countDecisions(decided.map((decision) => ({ decision })))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-rule px-3 py-2.5">
        <p className="text-[0.68rem] font-semibold tracking-wide text-ink-faint uppercase">
          Can the bank support this agreement?
        </p>
        {overall ? (
          <>
            <p data-testid="overall" className={cn('mt-0.5 text-base font-semibold', DECISION_TEXT[overall])}>
              {OUTCOME_HEADLINE[overall]}
            </p>
            <p className="mt-0.5 text-xs text-ink-soft">
              {counts.FAIL} fail · {counts.MANUAL} manual · {counts.PASS} pass · against registry v{version}. The agreement
              takes its most severe clause result.
            </p>
          </>
        ) : (
          <p className="mt-0.5 text-sm text-ink-soft">
            Waiting for extracted terms: {decided.length} of {clauses.length} clauses checked.
          </p>
        )}
      </div>
      <ul data-scroll="findings" className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {clauses.map((c) => (
          <ClauseCard key={c.clause.clause_id} review={c} {...props} />
        ))}
      </ul>
    </div>
  )
}

function ClauseCard({ review, ...props }: Props & { review: ClauseReview }) {
  const { clause, evaluated, extraction, plan, otherVersion } = review
  const id = clause.clause_id
  const open = props.selectedClauseId === id
  const employee = props.reviews[id] ?? EMPTY_REVIEW
  const decision = evaluated?.report.decision
  const retest = employee.retest && employee.retest.graph.version === props.version ? employee.retest : null
  const changed = otherVersion && decision && otherVersion.report.decision !== decision ? otherVersion : null

  return (
    <li data-clause={id} className={cn('rounded-md border bg-sheet', open ? 'border-accent/50' : 'border-rule')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => props.onSelectClause(id)}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
      >
        <ChevronRight aria-hidden className={cn('mt-0.5 size-4 shrink-0 text-ink-faint transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-ink-faint">§{clause.source_span.section} · page {clause.source_span.page}</span>
          <span className="block text-sm leading-snug font-semibold">{clause.headline}</span>
          {changed && (
            <span className="mt-0.5 block text-[0.7rem] font-medium text-manual">
              {[{ v: changed.graph.version, d: changed.report.decision }, { v: props.version, d: decision }]
                .sort((a, b) => a.v - b.v)
                .map((x) => `Registry v${x.v}: ${x.d}.`)
                .join(' ')}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {decision ? (
            <Badge tone={decisionTone(decision)} className="px-2 py-0">{decision}</Badge>
          ) : (
            <span className="text-xs text-accent">extracting…</span>
          )}
          {retest && (
            <>
              <ArrowRight aria-hidden className="size-3 text-ink-faint" />
              <Badge tone={decisionTone(retest.report.decision)} className="px-2 py-0" title="Re-test of the proposed amendment">
                {retest.report.decision}
              </Badge>
            </>
          )}
        </span>
      </button>

      {open && evaluated && extraction && plan && (
        <ClauseBody review={review} employee={employee} retest={retest} {...props} />
      )}
    </li>
  )
}

function ClauseBody({
  review,
  employee,
  retest,
  ...props
}: Props & { review: ClauseReview; employee: EmployeeReview; retest: Evaluated | null }) {
  const { clause, extraction, reused } = review
  const evaluated = review.evaluated!
  const plan = review.plan!
  const id = clause.clause_id
  const result = firstResult(evaluated)
  const requirement = extraction!.clause.requirements[0]!
  const checks = decisivePath(evaluated)?.checks ?? []
  // Hard conflicts lead; open questions follow. The index stays the check's own.
  const open = checks
    .map((check, index) => ({ check, index }))
    .filter((x) => x.check.verdict !== 'PASS')
    .sort((a, b) => Number(b.check.verdict === 'FAIL') - Number(a.check.verdict === 'FAIL'))
  const elsewhere = supportedElsewhere(requirement, result, evaluated.graph, evaluated.report.replay.transaction_time)
  const pathCounts = countDecisions(result.candidate_paths)
  const live = extraction!.clause.extraction_source === 'nemotron'
  const chosen = plan.proposals.filter((_, i) => !employee.excluded.includes(i))
  const canRetest = employee.termsConfirmed && employee.amendmentReviewed && chosen.length > 0

  const isFocused = (index: number) => props.focus?.clauseId === id && props.focus.checkIndex === index

  return (
    <div className="space-y-3 border-t border-rule-soft px-2.5 pt-2.5 pb-3">
      {/* Findings: outcome first, then the two values. */}
      {open.length === 0 ? (
        <button
          type="button"
          onClick={() => props.onFocus({ clauseId: id, checkIndex: 0 })}
          className="block w-full rounded border border-pass-rule bg-pass-soft px-2.5 py-2 text-left text-sm text-pass hover:brightness-[0.98]"
        >
          <span className="font-semibold">All {checks.length} checks pass on one route.</span>{' '}
          <span className="text-xs">Open the evidence.</span>
        </button>
      ) : (
        <ul className="space-y-1.5">
          {open.map(({ check, index }) => (
            <li key={index}>
              <FindingRow check={check} title={findingTitle(check, requirement)} active={isFocused(index)} onClick={() => props.onFocus({ clauseId: id, checkIndex: index })} />
            </li>
          ))}
        </ul>
      )}

      <p className="flex gap-1.5 text-xs text-ink">
        <span className="font-semibold whitespace-nowrap">Next:</span>
        {nextAction(result, plan)}
      </p>

      {/* Employee review of the extracted terms. */}
      <details className="group rounded border border-rule">
        <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs font-semibold">
          <ChevronRight aria-hidden className="size-3.5 text-ink-faint transition-transform group-open:rotate-90" />
          Extracted terms
          <Badge tone={live ? 'pass' : 'manual'} className="ml-auto px-1.5 py-0 text-[0.65rem]">
            {live ? <Radio aria-hidden className="size-3" /> : <DatabaseZap aria-hidden className="size-3" />}
            {live ? 'Live Nemotron' : 'Cached fixture'}
          </Badge>
          {employee.termsConfirmed && <Check aria-label="Terms reviewed" className="size-3.5 text-pass" />}
        </summary>
        <div className="border-t border-rule-soft px-2.5 py-2">
          <p className="text-[0.7rem] text-ink-soft">
            {sourceDetail(extraction!)}
            {reused && ' Reused from an earlier request in this session.'}
          </p>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {fieldRows(requirement).map((row) => (
              <div key={row.key} className="contents">
                <dt className="text-ink-faint">{row.label}</dt>
                <dd className={row.value === null ? 'text-manual' : 'font-medium'}>{row.value ?? 'not stated'}</dd>
              </div>
            ))}
          </dl>
          {requirement.ambiguities.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[0.7rem] text-manual">
              {requirement.ambiguities.map((a) => <li key={a}>{a}</li>)}
            </ul>
          )}
        </div>
      </details>
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5 size-3.5 accent-[var(--color-accent)]"
          checked={employee.termsConfirmed}
          onChange={(e) => props.onReview(id, { termsConfirmed: e.target.checked })}
        />
        <span>I compared the extracted terms with §{clause.source_span.section}.</span>
      </label>

      {/* Proposed amendment and re-test. */}
      {plan.proposals.length > 0 && (
        <div className="rounded border border-rule">
          <p className="border-b border-rule-soft px-2.5 py-1.5 text-xs font-semibold">Proposed amendment</p>
          <ul className="divide-y divide-rule-soft">
            {plan.proposals.map((p, i) => (
              <li key={p.field} className="flex items-start gap-2 px-2.5 py-1.5 text-xs">
                <input
                  type="checkbox"
                  aria-label={`Include change to ${humanize(p.field)}`}
                  className="mt-0.5 size-3.5 accent-[var(--color-accent)]"
                  checked={!employee.excluded.includes(i)}
                  onChange={(e) =>
                    props.onReview(id, {
                      excluded: e.target.checked ? employee.excluded.filter((x) => x !== i) : [...employee.excluded, i],
                      retest: null,
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="block font-medium">{humanize(p.field)}</span>
                  <span className="block text-ink-soft">
                    <span className="line-through">{p.from}</span> <ArrowRight aria-hidden className="inline size-3" />{' '}
                    <span className="font-semibold text-ink">{p.to}</span> <Id className="whitespace-nowrap">{p.capability_id}</Id>
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="space-y-2 border-t border-rule-soft px-2.5 py-2">
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 size-3.5 accent-[var(--color-accent)]"
                checked={employee.amendmentReviewed}
                onChange={(e) => props.onReview(id, { amendmentReviewed: e.target.checked })}
              />
              <span>I reviewed the selected changes against the cited bank records.</span>
            </label>
            <Button className="min-h-8 w-full px-3 text-xs" disabled={!canRetest} onClick={() => props.onRetest(id)}>
              <UserCheck aria-hidden className="size-3.5" />
              Re-test {chosen.length} of {plan.proposals.length} changes
            </Button>
            <p className="text-[0.68rem] leading-snug text-ink-faint">
              Demo review step held in this browser. It is not authenticated sign-off, contract approval or an audit
              record, and it cannot change a verdict: the re-test runs the same deterministic checks.
            </p>
            {retest && <RetestResult retest={retest} />}
          </div>
        </div>
      )}

      {elsewhere.length > 0 && (
        <details className="group rounded border border-rule">
          <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs font-semibold">
            <ChevronRight aria-hidden className="size-3.5 text-ink-faint transition-transform group-open:rotate-90" />
            Supported separately, but not on one route
          </summary>
          <ul className="space-y-1.5 border-t border-rule-soft px-2.5 py-2 text-xs">
            {elsewhere.map((e) => (
              <li key={e.field}>
                <span className="font-medium">{e.required}</span> fits {e.label} <Id>{e.capability_id}</Id> ({e.supported}),
                but that capability fails on {e.blocked_by.map((b) => `${humanize(b.field).toLowerCase()} (${humanize(b.required).toLowerCase()} vs ${humanize(b.supported).toLowerCase()})`).join(', ')}.
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="group rounded border border-rule">
        <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs font-semibold">
          <ChevronRight aria-hidden className="size-3.5 text-ink-faint transition-transform group-open:rotate-90" />
          Route evidence and record
        </summary>
        <div className="space-y-2 border-t border-rule-soft px-2.5 py-2 text-xs">
          <p className="text-ink-soft">
            {result.candidate_paths.length} complete routes searched in {ms(evaluated.ms)}: {pathCounts.PASS} pass ·{' '}
            {pathCounts.MANUAL} manual · {pathCounts.FAIL} fail. Closest route:
          </p>
          <p className="flex flex-wrap gap-1">
            {(decisivePath(evaluated)?.legs ?? []).map((leg) => <Id key={leg.capability_id} title={leg.label}>{leg.capability_id}</Id>)}
          </p>
          <ul>
            {checks.map((k, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => props.onFocus({ clauseId: id, checkIndex: i })}
                  className={cn('flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-rule-soft', isFocused(i) && 'bg-accent-soft')}
                >
                  <span className={cn('w-12 shrink-0 text-[0.65rem] font-bold', DECISION_TEXT[k.verdict])}>{k.verdict}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[0.7rem]">{k.field}</span>
                  <span className="font-mono text-[0.68rem] text-ink-faint">{k.capability_id}</span>
                </button>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[0.68rem] text-ink-soft">
            <dt>terms</dt><dd className="truncate">{evaluated.report.replay.requirement_bundle_hash}</dd>
            <dt>registry</dt><dd>v{evaluated.report.replay.capability_graph_version} · evaluator {evaluated.report.replay.evaluator_version}</dd>
            <dt>as of</dt><dd>{evaluated.report.replay.transaction_time}</dd>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="min-h-7 px-2 text-xs" onClick={() => props.onReproduce(id)}>
              <RefreshCw aria-hidden className="size-3.5" />
              Reproduce
            </Button>
            <Button variant="ghost" className="min-h-7 px-2 text-xs" onClick={() => props.onOpenTechnical(id)}>
              Technical results
              <ArrowRight aria-hidden className="size-3.5" />
            </Button>
            {employee.reproduced && (
              <span data-testid="reproduced" className={cn('font-medium', employee.reproduced.identical ? 'text-pass' : 'text-fail')}>
                {employee.reproduced.identical ? 'Identical result from the same inputs' : 'Result differed'} · {ms(employee.reproduced.ms)}
              </span>
            )}
          </div>
        </div>
      </details>
    </div>
  )
}

function FindingRow({ check, title, active, onClick }: { check: CheckResult; title: string; active: boolean; onClick: () => void }) {
  const bank = bankSide(check)
  const tone: Record<Decision, string> = {
    FAIL: 'border-fail-rule hover:bg-fail-soft/60',
    MANUAL: 'border-manual-rule hover:bg-manual-soft/60',
    PASS: 'border-pass-rule',
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'block w-full rounded border border-l-[3px] px-2.5 py-1.5 text-left transition-colors',
        tone[check.verdict],
        active && (check.verdict === 'FAIL' ? 'bg-fail-soft' : 'bg-manual-soft'),
      )}
    >
      <span className="flex items-baseline gap-2">
        <span className="text-sm leading-snug font-semibold">{title}</span>
        <span className={cn('ml-auto text-[0.65rem] font-bold', DECISION_TEXT[check.verdict])}>{check.verdict}</span>
      </span>
      <span className="mt-0.5 block text-xs text-ink-soft">
        {requiredSide(check)}: <span className="font-medium text-ink">{check.required}</span>
      </span>
      <span className="block text-xs text-ink-soft">
        {bank.label}: <span className="font-medium text-ink">{bank.value}</span>
      </span>
    </button>
  )
}

function RetestResult({ retest }: { retest: Evaluated }) {
  const decision = retest.report.decision
  const result = firstResult(retest)
  const left = (decisivePath(retest)?.checks ?? []).filter((k) => k.verdict !== 'PASS')
  return (
    <div data-testid="retest" className={cn('rounded border px-2.5 py-2 text-xs', {
      'border-pass-rule bg-pass-soft': decision === 'PASS',
      'border-manual-rule bg-manual-soft': decision === 'MANUAL',
      'border-fail-rule bg-fail-soft': decision === 'FAIL',
    })}>
      <p className={cn('font-semibold', DECISION_TEXT[decision])}>
        Re-test: {decision} · {result.candidate_paths.length} routes · {ms(retest.ms)}
      </p>
      {decision === 'PASS' ? (
        <p className="mt-0.5 text-ink-soft">The amended terms fit one complete route. The agreement itself is unchanged until it is redrafted.</p>
      ) : (
        <ul className="mt-0.5 list-disc pl-4 text-ink-soft">
          {left.map((k, i) => <li key={i}>{humanize(k.field)}: {k.required} vs {k.supported}</li>)}
        </ul>
      )}
    </div>
  )
}
