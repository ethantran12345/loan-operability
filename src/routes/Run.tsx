import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Check, DatabaseZap, Loader2, Pause, Play, Radio, RefreshCw, RotateCcw } from 'lucide-react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { GRAPH_VERSIONS, changelogEntry } from '@/components/results/GraphVersion'
import { DECISION_TEXT, Verdict } from '@/components/results/Verdict'
import { CheckTicker, Elapsed, FieldGrid, PathSearch, RecordPanel, RepairRows, Stage, type StageStatus } from '@/components/run/parts'
import { Badge, Id } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EVALUATOR_VERSION, evaluate } from '@/domain/evaluate'
import { TRANSACTION_TIME, agreement, capabilityGraph, capabilityGraphs, type AgreementClause } from '@/domain/fixtures'
import { applyRepairs, proposeRepairs, type RepairPlan } from '@/domain/repair'
import { ExtractedClauseSchema } from '@/domain/schema'
import { sha256Hex } from '@/domain/sha256'
import type { CapabilityGraph, EvaluationReport, ExtractedClause } from '@/domain/types'
import { cn } from '@/lib/cn'
import { canRetryLive, extractionFor, sourceDetail, type Extraction } from '@/lib/extractClient'
import { DECISION_MEANING } from '@/lib/format'
import { countDecisions, fieldRows, leafCount, modelCallText, ms, shortHash } from '@/lib/runFormat'
import { useReviewSession } from '@/lib/session'

const DEFAULT_CLAUSE = 'credit-agreement-2.03-a'
const BASE_VERSION = capabilityGraph.version
const HASH_CHARS = 'sha256:'.length + 16

type Speed = '1x' | '2x' | 'instant'
const SPEEDS: { id: Speed; label: string }[] = [
  { id: '1x', label: '1×' },
  { id: '2x', label: '2×' },
  { id: 'instant', label: 'Instant' },
]

/** One real evaluation: its inputs, its report, and how long `evaluate()` took. */
interface Evaluated {
  clause: ExtractedClause
  graph: CapabilityGraph
  agreementVersion: string
  report: EvaluationReport
  ms: number
}

function timedEvaluate(clause: ExtractedClause, graph: CapabilityGraph, agreementVersion: string): Evaluated {
  const started = performance.now()
  const report = evaluate([clause], graph, TRANSACTION_TIME, agreementVersion)
  return { clause, graph, agreementVersion, report, ms: performance.now() - started }
}

const firstResult = (e: Evaluated) => e.report.clause_results[0]!.requirement_results[0]!
const decisivePath = (e: Evaluated) => {
  const r = firstResult(e)
  return r.candidate_paths.find((p) => p.path_id === r.selected_path_id)
}

interface View {
  /** The active stage, 1 to 10. 0 before the first beat. */
  stage: number
  finished: boolean
  skipped: Record<number, string>
  /** How much of each paced reveal is on screen. Pacing only: the data is already whole. */
  p: Record<string, number>
  extractStartedAt: number | null
  extraction: Extraction | null
  reused: boolean
  validatedFields: number | null
  hash: string | null
  main: Evaluated | null
  plan: RepairPlan | null
  revised: Evaluated | null
  other: Evaluated | null
  /** Engine time shown on the status line: evaluations whose replay has finished. */
  engineMs: number
  evaluations: number
}

const EMPTY: View = {
  stage: 0,
  finished: false,
  skipped: {},
  p: {},
  extractStartedAt: null,
  extraction: null,
  reused: false,
  validatedFields: null,
  hash: null,
  main: null,
  plan: null,
  revised: null,
  other: null,
  engineMs: 0,
  evaluations: 0,
}

const CANCELLED = Symbol('cancelled')
const sleep = (n: number) => new Promise<void>((resolve) => setTimeout(resolve, n))

/** Extractions this page load has already shown on /run, so a replay says it is reusing one. */
const settled = new Map<string, Extraction>()

export function Run() {
  const { clauseId } = useParams()
  const [search] = useSearchParams()
  const clause = agreement.clauses.find((c) => c.clause_id === clauseId)
  if (!clause) return <Navigate to={`/run/${DEFAULT_CLAUSE}`} replace />
  const asked = Number(search.get('v'))
  return <Process clause={clause} version={asked in capabilityGraphs ? asked : BASE_VERSION} />
}

function Process({ clause, version }: { clause: AgreementClause; version: number }) {
  const navigate = useNavigate()
  const session = useReviewSession()
  const graph = capabilityGraphs[version]!

  const [view, setView] = useState<View>(EMPTY)
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState<Speed>(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : '1x',
  )
  const [opened, setOpened] = useState<Set<number>>(new Set())
  const [run, setRun] = useState(0)
  const [reproduced, setReproduced] = useState<Record<string, { identical: boolean; ms: number }>>({})

  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const speedRef = useRef(speed)
  speedRef.current = speed
  const freshRef = useRef(false)
  const stageRefs = useRef<Record<number, HTMLElement | null>>({})

  // The runner. Every value it reveals is computed by the engine first; `tick`
  // only decides when the viewer sees it.
  useEffect(() => {
    const ctl = { cancelled: false }
    const alive = () => {
      if (ctl.cancelled) throw CANCELLED
    }
    const tick = async (n: number) => {
      let left = n
      while (left > 0 || pausedRef.current) {
        alive()
        if (pausedRef.current) {
          await sleep(60)
          continue
        }
        if (speedRef.current === 'instant') break
        const slice = Math.min(left, 50)
        await sleep(slice / (speedRef.current === '2x' ? 2 : 1))
        left -= slice
      }
      alive()
    }
    const patch = (next: Partial<View> | ((v: View) => Partial<View>)) => {
      alive()
      setView((v) => ({ ...v, ...(typeof next === 'function' ? next(v) : next) }))
    }
    const reveal = (key: string, n: number) => patch((v) => ({ p: { ...v.p, [key]: n } }))
    const skip = (n: number, why: string) => patch((v) => ({ skipped: { ...v.skipped, [n]: why } }))

    /** Paths, then the decisive path's checks, then the verdict, for one evaluation. */
    const replay = async (key: string, e: Evaluated, pathMs: number, checkMs: number, parts: 'paths' | 'all') => {
      const paths = firstResult(e).candidate_paths
      for (let i = 1; i <= paths.length; i++) {
        reveal(`${key}.paths`, i)
        await tick(pathMs)
      }
      patch((v) => ({ engineMs: v.engineMs + e.ms, evaluations: v.evaluations + 1 }))
      if (parts === 'paths') return
      await tick(400)
      const checks = decisivePath(e)?.checks ?? []
      for (let i = 1; i <= checks.length; i++) {
        reveal(`${key}.checks`, i)
        await tick(checkMs)
      }
      await tick(400)
      reveal(`${key}.verdict`, 1)
    }

    const play = async () => {
      setView(EMPTY)
      setOpened(new Set())
      setReproduced({})
      await tick(600)

      // 1. Clause
      patch({ stage: 1 })
      await tick(2200)

      // 2. Extraction: once per clause. A replay or a version change reuses it.
      const fresh = freshRef.current
      freshRef.current = false
      const known = fresh ? undefined : settled.get(clause.clause_id)
      patch({ stage: 2, extractStartedAt: performance.now(), reused: known !== undefined })
      const asked = performance.now()
      const extraction = known ?? (await extractionFor(clause, fresh))
      alive()
      // Already answered before this page asked: Review's own call, earlier this session.
      const waited = performance.now() - asked
      const reused = known !== undefined || (waited < 150 && (extraction.diagnostics?.upstream_ms ?? 0) > 300)
      settled.set(clause.clause_id, extraction)
      patch({ extraction, reused })
      await tick(extraction.diagnostics && extraction.diagnostics.attempts > 1 ? 1400 : 500)
      const req = extraction.clause.requirements[0]!
      const rows = fieldRows(req)
      for (let i = 1; i <= rows.length; i++) {
        reveal('fields', i)
        await tick(120)
      }
      for (let i = 1; i <= req.ambiguities.length; i++) {
        await tick(220)
        reveal('ambiguities', i)
      }
      await tick(1400)

      // 3. Validation and hash. The same hash the engine writes into its replay record.
      patch({ stage: 3 })
      await tick(400)
      const parsed = ExtractedClauseSchema.safeParse(extraction.clause)
      if (!parsed.success) throw new Error('Extraction failed schema validation')
      const hash = `sha256:${sha256Hex(JSON.stringify(parsed.data.requirements))}`
      patch({ validatedFields: leafCount(parsed.data.requirements), hash })
      await tick(500)
      for (let i = 'sha256:'.length; i <= HASH_CHARS + 1; i++) {
        reveal('hash', i)
        await tick(30)
      }
      await tick(900)

      // 4. Path search
      patch({ stage: 4 })
      await tick(700)
      const main = timedEvaluate(parsed.data, graph, agreement.agreement_version)
      patch({ main })
      await replay('main', main, 40, 0, 'paths')
      await tick(1200)

      // 5. Checks on the decisive path
      patch({ stage: 5 })
      await tick(400)
      const checks = decisivePath(main)?.checks ?? []
      for (let i = 1; i <= checks.length; i++) {
        reveal('main.checks', i)
        await tick(80)
      }
      await tick(1600)

      // 6. Verdict
      patch({ stage: 6 })
      reveal('main.verdict', 1)
      await tick(2000)

      // 7. Repair, 8. Re-test
      if (main.report.decision === 'PASS') {
        skip(7, 'Not needed: the clause passes as drafted on a complete automated path.')
        skip(8, 'Nothing to re-test.')
      } else {
        const plan = proposeRepairs(req, firstResult(main), graph)
        patch({ stage: 7, plan })
        await tick(500)
        if (plan.proposals.length > 0) {
          for (let i = 1; i <= plan.proposals.length; i++) {
            reveal('repairs', i)
            await tick(650)
          }
          await tick(300)
          reveal('narrative', 1)
          await tick(2600)

          const requirements = parsed.data.requirements.map((r, i) => (i === 0 ? applyRepairs(r, plan.proposals) : r))
          const revised = timedEvaluate(
            { ...parsed.data, requirements },
            graph,
            `${agreement.agreement_version}+operational-alternative`,
          )
          patch({ stage: 8, revised })
          await tick(600)
          await replay('revised', revised, 15, 40, 'all')
          await tick(2400)
        } else {
          for (let i = 1; i <= plan.unrepairable.length; i++) {
            reveal('unrepairable', i)
            await tick(700)
          }
          await tick(2000)
          skip(8, 'No drafting change exists, so there is no revision to re-test.')
        }
      }

      // 9. Bank changes
      const otherVersion = GRAPH_VERSIONS.find((v) => v !== version)
      if (otherVersion !== undefined && (clause.benchmark || version !== BASE_VERSION)) {
        const other = timedEvaluate(parsed.data, capabilityGraphs[otherVersion]!, agreement.agreement_version)
        patch({ stage: 9, other })
        await tick(2200)
        await replay('other', other, 15, 40, 'all')
        await tick(2400)
      } else {
        const benchmark = agreement.clauses.find((c) => c.benchmark)
        skip(
          9,
          benchmark
            ? `Not run here: shown on the benchmark clause, Section ${benchmark.source_span.section}, where the bank changes between graph versions.`
            : 'Not run for this clause.',
        )
      }

      // 10. Record
      patch({ stage: 10, finished: true })
    }

    play().catch((err) => {
      if (err !== CANCELLED) throw err
    })
    return () => {
      ctl.cancelled = true
    }
  }, [clause, version, graph, run])

  // Bring the active stage under the control bar when it would not fit where it is.
  useEffect(() => {
    const el = stageRefs.current[view.stage]
    if (!el) return
    const frame = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect()
      if (rect.bottom > window.innerHeight - 56 || rect.top < 72) {
        el.scrollIntoView({ behavior: speedRef.current === 'instant' ? 'auto' : 'smooth', block: 'start' })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [view.stage])

  // On a short frame a re-test is taller than the screen: follow it down to its verdicts.
  const verdictsLanded = (view.p['revised.verdict'] ?? 0) + (view.p['other.verdict'] ?? 0)
  useEffect(() => {
    const el = stageRefs.current[view.stage]
    if (!el || verdictsLanded === 0) return
    if (el.getBoundingClientRect().bottom > window.innerHeight - 56) {
      el.scrollIntoView({ behavior: speedRef.current === 'instant' ? 'auto' : 'smooth', block: 'end' })
    }
  }, [verdictsLanded, view.stage])

  const restart = useCallback((fresh = false) => {
    freshRef.current = fresh
    setPaused(false)
    setRun((n) => n + 1)
  }, [])

  const go = (nextClause: string, nextVersion: number) =>
    navigate(`/run/${nextClause}${nextVersion === BASE_VERSION ? '' : `?v=${nextVersion}`}`)

  const openResults = () => {
    if (!view.extraction) return
    session.submit({ clause: view.extraction.clause, fallback_reason: view.extraction.fallback_reason, edits: [] })
    navigate('/results')
  }

  const reproduce = (key: string, e: Evaluated) => {
    const again = timedEvaluate(e.clause, e.graph, e.agreementVersion)
    const identical = JSON.stringify(again.report) === JSON.stringify(e.report)
    setReproduced((r) => ({ ...r, [key]: { identical, ms: again.ms } }))
  }

  const { extraction, main, plan, revised, other, p } = view
  const statusOf = (n: number): StageStatus =>
    view.skipped[n] ? 'skipped' : view.stage === n ? 'active' : view.stage > n ? 'done' : 'pending'
  const stage = (n: number) => ({
    n,
    status: statusOf(n),
    open: opened.has(n),
    onToggle: () =>
      setOpened((s) => {
        const next = new Set(s)
        if (!next.delete(n)) next.add(n)
        return next
      }),
    ref: (el: HTMLElement | null) => {
      stageRefs.current[n] = el
    },
  })

  const live = extraction?.clause.extraction_source === 'nemotron'
  const req = extraction?.clause.requirements[0] ?? null
  const rows = req ? fieldRows(req) : []
  const mainResult = main ? firstResult(main) : null
  const mainCounts = mainResult ? countDecisions(mainResult.candidate_paths) : null
  const mainChecks = main ? (decisivePath(main)?.checks ?? []) : []
  const checkCounts = countDecisions(mainChecks.map((k) => ({ decision: k.verdict })))
  const repairSources = plan ? [...new Set(plan.proposals.map((x) => x.capability_id))] : []
  const typeMs = speed === 'instant' ? 0 : speed === '2x' ? 160 : 320
  const animate = speed !== 'instant'

  const records: { key: string; title: string; e: Evaluated }[] = [
    ...(main ? [{ key: 'main', title: `As drafted · graph v${main.graph.version}`, e: main }] : []),
    ...(revised ? [{ key: 'revised', title: `Revision · graph v${revised.graph.version}`, e: revised }] : []),
    ...(other ? [{ key: 'other', title: `As drafted · graph v${other.graph.version}`, e: other }] : []),
  ]
  const allReproduced = records.length > 0 && records.every((r) => reproduced[r.key]?.identical)
  const phase = view.stage <= 2 ? 0 : view.stage <= 6 ? 1 : view.stage === 7 ? 2 : 3
  const decisionLabel = !main
    ? 'Checking the bank'
    : view.stage < 8 || !revised
      ? main.report.decision === 'FAIL'
        ? 'Block before signing'
        : main.report.decision === 'MANUAL'
          ? 'Operations review needed'
          : 'Safe to operate'
      : revised.report.decision === 'PASS'
        ? 'Operable after revision'
        : 'Still needs review'
  const firstConflict = mainResult?.conflicts[0]
  const decisionCaption = !main
    ? 'Searching every complete operating route.'
    : revised && view.stage >= 8 && revised.report.decision === 'PASS'
      ? 'The revised terms now fit one complete operating route.'
      : firstConflict
        ? `Contract: ${firstConflict.required}. Bank: ${firstConflict.supported}.`
        : DECISION_MEANING[main.report.decision]

  return (
    <div className="pb-14">
      {/* Controls */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-paper/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <div role="radiogroup" aria-label="Clause" className="inline-flex rounded-md border border-rule bg-rule-soft p-0.5">
          {agreement.clauses.map((c) => (
            <Segment key={c.clause_id} active={c.clause_id === clause.clause_id} onClick={() => go(c.clause_id, version)} title={c.headline}>
              §{c.source_span.section}
            </Segment>
          ))}
        </div>
        <div role="radiogroup" aria-label="Capability graph version" className="inline-flex rounded-md border border-rule bg-rule-soft p-0.5">
          {GRAPH_VERSIONS.map((v) => (
            <Segment key={v} active={v === version} onClick={() => go(clause.clause_id, v)}>
              Graph v{v}
            </Segment>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {view.finished ? (
            <Button className="min-h-9 px-3" onClick={() => restart()}>
              <RotateCcw aria-hidden className="size-4" />
              Replay
            </Button>
          ) : (
            <Button className="min-h-9 px-3" onClick={() => setPaused((x) => !x)}>
              {paused ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />}
              {paused ? 'Play' : 'Pause'}
            </Button>
          )}
          <div role="radiogroup" aria-label="Speed" className="inline-flex rounded-md border border-rule bg-rule-soft p-0.5">
            {SPEEDS.map((s) => (
              <Segment key={s.id} active={s.id === speed} onClick={() => setSpeed(s.id)}>
                {s.label}
              </Segment>
            ))}
          </div>
        </div>
        <Button variant="secondary" className="ml-auto min-h-9 px-3" disabled={!extraction} onClick={openResults}>
          Open full results
          <ArrowRight aria-hidden className="size-4" />
        </Button>
      </div>

      <section className="mt-5 overflow-hidden rounded-xl border border-rule bg-sheet shadow-sm">
        <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(22rem,1fr)] lg:px-6">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-accent uppercase">Pre-signing operations check</p>
            <h1 className="mt-2 max-w-3xl font-serif text-3xl leading-tight font-semibold sm:text-4xl">
              Can the bank deliver what this contract promises?
            </h1>
            <p className="mt-2 max-w-2xl text-base text-ink-soft">
              A deal team is ready to sign. This run tests Section {clause.source_span.section} against the bank’s real operating limits before the promise becomes binding.
            </p>
          </div>
          <div className={cn(
            'rounded-lg border px-5 py-4',
            !main && 'border-accent bg-accent-soft',
            main?.report.decision === 'FAIL' && (!revised || view.stage < 8) && 'border-fail-rule bg-fail-soft',
            main?.report.decision === 'MANUAL' && (!revised || view.stage < 8) && 'border-manual-rule bg-manual-soft',
            ((main?.report.decision === 'PASS' && (!revised || view.stage < 8)) || (revised && view.stage >= 8 && revised.report.decision === 'PASS')) && 'border-pass-rule bg-pass-soft',
          )}>
            <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Signing decision</p>
            <p className={cn(
              'mt-1 font-serif text-2xl font-semibold',
              main?.report.decision === 'FAIL' && (!revised || view.stage < 8) && 'text-fail',
              main?.report.decision === 'MANUAL' && (!revised || view.stage < 8) && 'text-manual',
              revised && view.stage >= 8 && revised.report.decision === 'PASS' && 'text-pass',
            )}>{decisionLabel}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {decisionCaption}
            </p>
          </div>
        </div>
        <ol className="grid border-t border-rule sm:grid-cols-4">
          {[
            ['1', 'Promise', 'Read the contract'],
            ['2', 'Test', 'Check the bank'],
            ['3', 'Fix', 'Draft an operable term'],
            ['4', 'Prove', 'Re-test and record'],
          ].map(([n, label, caption], i) => (
            <li key={label} className={cn('flex items-center gap-3 px-4 py-3 sm:border-r sm:border-rule sm:last:border-r-0', i < phase && 'bg-pass-soft', i === phase && 'bg-accent-soft')}>
              <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold', i < phase && 'border-pass bg-pass text-sheet', i === phase && 'border-accent bg-accent text-sheet', i > phase && 'border-rule text-ink-faint')}>{i < phase ? <Check className="size-4" /> : n}</span>
              <span><strong className="block text-sm">{label}</strong><span className="block text-xs text-ink-faint">{caption}</span></span>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-4 space-y-1.5">
        {/* 1 */}
        <Stage {...stage(1)} title="What the contract promises" summary={`§${clause.source_span.section} · ${clause.headline}`}>
          <p className="text-xs font-semibold tracking-widest text-ink-faint uppercase">
            {agreement.document} · Section {clause.source_span.section} · page {clause.source_span.page}
          </p>
          <blockquote className="mt-2 max-w-5xl border-l-2 border-accent pl-4 font-serif text-xl leading-relaxed">
            <mark className="bg-mark box-decoration-clone px-0.5">{clause.source_text}</mark>
          </blockquote>
        </Stage>

        {/* 2 */}
        <Stage
          {...stage(2)}
          title="Turn legal language into operating facts"
          summary={
            extraction &&
            `${live ? 'Live' : 'Cached fixture'} · ${extraction.clause.model ?? 'Nemotron'} · ${modelCallText(extraction)}${view.reused ? ' · reused this session' : ''} · ${extraction.clause.requirements.length} requirement${extraction.clause.requirements.length === 1 ? '' : 's'} · ${req?.ambiguities.length ?? 0} ambiguit${req?.ambiguities.length === 1 ? 'y' : 'ies'}`
          }
        >
          {!extraction ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg">
              <Loader2 aria-hidden className="size-5 animate-spin text-accent" />
              <span>
                Asking Nemotron to extract Section {clause.source_span.section}{' '}
                <span className="text-ink-soft">· attempt 1, with one retry if a guard rejects the reply ·</span>
              </span>
              {view.extractStartedAt !== null && <Elapsed since={view.extractStartedAt} />}
            </p>
          ) : (
            <div className="space-y-3">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                {live ? (
                  <Badge tone="pass">
                    <Radio aria-hidden className="size-3.5" />
                    Live Nemotron
                  </Badge>
                ) : (
                  <Badge tone="manual">
                    <DatabaseZap aria-hidden className="size-3.5" />
                    Cached fixture
                  </Badge>
                )}
                {extraction.clause.model && <Id>{extraction.clause.model}</Id>}
                <span className="text-ink-soft">
                  {extraction.diagnostics && extraction.diagnostics.attempts > 0 &&
                    `${extraction.diagnostics.attempts} attempt${extraction.diagnostics.attempts === 1 ? '' : 's'} · `}
                  {sourceDetail(extraction)}
                </span>
                {view.reused && <span className="font-medium">Reusing this session's extraction.</span>}
                {canRetryLive(extraction) && (
                  <Button variant="ghost" className="min-h-8 px-2" onClick={() => restart(true)}>
                    <RefreshCw aria-hidden className="size-3.5" />
                    Retry live
                  </Button>
                )}
              </p>
              {extraction.diagnostics && extraction.diagnostics.attempts > 1 && (
                <p className="animate-rise-in rounded-md border border-manual-rule bg-manual-soft px-3 py-2 text-sm text-manual">
                  <strong className="font-semibold">Guard:</strong>{' '}
                  {extraction.diagnostics.rejection ?? 'the first reply was rejected'} → retried
                </p>
              )}
              <FieldGrid rows={rows} shown={p.fields ?? 0} />
              {req && req.ambiguities.length > 0 && (
                <ul className="space-y-1">
                  {req.ambiguities.map((a, i) => (
                    <li
                      key={a}
                      className={cn(
                        'rounded-md border border-manual-rule bg-manual-soft px-3 py-1.5 text-sm text-manual',
                        i >= (p.ambiguities ?? 0) ? 'invisible' : 'animate-rise-in',
                      )}
                    >
                      <strong className="font-semibold">Ambiguity:</strong> {a}
                    </li>
                  ))}
                </ul>
              )}
              {extraction.clause.requirements.length > 1 && (
                <p className="text-xs text-ink-soft">
                  The first of {extraction.clause.requirements.length} requirements is followed here. Every one is in the full results.
                </p>
              )}
            </div>
          )}
        </Stage>

        {/* 3 */}
        <Stage
          {...stage(3)}
          title="Lock the inputs"
          summary={view.hash && `${shortHash(view.hash)} · graph v${version} · evaluator ${EVALUATOR_VERSION}`}
        >
          <div className="space-y-2 text-lg">
            <p className={cn('flex items-center gap-2', view.validatedFields === null && 'invisible')}>
              <Check aria-hidden className="size-5 text-pass" />
              Validated against schema · {view.validatedFields} fields
            </p>
            <p className="font-mono text-base">
              <span className="text-ink-faint">requirement_bundle_hash </span>
              <span className="font-semibold">
                {view.hash ? view.hash.slice(0, Math.min(p.hash ?? 0, HASH_CHARS)) : ''}
                {(p.hash ?? 0) > HASH_CHARS && '…'}
              </span>
            </p>
            <p className="text-sm text-ink-soft">
              Graph v{version} · evaluator {EVALUATOR_VERSION} · transaction time {TRANSACTION_TIME}
            </p>
          </div>
        </Stage>

        {/* 4 */}
        <Stage
          {...stage(4)}
          title="Test every way the bank could execute"
          summary={
            main && mainResult && mainCounts &&
            `${mainResult.candidate_paths.length} paths · ${mainCounts.PASS} pass · ${mainCounts.MANUAL} manual · ${mainCounts.FAIL} fail · engine ${ms(main.ms)}`
          }
        >
          {mainResult ? (
            <PathSearch paths={mainResult.candidate_paths} selectedId={mainResult.selected_path_id} shown={p['main.paths'] ?? 0} animate={animate} presentation />
          ) : (
            <p className="text-sm text-ink-soft">Every complete operating path through the capability graph is searched. None is skipped.</p>
          )}
        </Stage>

        {/* 5 */}
        <Stage
          {...stage(5)}
          title="Show why the best available route fails"
          summary={
            main &&
            `${mainChecks.length} checks · ${checkCounts.FAIL} fail · ${checkCounts.MANUAL} need a person · ${checkCounts.PASS} pass`
          }
        >
          <p className="mb-2 text-sm text-ink-soft">
            Every comparator on <Id>{mainResult?.selected_path_id ?? 'none'}</Id>, the path the decision is reported against.
          </p>
          <CheckTicker checks={mainChecks} shown={p['main.checks'] ?? 0} presentation />
        </Stage>

        {/* 6 */}
        <Stage
          {...stage(6)}
          title="Stop an unsupported promise before signing"
          summary={
            main && (
              <>
                <strong className={DECISION_TEXT[main.report.decision]}>{main.report.decision}</strong> · {DECISION_MEANING[main.report.decision]}
              </>
            )
          }
        >
          {main && (
            <div className="flex max-w-3xl">
              <Verdict
                arrive={animate}
                decision={main.report.decision}
                label="Operability result, as drafted"
                caption={`Tested against ${graph.institution}, capability graph v${version}.`}
              />
            </div>
          )}
        </Stage>

        {/* 7 */}
        <Stage
          {...stage(7)}
          title="Change the contract to match reality"
          summary={
            view.skipped[7] ??
            (plan &&
              (plan.proposals.length > 0
                ? `${plan.proposals.length} change${plan.proposals.length === 1 ? '' : 's'}, all traced to ${repairSources.join(', ')}`
                : `No drafting change can resolve this: ${plan.unrepairable.map((u) => u.field).join(', ')}`))
          }
        >
          {plan && plan.proposals.length > 0 && (
            <div className="space-y-3">
              <p className="max-w-prose text-sm text-ink-soft">
                Every value is a bound already in the capability graph and cites the capability it came from.
              </p>
              <RepairRows plan={plan} shown={p.repairs ?? 0} typeMs={typeMs} />
              {plan.narrative && (
                <figure className={cn('rounded-lg border border-rule bg-sheet px-4 py-3', p.narrative ? 'animate-rise-in' : 'invisible')}>
                  <figcaption className="text-xs font-semibold tracking-wider text-ink-faint uppercase">
                    Suggested drafting, generated from the changes above
                  </figcaption>
                  <p className="mt-1.5 font-serif text-base leading-relaxed">{plan.narrative}</p>
                </figure>
              )}
            </div>
          )}
          {plan && plan.proposals.length === 0 && (
            <div className="max-w-4xl rounded-lg border border-manual-rule bg-manual-soft px-4 py-3">
              <h3 className="font-semibold text-manual">
                No drafting change can resolve {plan.unrepairable.length === 1 ? 'this' : 'these'}
              </h3>
              <ul className="mt-2 space-y-2">
                {plan.unrepairable.map((u, i) => (
                  <li key={u.field} className={cn('text-base', i >= (p.unrepairable ?? 0) ? 'invisible' : 'animate-rise-in')}>
                    <Id className="mr-1.5">{u.field}</Id>
                    {u.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Stage>

        {/* 8 */}
        <Stage
          {...stage(8)}
          title="Test the revised promise"
          summary={
            view.skipped[8] ??
            (revised &&
              `Revision: ${revised.report.decision} · ${firstResult(revised).candidate_paths.length} paths · ${countDecisions(firstResult(revised).candidate_paths).PASS} pass`)
          }
        >
          {main && revised && (
            <Retest
              before={main}
              after={revised}
              k="revised"
              p={p}
              animate={animate}
              beforeLabel="As drafted"
              afterLabel="Revision, re-tested"
              afterCaption={`Same evaluator, same graph, ${plan?.proposals.length ?? 0} drafting changes applied.`}
              intro="The revised requirement goes back through the same search, the same checks and the same evaluator."
            />
          )}
        </Stage>

        {/* 9 */}
        <Stage
          {...stage(9)}
          title="What if the bank’s capabilities change?"
          summary={
            view.skipped[9] ??
            (main && other &&
              (other.graph.version > main.graph.version
                ? `Graph v${main.graph.version} → v${other.graph.version}: ${main.report.decision} → ${other.report.decision}`
                : `Graph v${other.graph.version} → v${main.graph.version}: ${other.report.decision} → ${main.report.decision}`))
          }
        >
          {main && other && (
            <Retest
              before={main}
              after={other}
              k="other"
              p={p}
              animate={animate}
              earlier={other.graph.version < main.graph.version}
              beforeLabel={`Graph v${main.graph.version}`}
              afterLabel={`Graph v${other.graph.version}`}
              afterCaption="Same extracted clause, same requirement hash. Nothing was re-extracted and no model was called."
              intro={
                <>
                  <strong className="font-semibold text-ink">
                    Capability graph v{Math.min(main.graph.version, other.graph.version)} → v
                    {Math.max(main.graph.version, other.graph.version)}:
                  </strong>{' '}
                  {changelogEntry(other.graph.version > main.graph.version ? other.graph : main.graph).text}
                  {other.graph.version < main.graph.version &&
                    ` Replayed here on v${other.graph.version}, the bank before that change.`}
                </>
              }
            />
          )}
        </Stage>

        {/* 10 */}
        <Stage
          {...stage(10)}
          title="Leave an audit trail"
          summary={view.hash && `${allReproduced ? 'Reproducible' : 'Replay record'} · ${shortHash(view.hash)}`}
        >
          <p className="mb-3 text-sm text-ink-soft">
            These records prove which contract terms, bank rules and engine version produced each answer.{' '}
            {view.hash && records.every((r) => r.key === 'revised' || r.e.report.replay.requirement_bundle_hash === view.hash) &&
              'Both records use the locked input from this run.'}{' '}
            Reproduce runs the same test again and compares every output.
          </p>
          <div className={cn('grid gap-3', records.length > 1 && 'xl:grid-cols-2')}>
            {records.map(({ key, title, e }) => {
              const again = reproduced[key]
              return (
                <RecordPanel key={key} title={title} record={e.report.replay} decision={e.report.decision}>
                  {again && (
                    <span role="status" className={cn('flex items-center gap-1 font-semibold', again.identical ? 'text-pass' : 'text-fail')}>
                      {again.identical && <Check aria-hidden className="size-4" />}
                      {again.identical ? 'identical' : 'DIFFERENT'} · {ms(again.ms)}
                    </span>
                  )}
                  <Button variant="secondary" className="min-h-8 px-3" onClick={() => reproduce(key, e)}>
                    <RefreshCw aria-hidden className="size-3.5" />
                    Reproduce
                  </Button>
                </RecordPanel>
              )
            })}
          </div>
        </Stage>
      </div>

      {/* Status line: the real times, always on screen. */}
      <p
        role="status"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-ink bg-ink px-4 py-2.5 text-center font-mono text-sm text-sheet sm:px-6"
      >
        Engine compute this run:{' '}
        <strong className="tabular-nums">
          {view.evaluations === 0 ? 'not run yet' : `${ms(view.engineMs)} (${view.evaluations} evaluation${view.evaluations === 1 ? '' : 's'})`}
        </strong>{' '}
        · Model call: <strong className="tabular-nums">{modelCallText(extraction)}</strong> · Paced for viewing — every value on
        screen is real output.
      </p>
    </div>
  )
}

function Segment({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      title={title}
      onClick={onClick}
      className={cn(
        'min-h-8 rounded px-3 text-sm font-semibold transition-colors',
        active ? 'bg-sheet text-ink shadow-sm' : 'text-ink-soft hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

/** Stages 4 to 6 again, compressed, on a second evaluation, ending with both verdicts side by side. */
function Retest({
  before,
  after,
  k,
  p,
  animate,
  intro,
  beforeLabel,
  afterLabel,
  afterCaption,
  earlier = false,
}: {
  /** The second evaluation is of an EARLIER bank: its verdict goes on the left, so time reads left to right. */
  earlier?: boolean
  before: Evaluated
  after: Evaluated
  k: string
  p: Record<string, number>
  animate: boolean
  intro: ReactNode
  beforeLabel: string
  afterLabel: string
  afterCaption: string
}) {
  const result = firstResult(after)
  return (
    <div className="space-y-3">
      <p className="max-w-5xl text-base text-ink-soft">{intro}</p>
      <PathSearch paths={result.candidate_paths} selectedId={result.selected_path_id} shown={p[`${k}.paths`] ?? 0} dense animate={animate} presentation />
      <CheckTicker checks={decisivePath(after)?.checks ?? []} shown={p[`${k}.checks`] ?? 0} dense presentation />
      <div className={cn('flex flex-col items-stretch gap-3', earlier ? 'md:flex-row-reverse' : 'md:flex-row')}>
        <Verdict
          decision={before.report.decision}
          label={beforeLabel}
          caption={`Tested against ${before.graph.institution}, capability graph v${before.graph.version}.`}
        />
        <Fragment>
          <div aria-hidden className={cn('flex items-center justify-center text-ink-faint md:w-20', !p[`${k}.verdict`] && 'invisible')}>
            <span className={cn('hidden h-px flex-1 origin-left bg-ink-faint md:block', p[`${k}.verdict`] && animate && !earlier && 'animate-draw')} />
            <ArrowRight className="-ml-2 hidden size-6 shrink-0 md:block" />
          </div>
          <div className={cn('flex flex-1', !p[`${k}.verdict`] && 'invisible')}>
            {/* Mounted only on arrival, so the existing arrival animation plays then. */}
            {p[`${k}.verdict`] ? (
              <Verdict arrive={animate} decision={after.report.decision} label={afterLabel} caption={afterCaption} />
            ) : (
              <Verdict decision={before.report.decision} label={afterLabel} caption={afterCaption} />
            )}
          </div>
        </Fragment>
      </div>
    </div>
  )
}
