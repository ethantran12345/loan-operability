import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AgreementPane } from '@/components/dryrun/AgreementPane'
import { DemoDrawer } from '@/components/dryrun/DemoDrawer'
import { FindingCard } from '@/components/dryrun/FindingCard'
import { FitColumn } from '@/components/dryrun/FitColumn'
import { IntakePanel } from '@/components/dryrun/IntakePanel'
import { ACT_ONE, cardPlan, revealed, sweeping } from '@/components/dryrun/reveal'
import { changelogEntry } from '@/components/results/GraphVersion'
import { paragraphAnchor } from '@/components/workspace/DocumentViewer'
import type { ToneSpan } from '@/components/workspace/Marked'
import { mostSevere } from '@/domain/evaluate'
import { TRANSACTION_TIME, agreement, capabilityGraph, capabilityGraphs } from '@/domain/fixtures'
import { applyRepairs } from '@/domain/repair'
import { buildComparisonPacket } from '@/documents/bundle'
import { evidenceForCheck, type EvidencePassage } from '@/documents/citations'
import { checkIntake, rememberIntake, rememberedIntake, sampleIntakeFiles, type IntakeFile } from '@/documents/intake'
import { locateFailing } from '@/documents/locate'
import { extractionFor, type Extraction } from '@/lib/extractClient'
import { readIntakeFile } from '@/lib/dropFiles'
import { countDecisions, ms, seconds } from '@/lib/runFormat'
import { useReviewSession } from '@/lib/session'
import { decisivePath, firstResult, timedEvaluate, useAgreementReview, type Evaluated } from '@/lib/useAgreementReview'

const BASE_VERSION = capabilityGraph.version
const TONE = { FAIL: 'fail', MANUAL: 'manual', PASS: 'pass' } as const

/**
 * A response that has landed on its card. `at` is when its reveal began: the
 * moment it arrived, or the end of act one if it beat that. `fromRoutes` replays
 * only the engine's half, for a registry switch that re-checks the same terms.
 */
interface Landed {
  extraction: Extraction
  at: number
  fromRoutes: boolean
}

/** How often the screen re-reads the clock while a reveal is playing. The work itself never waits on this. */
const TICK_MS = 50

/** A run this page load has already finished, so coming back from a demo view does not ask for it again. */
let ranThisLoad = false

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** The product: one agreement, its findings, and five controls. Everything for a judge is in the Demo drawer. */
export function Dryrun() {
  const navigate = useNavigate()
  const session = useReviewSession()
  const [search, setSearch] = useSearchParams()
  const asked = Number(search.get('v'))
  const version = asked in capabilityGraphs ? asked : BASE_VERSION
  const graph = capabilityGraphs[version]!

  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  // When Run was pressed. A run this page load already finished is shown whole: there is nothing left to reveal.
  const [startedAt, setStartedAt] = useState<number | null>(ranThisLoad ? -Infinity : null)
  const started = startedAt !== null
  // What the analyst handed over. The run reads these files and no others: until they make a whole packet, nothing is read.
  const [files, setFiles] = useState<IntakeFile[]>(rememberedIntake)
  const intake = useMemo(() => checkIntake(files, version), [files, version])
  const run = useAgreementReview(version, started, intake.ready ? files : null)
  const { packet, citations } = run
  // Findings follow the document, not the fixture's listing order.
  const clauses = useMemo(() => [...run.clauses].sort((a, b) => a.clause.start - b.clause.start), [run.clauses])

  const [expandedId, setExpandedId] = useState<string | null>(null)
  /** The card under the cursor or holding keyboard focus. */
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  /** The intake file open in the reader before a run. */
  const [reading, setReading] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ clauseId: string; checkIndex: number } | null>(null)
  const [procedure, setProcedure] = useState<EvidencePassage | null>(null)
  const [retests, setRetests] = useState<Record<string, Evaluated>>({})
  const [landed, setLanded] = useState<Record<string, Landed>>({})
  /** clause_id -> when "Try live again" asked, so that card's wait counts from its own request. */
  const [askedAgain, setAskedAgain] = useState<Record<string, number>>({})
  /** clause_id -> when Apply fix was pressed. */
  const [applied, setApplied] = useState<Record<string, number>>({})
  const [now, setNow] = useState(() => performance.now())
  const [jump, setJump] = useState<{ anchor: string; card: string | null; n: number } | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const closeDrawer = useCallback(() => setDrawer(false), [])

  useEffect(() => rememberIntake(files), [files])
  // A registry switch can ask for a policy that was never handed over. The run goes back to intake and names it.
  useEffect(() => {
    if (!started || intake.ready) return
    ranThisLoad = false
    setStartedAt(null)
  }, [started, intake.ready])

  const addFiles = useCallback((list: File[]) => {
    if (list.length === 0) return
    void Promise.all(list.map(readIntakeFile)).then((incoming) =>
      // A file handed over again replaces the one with its name. Sample files never sit beside dropped ones.
      setFiles((prev) => [...prev.filter((p) => p.source === 'dropped' && !incoming.some((f) => f.file === p.file)), ...incoming]),
    )
  }, [])

  // A response lands when the hook hands it over. Its reveal starts then, or after act one, whichever is later.
  useEffect(() => {
    if (startedAt === null) return
    setLanded((prev) => {
      let next = prev
      for (const c of clauses) {
        const id = c.clause.clause_id
        if (c.extraction && c.evaluated) {
          if (prev[id]?.extraction === c.extraction) continue
          const at = startedAt === -Infinity && askedAgain[id] === undefined ? -Infinity : Math.max(performance.now(), startedAt + (still ? 0 : ACT_ONE.hold))
          next = { ...next, [id]: { extraction: c.extraction, at, fromRoutes: false } }
        } else if (prev[id]) {
          const { [id]: _gone, ...rest } = next
          next = rest
        }
      }
      return next
    })
  }, [clauses, startedAt, still, askedAgain])

  // Where every card is in its reveal, from the one clock. The margin pill reads the same numbers as the card.
  const cards = clauses.map((c) => {
    const id = c.clause.clause_id
    const hit = landed[id]
    const askedAt = askedAgain[id] ?? (startedAt !== null && Number.isFinite(startedAt) ? startedAt : now)
    if (!hit || hit.extraction !== c.extraction || !c.evaluated) return { review: c, id, askedAt, t: null, repairT: null, plan: null, stamped: false, ready: false, flipped: false, settled: false, swept: false }
    const plan = cardPlan(c, retests[id] ?? null, still)
    const since = now - hit.at + (hit.fromRoutes ? plan.line.counter : 0)
    const t = since < 0 ? null : since
    const repairT = plan.repair && applied[id] !== undefined ? Math.max(0, now - applied[id]!) : plan.repair ? Infinity : null
    const ready = t !== null && t >= plan.line.done
    const flipped = plan.repair !== null && repairT !== null && repairT >= plan.repair.line.pill
    return {
      review: c,
      id,
      askedAt,
      t,
      repairT,
      plan,
      stamped: t !== null && t >= plan.line.pill,
      ready,
      flipped,
      settled: ready && (plan.repair === null || (repairT !== null && repairT >= plan.repair.line.done)),
      swept: t !== null && !hit.fromRoutes && !still && sweeping(t),
    }
  })
  const done = started && cards.length > 0 && cards.every((c) => c.ready)
  // The column is shorter than four live cards, so the card a response has just landed on is brought into view.
  // It is followed again as it grows: once its terms are in, and once its marks are.
  const latest = cards.filter((c) => c.t !== null && !c.ready).sort((a, b) => a.t! - b.t!)[0]
  const following = latest ? `${latest.id}|${latest.t! < latest.plan!.line.counter ? 0 : latest.t! < latest.plan!.line.pill ? 1 : 2}` : ''
  useEffect(() => {
    const id = following.split('|')[0]
    if (!id) return
    const behavior = still ? 'auto' : 'smooth'
    // When the whole run is already on screen, chasing the latest card would only move the picture.
    const column = document.querySelector('[data-scroll="findings"]')
    const card = document.querySelector(`[data-clause="${id}"]`)
    if (column && card) {
      const frame = column.getBoundingClientRect()
      const box = card.getBoundingClientRect()
      if (box.bottom > frame.bottom + 1 || box.top < frame.top - 1) card.scrollIntoView({ block: 'nearest', behavior })
    }
    // The sweep is on the clause itself, so the document shows that clause as its response lands.
    if (following.endsWith('|0')) document.querySelector(`[data-sweep="${id}"]`)?.parentElement?.scrollIntoView({ block: 'nearest', behavior })
  }, [following, still])
  const playing = started && (cards.length === 0 || cards.some((c) => !c.settled))
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setNow(performance.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [playing])
  useEffect(() => {
    if (done) ranThisLoad = true
  }, [done])

  // Navigation the analyst asked for. Nothing else moves the scroll position.
  useEffect(() => {
    if (!jump) return
    document.getElementById(jump.anchor)?.scrollIntoView({ block: 'center' })
    if (jump.card) document.querySelector(`[data-clause="${jump.card}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [jump])

  const reset = () => {
    setRetests({})
    setApplied({})
    setFocus(null)
    setProcedure(null)
  }
  const begin = () => {
    const at = performance.now()
    setAskedAgain({})
    setLanded({})
    setNow(at)
    setStartedAt(at)
  }
  // Act one happens in Article II, so that is where the document goes. The agreement is only
  // on screen once the run has started, so this waits for that render.
  useEffect(() => {
    if (startedAt === null || !Number.isFinite(startedAt)) return
    const first = clauses[0]
    const pane = document.querySelector('[data-scroll="document"]')
    const target = first && packet && document.getElementById(paragraphAnchor(packet.agreement.meta.document_id, first.clause.start))
    if (pane && target) {
      const top = pane.scrollTop + target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 96
      pane.scrollTo({ top, behavior: still ? 'auto' : 'smooth' })
    }
    // Once per run: the clauses are already read when Run is pressed.
  }, [startedAt])
  const start = begin
  const runAgain = () => {
    reset()
    setExpandedId(null)
    run.rerun()
    begin()
  }

  const doc = (procedure && packet?.documents.find((d) => d.meta.document_id === procedure.document_id)) || packet?.agreement || null

  // The card under the cursor, else the open one, once its verdict is stamped: a mark never gets ahead of its card.
  const markedId = [hoveredId, expandedId].find((id) => id !== null && cards.some((c) => c.id === id && c.stamped)) ?? null
  const spans = useMemo<ToneSpan[]>(() => {
    if (!packet || !citations || !doc) return []
    if (doc.meta.kind === 'agreement') {
      // Every term of that clause that did not pass, in the agreement's own words. No click asks for it.
      const review = clauses.find((c) => c.clause.clause_id === markedId)
      const checks = review?.evaluated && decisivePath(review.evaluated)?.checks
      if (!review || !checks) return []
      return locateFailing(review.clause.source_text, review.clause.start, checks).map((t) => ({ ...t, tone: TONE[t.verdict] }))
    }
    // A procedure is only open because one check cited it: its evidence for that check.
    const review = focus && clauses.find((c) => c.clause.clause_id === focus.clauseId)
    const check = review && review.evaluated && decisivePath(review.evaluated)?.checks[focus.checkIndex]
    if (!check) return []
    return evidenceForCheck(check, citations, graph)
      .filter((p) => p.document_id === doc.meta.document_id)
      .flatMap((p) => p.highlights.map((h) => ({ ...h, tone: TONE[check.verdict] })))
  }, [markedId, focus, packet, citations, doc, clauses, graph])

  const goTo = (docId: string, start: number, card: string | null) =>
    setJump((j) => ({ anchor: paragraphAnchor(docId, start), card, n: (j?.n ?? 0) + 1 }))

  /** From the document: open that finding. From a card: toggle it, and show its clause. */
  const selectClause = (clauseId: string, from: 'document' | 'card') => {
    const review = clauses.find((c) => c.clause.clause_id === clauseId)
    if (!review || !packet) return
    const closing = from === 'card' && expandedId === clauseId
    setExpandedId(closing ? null : clauseId)
    if (focus?.clauseId !== clauseId || closing) setFocus(null)
    if (closing) return
    setProcedure(null)
    goTo(packet.agreement.meta.document_id, review.clause.start, from === 'document' ? clauseId : null)
  }

  const applyFix = (clauseId: string) => {
    const review = clauses.find((c) => c.clause.clause_id === clauseId)
    if (!review?.extraction || !review.plan || !packet) return
    const requirements = review.extraction.clause.requirements.map((r, i) => (i === 0 ? applyRepairs(r, review.plan!.proposals) : r))
    const retest = timedEvaluate({ ...review.extraction.clause, requirements }, graph, `${packet.agreement.meta.version}+proposed-amendment`)
    setRetests((r) => ({ ...r, [clauseId]: retest }))
    setApplied((a) => ({ ...a, [clauseId]: performance.now() }))
    setNow(performance.now())
    // Bring the card's pills into view: FAIL → PASS is the point of the re-test.
    requestAnimationFrame(() => document.querySelector(`[data-clause="${clauseId}"]`)?.scrollIntoView({ block: 'start' }))
  }

  const switchVersion = (v: number) => {
    setDrawer(false)
    if (v === version) return
    reset()
    setSearch(v === BASE_VERSION ? {} : { v: String(v) }, { replace: true })
    // Same extracted terms, re-checked against the other registry. No model call, so only the engine's half replays.
    const at = performance.now()
    setNow(at)
    setLanded((l) => Object.fromEntries(Object.entries(l).map(([id, hit]) => [id, { ...hit, at, fromRoutes: true }])))
  }

  const currentClauseId = expandedId ?? agreement.clauses[0]!.clause_id
  const withSubmission = async (to: string) => {
    const review = clauses.find((c) => c.clause.clause_id === currentClauseId)
    if (!review) return
    // Results works on extracted terms. Before a run there are none yet, so ask for them now.
    if (!review.extraction) setBusy(`Extracting §${review.clause.source_span.section} first…`)
    const extraction = review.extraction ?? (await extractionFor(review.clause))
    session.submit({ clause: extraction.clause, fallback_reason: extraction.fallback_reason, edits: [] })
    navigate(to)
  }

  const chatPacket = () => (packet ? buildComparisonPacket(packet, graph, TRANSACTION_TIME) : '')
  const copyPacket = async () => {
    const text = chatPacket()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(`Copied ${text.length.toLocaleString('en-US')} characters`)
    } catch {
      setCopied('Copy was blocked. Use the download instead.')
    }
  }

  const decided = clauses.flatMap((c) => (c.evaluated ? [c.evaluated.report.decision] : []))
  const exportRecord = () => {
    if (!packet || !done) return
    const record = {
      product: 'Dryrun',
      notice: `${agreement.disclaimer} ${graph.disclaimer}`,
      agreement: { document_id: packet.agreement.meta.document_id, version: packet.agreement.meta.version, sha256: packet.agreement.sha256 },
      packet: {
        source: intake.source === 'sample' ? 'sample packet bundled with the app' : 'files handed over by the analyst',
        documents: packet.documents.map((d) => ({ file: d.file, document_id: d.meta.document_id, version: d.meta.version, sha256: d.sha256 })),
      },
      registry_version: version,
      transaction_time: TRANSACTION_TIME,
      decision: mostSevere(decided),
      clauses: clauses.map((c) => ({
        clause_id: c.clause.clause_id,
        section: c.clause.source_span.section,
        decision: c.evaluated!.report.decision,
        extraction_source: c.extraction!.clause.extraction_source,
        replay: c.evaluated!.report.replay,
        retest: retests[c.clause.clause_id]
          ? {
              proposals: c.plan?.proposals.map(({ field, from, to, capability_id }) => ({ field, from, to, capability_id })),
              decision: retests[c.clause.clause_id]!.report.decision,
              replay: retests[c.clause.clause_id]!.report.replay,
            }
          : null,
      })),
    }
    download(`dryrun-record.registry-v${version}.json`, JSON.stringify(record, null, 2), 'application/json')
  }

  const demoDrawer = (diagnostics: string | null) =>
    drawer && (
        <DemoDrawer
          version={version}
          clauses={clauses}
          diagnostics={diagnostics}
          copied={copied}
          busy={busy}
          onClose={closeDrawer}
          onVersion={switchVersion}
          onCopyPacket={copyPacket}
          onDownloadPacket={() => download(`dryrun-chat-packet.registry-v${version}.txt`, chatPacket(), 'text/plain')}
          onChallenge={() => void withSubmission('/results#challenge-title')}
          onWatchRun={() => navigate(`/run/${currentClauseId}${version === BASE_VERSION ? '' : `?v=${version}`}`)}
          onTechnical={() => void withSubmission('/results')}
          onWorkspace={() => navigate(`/workspace${version === BASE_VERSION ? '' : `?v=${version}`}`)}
          onRetryLive={(clauseId) => {
            // New terms invalidate a re-test of the old ones.
            setRetests(({ [clauseId]: _stale, ...rest }) => rest)
            setApplied(({ [clauseId]: _then, ...rest }) => rest)
            setAskedAgain((a) => ({ ...a, [clauseId]: performance.now() }))
            setNow(performance.now())
            if (focus?.clauseId === clauseId) setFocus(null)
            run.retryLive(clauseId)
          }}
        />
    )
  const footer = (
      <footer className="flex shrink-0 items-center gap-4 border-t border-rule bg-sheet px-5 py-1.5 text-xs text-ink-faint">
        <p className="min-w-0 truncate" title={`${agreement.disclaimer} ${capabilityGraph.disclaimer}`}>
          <span className="font-semibold text-ink-soft">Synthetic data</span> built for a hackathon demonstration. Not a real credit agreement, not
          any real bank's operations, and not legal or financial advice.
        </p>
        <button
          type="button"
          data-control="export"
          disabled={!done}
          title={done ? 'Download the replay record of this run as JSON' : 'Run a dry run first'}
          onClick={exportRecord}
          className="ml-auto shrink-0 text-ink-soft underline underline-offset-2 hover:text-ink disabled:cursor-not-allowed disabled:text-ink-faint disabled:no-underline"
        >
          Export record
        </button>
      </footer>
  )

  // Before a run, and whenever the files on hand do not make a packet, the screen is the intake.
  // A packet the reader refuses is said here, by its reason, instead of blanking the product.
  if (!started || !packet || !citations || !doc) {
    const canRun = intake.ready && packet !== null && !run.readError
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-paper">
        <header className="flex shrink-0 items-center gap-4 border-b border-rule bg-sheet px-5 py-2.5">
          <p className="flex items-baseline gap-2.5 whitespace-nowrap">
            <span className="text-[0.95rem] font-semibold tracking-tight">Dryrun</span>
            <span className="text-xs text-ink-faint">Dry-run the loan before you sign.</span>
          </p>
          <div className="ml-auto flex items-center gap-4 whitespace-nowrap">
            <button
              type="button"
              data-control="run"
              disabled={!canRun}
              title={canRun ? undefined : 'Hand over the agreement and every policy this registry version needs first'}
              onClick={start}
              className="rounded-md bg-ink px-4 py-1.5 text-sm font-semibold text-sheet hover:bg-ink-soft disabled:cursor-not-allowed disabled:bg-rule disabled:text-ink-faint"
            >
              Run dry run
            </button>
            <p data-testid="registry-label" className="text-xs text-ink-faint">
              Registry v{version}
              {citations ? ` · ${citations.verified}/${citations.verified + citations.mismatched} citations verified` : ''}
            </p>
            <button
              type="button"
              data-control="demo"
              aria-haspopup="dialog"
              onClick={() => setDrawer(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-ink-soft hover:bg-rule-soft hover:text-ink"
            >
              <FlaskConical aria-hidden className="size-4" />
              Demo tools
            </button>
          </div>
        </header>
        <IntakePanel
          intake={intake}
          readError={run.readError}
          reading={reading}
          onRead={setReading}
          onFiles={addFiles}
          onSample={() => {
            // Nobody has seen the sample's files, so the agreement opens: what is about to be tested, before Run.
            const sample = sampleIntakeFiles()
            setFiles(sample)
            setReading(checkIntake(sample, version).entries.find((e) => e.doc?.meta.kind === 'agreement')?.file ?? null)
          }}
          onRemove={(file) => setFiles((prev) => prev.filter((f) => f.file !== file))}
          onClear={() => setFiles([])}
        />
        {footer}
        {demoDrawer(null)}
      </div>
    )
  }

  const extracted = clauses.filter((c) => c.extraction)
  const live = extracted.filter((c) => c.extraction!.clause.extraction_source === 'nemotron').length
  const routes = clauses.reduce((n, c) => n + (c.evaluated ? firstResult(c.evaluated).candidate_paths.length : 0), 0)
  const counts = countDecisions(decided.map((decision) => ({ decision })))
  const entry = changelogEntry(graph).label.match(/^(v\d+) \((.+)\)$/)
  const found = started ? revealed(now - startedAt, 0, still ? 0 : ACT_ONE.every, clauses.length) : 0
  const actOne = started && !still && now - startedAt < ACT_ONE.hold
  const checked = cards.filter((c) => c.stamped)
  const checkedCounts = countDecisions(checked.map((c) => ({ decision: c.review.evaluated!.report.decision })))
  // The status line only ever adds up what is already on screen.
  const answered = cards.filter((c) => c.t !== null)
  const liveMs = answered.flatMap((c) => (c.review.extraction!.clause.extraction_source === 'nemotron' && c.review.extraction!.diagnostics ? [c.review.extraction!.diagnostics.upstream_ms] : []))
  const answeredLive = answered.filter((c) => c.review.extraction!.clause.extraction_source === 'nemotron').length
  const searched = cards.filter((c) => c.t !== null && c.plan && c.t >= c.plan.line.counter + c.plan.line.counterMs)
  const searchedRoutes = searched.reduce((n, c) => n + firstResult(c.review.evaluated!).candidate_paths.length, 0)
  const searchedMs = searched.reduce((n, c) => n + c.review.evaluated!.ms, 0)
  const statusLine = [
    answered.length === 0
      ? `Nemotron reading ${clauses.length} clauses`
      : `Nemotron ${answered.length < clauses.length ? `${answered.length} of ${clauses.length}` : clauses.length} clauses${
          answeredLive < answered.length ? ` · ${answeredLive} live, ${answered.length - answeredLive} cached` : ''
        }${liveMs.length > 0 ? ` · ${liveMs.length > 1 ? `${seconds(Math.min(...liveMs)).replace(' s', '')}–` : ''}${seconds(Math.max(...liveMs))}` : ''}`,
    searched.length > 0 ? `Engine ${searchedRoutes} routes · ${ms(searchedMs)}` : 'Engine waiting for terms',
    'every value shown is real output, paced for reading.',
  ].join(' · ')
  const retested = Object.fromEntries(cards.flatMap((c) => (c.flipped ? [[c.id, retests[c.id]!.report.decision]] : [])))
  const diagnostics = done
    ? `${packet.documents.length} files read in ${ms(packet.read_ms)} · ${citations.verified}/${citations.verified + citations.mismatched} citations verified · ${live} live, ${extracted.length - live} cached · ${routes} routes in ${ms(clauses.reduce((n, c) => n + (c.evaluated?.ms ?? 0), 0))}`
    : null

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper">
      <header className="flex shrink-0 items-center gap-4 border-b border-rule bg-sheet px-5 py-2.5">
        <p className="flex items-baseline gap-2.5 whitespace-nowrap">
          <span className="text-[0.95rem] font-semibold tracking-tight">Dryrun</span>
          <span className="text-xs text-ink-faint">Dry-run the loan before you sign.</span>
        </p>
        <div className="ml-auto flex items-center gap-4 whitespace-nowrap">
          {!started ? (
            <button type="button" data-control="run" onClick={start} className="rounded-md bg-ink px-4 py-1.5 text-sm font-semibold text-sheet hover:bg-ink-soft">
              Run dry run
            </button>
          ) : !done ? (
            <p role="status" data-testid="run-state" className="rounded-md bg-rule-soft px-4 py-1.5 text-sm font-semibold text-ink-soft tabular-nums">
              {actOne
                ? `Reading the agreement · ${found} borrowing ${found === 1 ? 'clause' : 'clauses'} found`
                : [
                    `${checked.length} of ${clauses.length} checked`,
                    checkedCounts.FAIL > 0 && `${checkedCounts.FAIL} fail`,
                    checkedCounts.MANUAL > 0 && `${checkedCounts.MANUAL} ${checkedCounts.MANUAL === 1 ? 'needs' : 'need'} a person`,
                    checkedCounts.PASS > 0 && `${checkedCounts.PASS} pass`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </p>
          ) : (
            <p role="status" data-testid="run-state" className="text-sm">
              <span className="font-semibold">
                {counts.FAIL + counts.MANUAL} {counts.FAIL + counts.MANUAL === 1 ? 'finding' : 'findings'} · {counts.FAIL} fail · {counts.MANUAL}{' '}
                {counts.MANUAL === 1 ? 'needs' : 'need'} a person · {counts.PASS} pass
              </span>{' '}
              <button type="button" data-control="run" onClick={runAgain} className="ml-1.5 text-ink-soft underline underline-offset-2 hover:text-ink">
                Run again
              </button>
            </p>
          )}
          <p data-testid="registry-label" className="text-xs text-ink-faint">
            <span data-testid="packet-source" className={intake.source === 'sample' ? 'font-semibold text-accent' : undefined}>
              {intake.source === 'sample' ? 'Sample packet' : `${packet.documents.length} files handed over`}
            </span>
            {' · '}
            Registry {entry ? `${entry[1]} · ${entry[2]}` : `v${version}`} · {citations.verified}/{citations.verified + citations.mismatched} citations verified
          </p>
          <button
            type="button"
            data-control="demo"
            aria-haspopup="dialog"
            onClick={() => setDrawer(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-ink-soft hover:bg-rule-soft hover:text-ink"
          >
            <FlaskConical aria-hidden className="size-4" />
            Demo tools
          </button>
        </div>
      </header>
      {started && (
        <p data-testid="status-line" className="shrink-0 truncate border-b border-rule-soft bg-sheet px-5 py-1 text-xs text-ink-faint tabular-nums">
          {statusLine}
        </p>
      )}

      <main id="main" className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_28.75rem]">
        <section aria-label={doc.meta.kind === 'agreement' ? 'The agreement' : 'Bank procedure'} className="min-h-0 min-w-0">
          <AgreementPane
            doc={doc}
            clauses={clauses}
            found={new Set(cards.slice(0, found).map((c) => c.id))}
            swept={new Set(cards.filter((c) => c.swept).map((c) => c.id))}
            stamped={new Set(cards.filter((c) => c.stamped).map((c) => c.id))}
            still={still}
            retested={retested}
            selectedClauseId={expandedId}
            spans={spans}
            onSelectClause={(id) => selectClause(id, 'document')}
            onBack={
              procedure
                ? () => {
                    setProcedure(null)
                    const back = clauses.find((c) => c.clause.clause_id === (focus?.clauseId ?? expandedId))
                    if (back) goTo(packet.agreement.meta.document_id, back.clause.start, null)
                  }
                : null
            }
          />
        </section>

        <aside aria-label="Findings" className="grid min-h-0 border-l border-rule">
          <FitColumn active={started && expandedId === null} resetKey={startedAt} scrollName="findings">
            <div className="px-5 py-4">
            {started ? (
            <ul className="space-y-2">
              {cards.slice(0, found).map(({ review: c, id, askedAt, t, repairT }) => {
                return (
                  <FindingCard
                    key={id}
                    review={c}
                    graph={graph}
                    citations={citations}
                    expanded={expandedId === id}
                    retest={retests[id] ?? null}
                    pacing={{ t, askedAt, repairT, still }}
                    onToggle={() => selectClause(id, 'card')}
                    onHover={(over) => setHoveredId((h) => (over ? id : h === id ? null : h))}
                    onApply={() => applyFix(id)}
                    onOpenAgreement={(checkIndex) => {
                      setFocus({ clauseId: id, checkIndex })
                      setProcedure(null)
                      goTo(packet.agreement.meta.document_id, c.clause.start, null)
                    }}
                    onOpenProcedure={(checkIndex, passage) => {
                      setFocus({ clauseId: id, checkIndex })
                      setProcedure(passage)
                      goTo(passage.document_id, passage.paragraphs[0]!.start, null)
                    }}
                  />
                )
              })}
            </ul>
          ) : (
            <p className="text-sm leading-relaxed text-ink-soft">
              Run a dry run to check this agreement against the bank's verified capabilities
            </p>
          )}
            </div>
          </FitColumn>
        </aside>
      </main>

      {footer}

      {demoDrawer(diagnostics)}
    </div>
  )
}
