import { useEffect, useRef } from 'react'
import { ArrowRight, DatabaseZap, Loader2, MousePointerClick, Radio } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { RequirementCard, parseAmountDraft } from '@/components/review/RequirementCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { agreement } from '@/domain/fixtures'
import { cn } from '@/lib/cn'
import { requestExtraction, sourceDetail } from '@/lib/extractClient'
import { useReviewSession, type ReviewerEdit } from '@/lib/session'

export function Review() {
  const navigate = useNavigate()
  const session = useReviewSession()
  const { selectedClauseId, extraction, amountDrafts, setExtraction } = session
  const panelRef = useRef<HTMLElement>(null)

  const selected = agreement.clauses.find((c) => c.clause_id === selectedClauseId) ?? null
  const loading = selected !== null && extraction === null

  useEffect(() => {
    if (!selected || extraction) return
    const controller = new AbortController()
    requestExtraction(selected, controller.signal)
      .then(setExtraction)
      .catch(() => {
        // Aborted: a different clause was selected before this one came back.
      })
    return () => controller.abort()
  }, [selected, extraction, setExtraction])

  const choose = (clauseId: string) => {
    if (clauseId === selectedClauseId) return
    session.select(clauseId)
    // On a single-column layout the panel sits below the agreement.
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() =>
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      )
    }
  }

  const invalidDraft =
    extraction?.clause.requirements.some(
      (r) => amountDrafts[r.requirement_id] !== undefined && parseAmountDraft(amountDrafts[r.requirement_id]) === null,
    ) ?? false

  const run = () => {
    if (!extraction || invalidDraft) return
    const edits: ReviewerEdit[] = []
    const requirements = extraction.clause.requirements.map((r) => {
      const to = parseAmountDraft(amountDrafts[r.requirement_id])
      if (to === null || r.amount === null || to === r.amount.value) return r
      edits.push({ requirement_id: r.requirement_id, field: 'amount.value', from: r.amount.value, to })
      return { ...r, amount: { ...r.amount, value: to } }
    })
    session.submit({
      clause: { ...extraction.clause, requirements },
      fallback_reason: extraction.fallback_reason,
      edits,
    })
    navigate('/results')
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-8">
      <section aria-labelledby="agreement-title">
        <div className="rounded-lg border border-rule bg-sheet px-5 py-6 shadow-[0_1px_0_var(--color-rule)] sm:px-10 sm:py-9">
          <p className="text-xs font-semibold tracking-widest text-ink-faint uppercase">
            {agreement.agreement_version} · {agreement.document}
          </p>
          <h1 id="agreement-title" className="mt-2 font-serif text-2xl leading-tight sm:text-3xl">
            {agreement.title}
          </h1>
          <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
            <MousePointerClick aria-hidden className="size-4 shrink-0" />
            Three clauses are under review. Select one to extract its operational requirements.
          </p>

          <ol className="mt-6 space-y-3">
            {agreement.clauses.map((c) => {
              const active = c.clause_id === selectedClauseId
              return (
                <li key={c.clause_id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    aria-labelledby={`${c.clause_id}-name`}
                    aria-describedby={`${c.clause_id}-text`}
                    onClick={() => choose(c.clause_id)}
                    className={cn(
                      'group block w-full rounded-md border px-4 py-4 text-left transition-colors sm:px-5',
                      active
                        ? 'border-accent bg-accent-soft/50'
                        : 'border-transparent hover:border-rule hover:bg-rule-soft/50',
                    )}
                  >
                    <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span id={`${c.clause_id}-name`} className="font-serif text-lg font-semibold">
                        Section {c.source_span.section}
                      </span>
                      <span className="text-xs text-ink-faint">page {c.source_span.page}</span>
                    </span>
                    <span className="mt-0.5 block text-sm font-medium text-ink-soft">
                      {c.headline}
                    </span>
                    <span
                      id={`${c.clause_id}-text`}
                      className="mt-3 block font-serif text-[1.05rem] leading-relaxed text-pretty"
                    >
                      {active ? (
                        <mark className="rounded-sm bg-mark box-decoration-clone px-0.5 text-ink">
                          {c.source_text}
                        </mark>
                      ) : (
                        c.source_text
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      </section>

      <section
        ref={panelRef}
        aria-labelledby="extraction-title"
        aria-busy={loading}
        className="scroll-mt-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1"
      >
        <h2 id="extraction-title" className="font-serif text-xl font-semibold">
          Extracted requirements
        </h2>

        <div aria-live="polite" className="mt-3 space-y-4">
          {!selected && (
            <p className="rounded-lg border border-dashed border-rule px-4 py-8 text-center text-sm text-ink-soft">
              No clause selected yet. The structured requirement, its confidence and every
              ambiguity will appear here.
            </p>
          )}

          {loading && selected && (
            <p className="flex items-center gap-2 rounded-lg border border-rule bg-sheet px-4 py-6 text-sm text-ink-soft">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Extracting Section {selected.source_span.section}…
            </p>
          )}

          {extraction && selected && (
            <>
              <div className="rounded-lg border border-rule bg-sheet px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Section {selected.source_span.section}</span>
                  {extraction.clause.extraction_source === 'nemotron' ? (
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
                </div>
                <p className="mt-1.5 text-sm text-ink-soft">{sourceDetail(extraction)}</p>
              </div>

              {extraction.clause.requirements.map((r) => (
                <RequirementCard
                  key={r.requirement_id}
                  requirement={r}
                  amountDraft={amountDrafts[r.requirement_id]}
                  onAmountDraft={(v) => session.setAmountDraft(r.requirement_id, v)}
                />
              ))}

              <div className="sticky bottom-0 -mx-1 bg-gradient-to-t from-paper from-70% px-1 pt-4 pb-1">
                <Button onClick={run} disabled={invalidDraft} className="w-full text-base">
                  Run operability test
                  <ArrowRight aria-hidden className="size-4" />
                </Button>
                {invalidDraft && (
                  <p className="mt-2 text-center text-xs font-medium text-fail">
                    Fix the amount above before running the test.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
