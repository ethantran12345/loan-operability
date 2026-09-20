import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LoaderCircle, Play, RefreshCw } from 'lucide-react'
import { Badge, Id, decisionTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { gradeChallenge, type ModelAnswer } from '@/domain/challenge'
import type { CapabilityGraph, ExtractedClause, RequirementResult } from '@/domain/types'
import type { ChallengeResponse } from '@/lib/challenge'
import { challengeFor, unavailableDetail } from '@/lib/challengeClient'

type Served = Exclude<ChallengeResponse, { source: 'unavailable' }>

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const stamp = (iso: string) => iso.slice(0, 16).replace('T', ' ')

function Heading({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-semibold tracking-wider text-ink-faint uppercase">{children}</h4>
}

function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group mt-3 rounded-md border border-rule-soft">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 px-3 py-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        {summary}
        <span className="text-xs font-normal text-ink-soft group-open:hidden">Expand</span>
        <span className="hidden text-xs font-normal text-ink-soft group-open:inline">Collapse</span>
      </summary>
      <div className="border-t border-rule-soft px-3 py-3">{children}</div>
    </details>
  )
}

const Code = ({ children }: { children: string }) => (
  <pre className="max-h-96 overflow-auto rounded-md bg-ink p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-sheet">
    {children}
  </pre>
)

/** The model's answer exactly as it gave it. Nothing here is edited or summarised. */
function ModelColumn({ served }: { served: Served }) {
  const answer: ModelAnswer = served.answers[0]!
  return (
    <div className="min-w-0 px-4 py-4">
      <Heading>The model's answer, verbatim</Heading>
      <p className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone={served.source === 'live' ? 'accent' : 'neutral'}>
          {served.source === 'live' ? `Live · ${served.model}` : `Recorded ${stamp(served.recorded_at ?? '')}`}
        </Badge>
        {served.source === 'recorded' && <span className="text-xs text-ink-soft">{served.model}</span>}
        {served.answers.length > 1 && (
          <span className="text-xs text-ink-soft">Run 1 of {served.answers.length} is shown. Every run is in the raw JSON.</span>
        )}
      </p>

      <dl className="mt-4 space-y-4 text-sm">
        <div>
          <dt className="font-semibold">Verdict</dt>
          <dd className="mt-1">
            <Badge tone={decisionTone(answer.verdict)}>{answer.verdict}</Badge>
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Reasoning</dt>
          <dd className="mt-1 font-serif text-base leading-relaxed">{answer.reasoning || 'None given.'}</dd>
        </div>
        <div>
          <dt className="font-semibold">Paths it listed ({answer.paths_considered.length})</dt>
          <dd className="mt-1">
            {answer.paths_considered.length === 0 ? (
              'None.'
            ) : (
              <ul className="space-y-2">
                {answer.paths_considered.map((p, i) => (
                  <li key={i}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {p.capability_ids.map((id) => (
                        <Id key={id}>{id}</Id>
                      ))}
                      <Badge tone={decisionTone(p.verdict)}>{p.verdict}</Badge>
                    </span>
                    {p.reason && <span className="mt-0.5 block text-ink-soft">{p.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Conflicts ({answer.conflicts.length})</dt>
          <dd className="mt-1">
            {answer.conflicts.length === 0 ? (
              'None.'
            ) : (
              <ul className="space-y-1.5">
                {answer.conflicts.map((c, i) => (
                  <li key={i}>
                    <Id className="mr-1.5">{c.field}</Id>
                    {c.reason}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Proposed fix ({answer.proposed_fix.length})</dt>
          <dd className="mt-1">
            {answer.proposed_fix.length === 0 ? (
              'None.'
            ) : (
              <ul className="space-y-1.5">
                {answer.proposed_fix.map((f, i) => (
                  <li key={i}>
                    <Id className="mr-1.5">{f.field}</Id>
                    {f.value}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Declared assumptions ({answer.assumptions.length})</dt>
          <dd className="mt-1">
            {answer.assumptions.length === 0 ? (
              'None.'
            ) : (
              <ul className="list-disc space-y-1.5 pl-5">
                {answer.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>

      <Disclosure summary="Raw JSON, as the model returned it">
        <div className="space-y-3">
          {served.raw.map((raw, i) => (
            <div key={i}>
              <p className="mb-1 text-xs text-ink-soft">
                Run {i + 1}
                {served.latency_ms[i] !== undefined && `, ${(served.latency_ms[i]! / 1000).toFixed(1)} s`}
              </p>
              <Code>{raw}</Code>
            </div>
          ))}
        </div>
      </Disclosure>
    </div>
  )
}

function Row({ title, line, children }: { title: string; line: ReactNode; children?: ReactNode }) {
  return (
    <li className="border-t border-rule-soft pt-3 first:border-t-0 first:pt-0">
      <p className="text-xs font-semibold tracking-wider text-ink-faint uppercase">{title}</p>
      <p className="mt-1 text-sm font-medium">{line}</p>
      {children}
    </li>
  )
}

const Path = ({ ids }: { ids: string[] }) => (
  <span className="inline-flex flex-wrap gap-1 align-middle">
    {ids.map((id) => (
      <Id key={id}>{id}</Id>
    ))}
  </span>
)

/** Every number here comes from `gradeChallenge`: the graph and the evaluator, not prose. */
function GradeColumn({
  served,
  secondPending,
  clause,
  result,
  graph,
  engineHash,
}: {
  served: Served
  /** The second run has been asked for and has not answered yet. */
  secondPending: boolean
  clause: ExtractedClause
  result: RequirementResult
  graph: CapabilityGraph
  engineHash: string
}) {
  const grade = useMemo(
    () => gradeChallenge(served.answers, clause, result, graph, engineHash),
    [served, clause, result, graph, engineHash],
  )
  const { verdict, paths, fix, assumptions, reproducibility } = grade
  return (
    <div className="min-w-0 border-t border-rule-soft px-4 py-4 md:border-t-0 md:border-l">
      {/* The model's column is long. Keep the grade beside whatever part of it is being read. */}
      <div className="md:sticky md:top-4">
        <Heading>The engine's grade</Heading>
        <ul className="mt-3 space-y-3">
          <Row
            title="Verdict"
            line={
              verdict.agrees ? (
                <span className="text-pass">Agrees with the engine ({verdict.engine})</span>
              ) : (
                <span className="text-manual">
                  Differs from the engine: the model says {verdict.model}, the path search says {verdict.engine}
                </span>
              )
            }
          />

          <Row
            title="Paths"
            line={`Named ${paths.named} of ${plural(paths.total_real, 'complete path')} · ${paths.named_real} real · ${paths.not_real.length} not paths`}
          >
            {paths.not_real.length > 0 && (
              <ul className="mt-2 space-y-1.5 text-sm">
                {paths.not_real.map((n, i) => (
                  <li key={i}>
                    <Path ids={n.capability_ids} /> <span className="text-ink-soft">{n.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </Row>

          {paths.verdict_mismatches.length > 0 && (
            <Row
              title="Verdicts on real paths"
              line={`${plural(paths.verdict_mismatches.length, 'real path')} graded differently from the engine`}
            >
              <ul className="mt-2 space-y-1.5 text-sm">
                {paths.verdict_mismatches.map((m, i) => (
                  <li key={i}>
                    <Path ids={m.capability_ids} />{' '}
                    <span className="text-ink-soft">
                      model {m.model}, engine {m.engine}
                    </span>
                  </li>
                ))}
              </ul>
            </Row>
          )}

          <Row
            title="Fix"
            line={
              fix.proposals === 0
                ? 'No fix was proposed, so there is nothing to check against the graph'
                : `${fix.ungrounded.length} of ${plural(fix.proposals, 'proposed value')} ${fix.ungrounded.length === 1 ? 'is' : 'are'} not in the capability graph`
            }
          >
            {fix.ungrounded.length > 0 && (
              <ul className="mt-2 space-y-1.5 text-sm">
                {fix.ungrounded.map((u, i) => (
                  <li key={i}>
                    <Id className="mr-1.5">{u.field}</Id>“{u.value}” <span className="text-ink-soft">{u.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </Row>

          <Row
            title="Assumptions"
            line={`${plural(assumptions.items.length, 'assumption')} declared · ${assumptions.detected.length} more detected`}
          >
            {assumptions.detected.length > 0 && (
              <ul className="mt-2 space-y-1.5 text-sm">
                {assumptions.detected.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-sm text-ink-soft">
              Engine carried {plural(assumptions.engine_unknowns, 'unknown')} without guessing.
            </p>
          </Row>

          <Row
            title="Reproducibility"
            line={
              reproducibility
                ? `${plural(reproducibility.runs, 'run')} · ${plural(reproducibility.distinct_verdicts, 'verdict')} · ${plural(reproducibility.distinct_conflict_sets, 'conflict set')}`
                : secondPending
                  ? 'Run 1 is graded. The same question is being asked a second time'
                  : 'One run came back, so run-to-run consistency was not measured'
            }
          >
            <p className="mt-2 text-sm text-ink-soft">
              Engine hash <Id>{engineHash.slice(0, 23)}…</Id> identical by construction.
            </p>
          </Row>
        </ul>
      </div>
    </div>
  )
}

/**
 * Check the model's work. The same clause and the same graph file go to the same
 * model with no engine, and the engine referees the answer. The left column is
 * the model's words; the right column is derived, line by line, from the grade.
 */
export function ChallengePanel({
  clause,
  result,
  graph,
  engineHash,
}: {
  clause: ExtractedClause
  result: RequirementResult
  graph: CapabilityGraph
  engineHash: string
}) {
  const [revealed, setRevealed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const askAgain = useRef(false)
  const [response, setResponse] = useState<ChallengeResponse | null>(null)
  const [secondPending, setSecondPending] = useState(false)

  // Ask as soon as this clause is on Results, and again when the graph version
  // changes. Only this clause: each challenge is two model calls.
  useEffect(() => {
    let current = true
    setResponse(null)
    setSecondPending(true)
    const fresh = askAgain.current
    askAgain.current = false
    const runs = challengeFor(clause.clause_id, graph.version, fresh)
    runs.first.then((r) => {
      if (current) setResponse((known) => known ?? r)
    })
    runs.both.then((r) => {
      if (!current) return
      if (r) setResponse(r)
      setSecondPending(false)
    })
    return () => {
      current = false
    }
  }, [clause.clause_id, graph.version, attempt])

  const served = response && response.source !== 'unavailable' ? response : null

  return (
    <section aria-labelledby="challenge-title" className="mt-10">
      <h2 id="challenge-title" className="font-serif text-2xl font-semibold">
        Check the model's work
      </h2>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">
        The same clause and the same capability-graph file, given to the same model with no engine.
        Then the engine grades the answer.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!revealed ? (
          <Button onClick={() => setRevealed(true)}>
            <Play aria-hidden className="size-4" />
            Run challenge
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={!response || (served !== null && secondPending)}
            onClick={() => {
              askAgain.current = true
              setAttempt((n) => n + 1)
            }}
          >
            <RefreshCw aria-hidden className="size-4" />
            Run again
          </Button>
        )}
        <span className="text-sm text-ink-soft">Graph v{graph.version}</span>
      </div>

      <div aria-live="polite">
        {revealed && !response && (
          <p className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            The model is reading the clause and the whole graph. This usually takes under a minute, sometimes two.
          </p>
        )}

        {revealed && response?.source === 'unavailable' && (
          <p className="mt-4 text-sm text-ink-soft">
            No model answer to grade right now. {unavailableDetail(response.reason)} Nothing is shown in its place.
          </p>
        )}

        {revealed && served && (
          <>
            <div className="mt-4 grid rounded-lg border border-rule bg-sheet md:grid-cols-2">
              <ModelColumn served={served} />
              <GradeColumn
                served={served}
                secondPending={secondPending}
                clause={clause}
                result={result}
                graph={graph}
                engineHash={engineHash}
              />
            </div>
            <Disclosure summary="Files sent to the model">
              <div className="space-y-3 text-sm">
                <div>
                  <p className="mb-1 font-semibold">Instructions</p>
                  <Code>{served.bundle.instructions}</Code>
                </div>
                <div>
                  <p className="mb-1 font-semibold">Clause {served.bundle.clause_id}</p>
                  <Code>{served.bundle.clause_text}</Code>
                </div>
                <div>
                  <p className="mb-1 font-semibold">Capability graph v{graph.version}, the file the engine reads</p>
                  <Code>{JSON.stringify(served.bundle.capability_graph, null, 2)}</Code>
                </div>
              </div>
            </Disclosure>
          </>
        )}
      </div>

      <p className="mt-4 max-w-prose text-sm font-medium">
        The model may well reach the right verdict. What it cannot do is prove it searched every path,
        use only the bank's real bounds, refuse to guess, or give the same answer twice. Those are
        properties of the method, not the model.
      </p>
    </section>
  )
}
