import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, Check, RefreshCw, Wrench } from 'lucide-react'
import { Link, Navigate } from 'react-router-dom'
import { CandidatePaths, ChecksTable } from '@/components/results/CandidatePaths'
import { Citation, Findings } from '@/components/results/Findings'
import { DECISION_TEXT, Verdict } from '@/components/results/Verdict'
import { Badge, Id } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { evaluate } from '@/domain/evaluate'
import { TRANSACTION_TIME, agreement, capabilityGraph } from '@/domain/fixtures'
import { applyRepairs, proposeRepairs } from '@/domain/repair'
import { cn } from '@/lib/cn'
import { sourceDetail } from '@/lib/extractClient'
import { humanize } from '@/lib/format'
import { useReviewSession } from '@/lib/session'

type Stage = 'tested' | 'applied' | 'retested'

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`section-${n}`} className="mt-10">
      <h2 id={`section-${n}`} className="font-serif text-2xl font-semibold">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function Results() {
  const { submission } = useReviewSession()
  const [stage, setStage] = useState<Stage>('tested')

  const verdictsRef = useRef<HTMLDivElement>(null)

  const clause = submission?.clause ?? null

  // Bring both verdicts into view for the transition, on any screen size.
  useEffect(() => {
    if (stage === 'retested') verdictsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [stage])

  const report = useMemo(
    () =>
      clause
        ? evaluate([clause], capabilityGraph, TRANSACTION_TIME, agreement.agreement_version)
        : null,
    [clause],
  )

  // One repair plan per requirement, drafted against the path the engine reported.
  const plans = useMemo(() => {
    if (!clause || !report) return []
    const results = report.clause_results[0]!.requirement_results
    return clause.requirements.map((req, i) => {
      const result = results[i]!
      return {
        req,
        result,
        plan: result.decision === 'PASS' ? null : proposeRepairs(req, result, capabilityGraph),
      }
    })
  }, [clause, report])

  const revisedReport = useMemo(() => {
    if (stage !== 'retested' || !clause) return null
    const requirements = plans.map(({ req, plan }) =>
      plan ? applyRepairs(req, plan.proposals) : req,
    )
    return evaluate(
      [{ ...clause, requirements }],
      capabilityGraph,
      TRANSACTION_TIME,
      `${agreement.agreement_version}+operational-alternative`,
    )
  }, [stage, clause, plans])

  if (!submission || !clause || !report) return <Navigate to="/" replace />

  const meta = agreement.clauses.find((c) => c.clause_id === clause.clause_id)
  const proposalCount = plans.reduce((n, p) => n + (p.plan?.proposals.length ?? 0), 0)
  const unrepairableCount = plans.reduce((n, p) => n + (p.plan?.unrepairable.length ?? 0), 0)
  const needsRepair = report.decision !== 'PASS'

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to="/"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back to the agreement
      </Link>

      <h1 className="mt-2 font-serif text-3xl leading-tight font-semibold sm:text-4xl">
        Section {clause.source_span.section}
        {meta && <span className="block text-xl font-normal text-ink-soft">{meta.headline}</span>}
      </h1>
      <blockquote className="mt-4 border-l-2 border-rule pl-4 font-serif text-base leading-relaxed text-ink-soft">
        {clause.source_text}
      </blockquote>

      {/* 1 + 5. Both verdicts stay on screen. The move from one to the other is the product. */}
      <div
        ref={verdictsRef}
        aria-live="polite"
        className="mt-6 flex scroll-mt-4 flex-col items-stretch gap-3 md:flex-row"
      >
        <Verdict
          decision={report.decision}
          label={revisedReport ? 'As drafted' : 'Operability result'}
          caption={`Tested against ${capabilityGraph.institution}, capability graph v${capabilityGraph.version}.`}
        />
        {revisedReport && (
          <>
            <div aria-hidden className="flex items-center justify-center text-ink-faint md:w-20">
              <span className="hidden h-px flex-1 origin-left animate-draw bg-ink-faint md:block" />
              <ArrowRight className="-ml-2 hidden size-6 shrink-0 animate-rise-in md:block" />
              <ArrowDown className="size-6 animate-rise-in md:hidden" />
            </div>
            <Verdict
              arrive
              decision={revisedReport.decision}
              label="Revision, re-tested"
              caption={`Same evaluator, same graph, ${proposalCount} drafting change${proposalCount === 1 ? '' : 's'} applied.`}
            />
          </>
        )}
      </div>

      <p className="mt-3 text-sm text-ink-soft">
        <span className="font-medium text-ink">
          {clause.extraction_source === 'nemotron' ? 'Live Nemotron extraction.' : 'Cached fixture extraction.'}
        </span>{' '}
        {sourceDetail(submission)}
        {submission.edits.map((e) => (
          <span key={e.requirement_id} className="block">
            Reviewer corrected <Id>{e.requirement_id}</Id> amount from{' '}
            {e.from.toLocaleString('en-US')} to {e.to.toLocaleString('en-US')} before this test.
          </span>
        ))}
      </p>

      <Section n={2} title="Contract requires, bank supports">
        <div className="space-y-6">
          {plans.map(({ req, result }) => (
            <div key={req.requirement_id}>
              {plans.length > 1 && (
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Id>{req.requirement_id}</Id> {humanize(req.operation)}
                  <Badge tone={result.decision === 'PASS' ? 'pass' : result.decision === 'MANUAL' ? 'manual' : 'fail'}>
                    {result.decision}
                  </Badge>
                </p>
              )}
              <Findings
                result={result}
                selectedChecks={
                  result.candidate_paths.find((p) => p.path_id === result.selected_path_id)?.checks ?? []
                }
              />
            </div>
          ))}
        </div>
      </Section>

      <Section n={3} title="Candidate capability paths">
        <div className="space-y-6">
          {plans.map(({ req, result }) => (
            <CandidatePaths key={req.requirement_id} result={result} />
          ))}
        </div>
      </Section>

      <Section n={4} title="Operational alternative">
        {!needsRepair && (
          <p className="text-sm text-ink-soft">
            This clause already passes on a complete automated path. No revision is proposed.
          </p>
        )}

        {needsRepair && (
          <div className="space-y-4">
            {proposalCount > 0 && (
            <p className="max-w-prose text-sm text-ink-soft">
              Every value below is taken from a bound already in the capability graph and cites the
              capability it came from. The model may write the sentence. It may not invent the
              number.
            </p>
            )}

            {plans.map(({ req, plan }) =>
              plan ? (
                <div key={req.requirement_id} className="space-y-3">
                  {plan.proposals.length > 0 && (
                    <ol className="space-y-2">
                      {plan.proposals.map((p) => (
                        <li
                          key={p.field}
                          className={cn(
                            'rounded-lg border bg-sheet px-4 py-3 transition-colors',
                            stage === 'tested' ? 'border-rule' : 'border-pass-rule',
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">{humanize(p.field)}</span>
                            <Id>{p.field}</Id>
                            {stage !== 'tested' && (
                              <Badge tone="pass">
                                <Check aria-hidden className="size-3" />
                                Applied to revision
                              </Badge>
                            )}
                          </div>
                          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-serif text-lg">
                            <span className="text-fail line-through decoration-fail/50">{p.from}</span>
                            <ArrowRight aria-hidden className="size-4 text-ink-faint" />
                            <span className="sr-only">changes to</span>
                            <span className="font-semibold text-pass">{p.to}</span>
                          </p>
                          <p className="mt-1.5 text-sm">{p.rationale}</p>
                          <p className="mt-2">
                            <Citation capabilityId={p.capability_id} />
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}

                  {plan.unrepairable.length > 0 && (
                    <div className="rounded-lg border border-manual-rule bg-manual-soft px-4 py-3">
                      <h3 className="text-sm font-semibold text-manual">
                        No drafting change can resolve {plan.unrepairable.length === 1 ? 'this' : 'these'}
                      </h3>
                      <ul className="mt-2 space-y-2">
                        {plan.unrepairable.map((u) => (
                          <li key={u.field} className="text-sm">
                            <Id className="mr-1.5">{u.field}</Id>
                            {u.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {plan.narrative && (
                    <figure className="rounded-lg border border-rule bg-sheet px-4 py-3">
                      <figcaption className="text-xs font-semibold tracking-wider text-ink-faint uppercase">
                        Suggested drafting, generated from the changes above
                      </figcaption>
                      <p className="mt-1.5 font-serif text-base leading-relaxed">{plan.narrative}</p>
                    </figure>
                  )}
                </div>
              ) : null,
            )}

            {proposalCount === 0 ? (
              <p className="text-sm font-medium">
                There is nothing to apply: {unrepairableCount > 0 ? 'the open items are human steps, not drafting.' : 'no grounded proposal exists for this clause.'}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => setStage('applied')} disabled={stage !== 'tested'}>
                  <Wrench aria-hidden className="size-4" />
                  {stage === 'tested' ? 'Apply operational alternative' : 'Operational alternative applied'}
                </Button>
                <Button
                  variant={stage === 'applied' ? 'primary' : 'secondary'}
                  onClick={() => setStage('retested')}
                  disabled={stage !== 'applied'}
                >
                  <RefreshCw aria-hidden className="size-4" />
                  {stage === 'retested' ? 'Revision re-tested' : 'Re-test revision'}
                </Button>
                {stage === 'retested' && revisedReport && (
                  <p className="text-sm">
                    Revision result:{' '}
                    <strong className={DECISION_TEXT[revisedReport.decision]}>{revisedReport.decision}</strong>
                    . Both results are shown at the top of the page.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section n={6} title="Technical proof">
        <div className="space-y-2">
          <ProofPanel title="Replay record, as drafted" report={report} />
          {revisedReport && <ProofPanel title="Replay record, revision" report={revisedReport} />}
        </div>
      </Section>

    </div>
  )
}

function ProofPanel({ title, report }: { title: string; report: NonNullable<ReturnType<typeof evaluate>> }) {
  const results = report.clause_results.flatMap((c) => c.requirement_results)
  return (
    <details className="group rounded-lg border border-rule bg-sheet">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>
          {title} <span className={cn('ml-1', DECISION_TEXT[report.decision])}>{report.decision}</span>
        </span>
        <span className="text-xs font-normal text-ink-soft group-open:hidden">Expand</span>
        <span className="hidden text-xs font-normal text-ink-soft group-open:inline">Collapse</span>
      </summary>
      <div className="space-y-4 border-t border-rule-soft px-4 py-4">
        <pre className="overflow-x-auto rounded-md bg-ink p-4 font-mono text-xs leading-relaxed text-sheet">
          {JSON.stringify(report.replay, null, 2)}
        </pre>
        {results.map((r) => {
          const path = r.candidate_paths.find((p) => p.path_id === r.selected_path_id)
          return (
            <div key={r.requirement_id}>
              <h3 className="text-sm font-semibold">
                Every check on the reported path <Id className="ml-1">{r.selected_path_id ?? 'none'}</Id>
              </h3>
              <ChecksTable checks={path?.checks ?? []} className="mt-2" />
            </div>
          )
        })}
      </div>
    </details>
  )
}
