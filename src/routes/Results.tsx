import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, Check, RefreshCw, Wrench } from 'lucide-react'
import { Link, Navigate } from 'react-router-dom'
import { BenchmarkPanel } from '@/components/results/BenchmarkPanel'
import { ChallengePanel } from '@/components/results/ChallengePanel'
import { CandidatePaths, ChecksTable } from '@/components/results/CandidatePaths'
import { Citation, Findings } from '@/components/results/Findings'
import { GRAPH_VERSIONS, GraphVersionSelector } from '@/components/results/GraphVersion'
import { DECISION_TEXT, Verdict } from '@/components/results/Verdict'
import { Badge, Id } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { evaluate } from '@/domain/evaluate'
import { TRANSACTION_TIME, agreement, capabilityGraph, capabilityGraphs } from '@/domain/fixtures'
import { applyRepairs, proposeRepairs } from '@/domain/repair'
import { CHALLENGE_MODE_ON } from '@/lib/challengeClient'
import { cn } from '@/lib/cn'
import { sourceDetail } from '@/lib/extractClient'
import { humanize } from '@/lib/format'
import { useReviewSession } from '@/lib/session'

type Stage = 'tested' | 'applied' | 'retested'

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`section-${n}`} className="mt-10">
      <h2 id={`section-${n}`} className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function Results() {
  const { submission } = useReviewSession()
  const [stage, setStage] = useState<Stage>('tested')
  const [graphVersion, setGraphVersion] = useState(capabilityGraph.version)
  // Versions the reviewer has tested against, so an earlier result stays on screen.
  const [seenVersions, setSeenVersions] = useState<number[]>([capabilityGraph.version])
  const graph = capabilityGraphs[graphVersion] ?? capabilityGraph

  const verdictsRef = useRef<HTMLDivElement>(null)

  const clause = submission?.clause ?? null

  // Bring both verdicts into view for the transition, on any screen size.
  useEffect(() => {
    if (stage === 'retested') verdictsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [stage])

  // The same extracted clause against every graph version seen so far. Pure
  // evaluation: no re-extraction, no model call.
  const versionReports = useMemo(
    () =>
      clause
        ? seenVersions.map((version) => ({
            version,
            report: evaluate(
              [clause],
              capabilityGraphs[version] ?? capabilityGraph,
              TRANSACTION_TIME,
              agreement.agreement_version,
            ),
          }))
        : [],
    [clause, seenVersions],
  )
  const report = versionReports.find((v) => v.version === graphVersion)?.report ?? null

  // One repair plan per requirement, drafted against the path the engine reported.
  const plans = useMemo(() => {
    if (!clause || !report) return []
    const results = report.clause_results[0]!.requirement_results
    return clause.requirements.map((req, i) => {
      const result = results[i]!
      return {
        req,
        result,
        plan: result.decision === 'PASS' ? null : proposeRepairs(req, result, graph),
      }
    })
  }, [clause, report, graph])

  const revisedReport = useMemo(() => {
    if (stage !== 'retested' || !clause) return null
    const requirements = plans.map(({ req, plan }) =>
      plan ? applyRepairs(req, plan.proposals) : req,
    )
    return evaluate(
      [{ ...clause, requirements }],
      graph,
      TRANSACTION_TIME,
      `${agreement.agreement_version}+operational-alternative`,
    )
  }, [stage, clause, plans, graph])

  if (!submission || !clause || !report) return <Navigate to="/" replace />

  const meta = agreement.clauses.find((c) => c.clause_id === clause.clause_id)
  const proposalCount = plans.reduce((n, p) => n + (p.plan?.proposals.length ?? 0), 0)
  const unrepairableCount = plans.reduce((n, p) => n + (p.plan?.unrepairable.length ?? 0), 0)
  const needsRepair = report.decision !== 'PASS'

  // Same requirement, different graph version, different decision: keep every
  // version's result and replay record on screen, as the repair flow does.
  const versionsDiverge = new Set(versionReports.map((v) => v.report.decision)).size > 1
  const sameRequirementHash =
    new Set(versionReports.map((v) => v.report.replay.requirement_bundle_hash)).size === 1

  const latestVersion = GRAPH_VERSIONS[GRAPH_VERSIONS.length - 1]!

  const switchVersion = (version: number) => {
    if (version === graphVersion) return
    setGraphVersion(version)
    setSeenVersions((seen) => (seen.includes(version) ? seen : [...seen, version].sort((a, b) => a - b)))
    // A repair plan is drafted against one graph; it does not carry to another.
    setStage('tested')
    // The switch can come from the benchmark panel, further down the page.
    requestAnimationFrame(() => verdictsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to="/"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back to the agreement
      </Link>

      <h1 className="mt-2 text-2xl leading-tight font-semibold">
        Section {clause.source_span.section}
        {meta && <span className="block text-xl font-normal text-ink-soft">{meta.headline}</span>}
      </h1>
      <blockquote className="mt-4 border-l-2 border-rule pl-4 font-serif text-base leading-relaxed text-ink-soft">
        {clause.source_text}
      </blockquote>

      <GraphVersionSelector version={graphVersion} onChange={switchVersion} />

      {/* 1 + 5. Both verdicts stay on screen. The move from one to the other is the product. */}
      <div
        ref={verdictsRef}
        aria-live="polite"
        className="mt-6 flex scroll-mt-4 flex-col items-stretch gap-3 md:flex-row"
      >
        {versionsDiverge && !revisedReport ? (
          versionReports.map((v, i) => (
            <Fragment key={v.version}>
              {i > 0 && (
                <div aria-hidden className="flex items-center justify-center text-ink-faint md:w-20">
                  <span className="hidden h-px flex-1 bg-ink-faint md:block" />
                  <ArrowRight className="-ml-2 hidden size-6 shrink-0 md:block" />
                  <ArrowDown className="size-6 md:hidden" />
                </div>
              )}
              <Verdict
                arrive={v.version === graphVersion}
                decision={v.report.decision}
                label={`Graph v${v.version}${v.version === graphVersion ? ', selected' : ''}`}
                caption={`Same extracted clause, tested against ${graph.institution}, capability graph v${v.version}.`}
              />
            </Fragment>
          ))
        ) : (
          <Verdict
            decision={report.decision}
            label={revisedReport ? 'As drafted' : 'Operability result'}
            caption={`Tested against ${graph.institution}, capability graph v${graph.version}.`}
          />
        )}
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

      {CHALLENGE_MODE_ON && plans[0] && (
        <ChallengePanel
          clause={clause}
          result={plans[0].result}
          graph={graph}
          engineHash={report.replay.requirement_bundle_hash}
        />
      )}

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
            <div key={req.requirement_id}>
              {meta?.benchmark && (
                <BenchmarkPanel
                  result={result}
                  graph={graph}
                  renewedVersion={graphVersion < latestVersion ? latestVersion : null}
                  onSeeRenewal={switchVersion}
                />
              )}
              <CandidatePaths result={result} />
            </div>
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
                          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-lg">
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
                      <p className="mt-1.5 text-base leading-relaxed">{plan.narrative}</p>
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
          {versionsDiverge ? (
            <>
              <p className="max-w-prose text-sm text-ink-soft">
                {sameRequirementHash ? 'Same requirement hash, different' : 'Different'} capability
                graph version, different decision. The clause did not change. The bank did.
              </p>
              {versionReports.map((v) => (
                <ProofPanel
                  key={v.version}
                  title={`Replay record, as drafted, graph v${v.version}`}
                  report={v.report}
                  highlightVersion
                />
              ))}
            </>
          ) : (
            <ProofPanel title="Replay record, as drafted" report={report} />
          )}
          {revisedReport && (
            <ProofPanel
              title={`Replay record, revision, graph v${graphVersion}`}
              report={revisedReport}
              highlightVersion={versionsDiverge}
            />
          )}
        </div>
      </Section>

    </div>
  )
}

function ProofPanel({
  title,
  report,
  highlightVersion = false,
}: {
  title: string
  report: NonNullable<ReturnType<typeof evaluate>>
  /** Open the record and mark its capability_graph_version line. */
  highlightVersion?: boolean
}) {
  const results = report.clause_results.flatMap((c) => c.requirement_results)
  const replayLines = JSON.stringify(report.replay, null, 2).split('\n')
  return (
    <details open={highlightVersion} className="group rounded-lg border border-rule bg-sheet">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>
          {title} <span className={cn('ml-1', DECISION_TEXT[report.decision])}>{report.decision}</span>
        </span>
        <span className="text-xs font-normal text-ink-soft group-open:hidden">Expand</span>
        <span className="hidden text-xs font-normal text-ink-soft group-open:inline">Collapse</span>
      </summary>
      <div className="space-y-4 border-t border-rule-soft px-4 py-4">
        <pre className="overflow-x-auto rounded-md bg-ink p-4 font-mono text-xs leading-relaxed text-sheet">
          {replayLines.map((line, i) => (
            <Fragment key={i}>
              {highlightVersion && line.includes('"capability_graph_version"') ? (
                <>
                  {line.slice(0, line.length - line.trimStart().length)}
                  <mark className="rounded-sm bg-mark px-0.5 font-semibold text-ink">{line.trimStart()}</mark>
                </>
              ) : (
                line
              )}
              {i < replayLines.length - 1 && '\n'}
            </Fragment>
          ))}
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
