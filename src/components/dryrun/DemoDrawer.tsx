import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { GRAPH_VERSIONS, changelogEntry } from '@/components/results/GraphVersion'
import { Badge } from '@/components/ui/badge'
import { capabilityGraphs } from '@/domain/fixtures'
import { callLog, noCallReason, unusedReply, type CallLogEntry } from '@/lib/callLog'
import { cn } from '@/lib/cn'
import { canRetryLive } from '@/lib/extractClient'
import { seconds } from '@/lib/runFormat'
import type { ClauseReview } from '@/lib/useAgreementReview'

const ACTION = 'rounded-md border border-rule bg-sheet px-3 py-1.5 text-sm font-semibold text-ink hover:border-ink-faint'

/**
 * What a judge needs and an analyst does not, and nothing else: the bank
 * capabilities version, the chat packet, Try live again per clause, and the
 * Nemotron call log. Those are the only things this drawer can change.
 */
export function DemoDrawer({
  version,
  clauses,
  copied,
  onClose,
  onVersion,
  onCopyPacket,
  onDownloadPacket,
  onRetryLive,
}: {
  version: number
  clauses: ClauseReview[]
  copied: string | null
  onClose: () => void
  onVersion: (version: number) => void
  onCopyPacket: () => void
  onDownloadPacket: () => void
  onRetryLive: (clauseId: string) => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-ink/20" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-tools-title"
        className="absolute inset-y-0 right-0 flex w-[26rem] max-w-full flex-col border-l border-rule bg-paper shadow-xl"
      >
        <div className="flex items-center border-b border-rule bg-sheet px-5 py-3">
          <h2 id="demo-tools-title" className="text-sm font-semibold">Demo tools</h2>
          <button ref={closeRef} type="button" aria-label="Close demo tools" onClick={onClose} className="ml-auto rounded p-1 text-ink-soft hover:bg-rule-soft hover:text-ink">
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <Tool title="Bank capabilities version" caption={changelogEntry(capabilityGraphs[version]!).text}>
            <div role="radiogroup" aria-label="Bank capabilities version" className="inline-flex rounded-md border border-rule bg-rule-soft p-0.5">
              {GRAPH_VERSIONS.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={v === version}
                  onClick={() => onVersion(v)}
                  className={cn('rounded px-3 py-1 text-sm font-semibold', v === version ? 'bg-sheet text-ink shadow-sm' : 'text-ink-soft hover:text-ink')}
                >
                  {changelogEntry(capabilityGraphs[v]!).label}
                </button>
              ))}
            </div>
          </Tool>

          <Tool title="Chat packet" caption="The same five documents and bank capabilities, for pasting into a chat model.">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={onCopyPacket} className={ACTION}>Copy chat packet</button>
              <button type="button" onClick={onDownloadPacket} className={ACTION}>Download packet</button>
            </div>
            {copied && <p role="status" className="mt-1.5 text-xs text-ink-soft">{copied}</p>}
          </Tool>

          <Tool
            title="Try live again"
            caption="Asks Nemotron again for one clause. Offered on a cached clause where asking again could come back live. Whatever comes back is labelled by what actually served it."
          >
            <ul className="space-y-1.5">
              {clauses.map((c) => (
                <li key={c.clause.clause_id} data-extraction={c.clause.clause_id} className="flex items-center gap-2 text-xs">
                  <span className="font-semibold">§{c.clause.source_span.section}</span>
                  {c.extraction ? (
                    <Badge tone="neutral" className="px-1.5 py-0 text-[0.65rem]">{c.extraction.clause.extraction_source === 'nemotron' ? 'Live' : 'Cached'}</Badge>
                  ) : (
                    <span className="text-ink-faint">not extracted yet</span>
                  )}
                  {c.extraction && canRetryLive(c.extraction) && (
                    <button type="button" onClick={() => onRetryLive(c.clause.clause_id)} className="ml-auto text-ink-soft underline underline-offset-2 hover:text-ink">
                      Try live again
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Tool>

          <Tool
            title="Nemotron call log"
            caption="One entry per clause, in the order this session asked. Every value is the extraction result or what the server measured of its own call. The API key and the request headers never reach the browser, so they cannot appear here. A cached clause made no call, and none is shown."
          >
            <CallLog clauses={clauses} />
          </Tool>
        </div>
      </aside>
    </div>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The terms on screen, counted. On a cached entry they are the fixture's, and the entry says so. */
const termsLine = (e: CallLogEntry) =>
  `${plural(e.terms.requirements, 'requirement')} · confidence ${e.terms.confidence.map((c) => c.toFixed(2)).join(', ')} · ${plural(e.terms.ambiguities, 'ambiguity', 'ambiguities')} · extraction_source ${e.terms.extraction_source}`

function CallLog({ clauses }: { clauses: ClauseReview[] }) {
  const entries = callLog(clauses)
  const waiting = clauses.filter((c) => !c.extraction)
  return (
    <ol data-testid="call-log" className="space-y-3 font-mono text-[0.68rem] leading-relaxed">
      {entries.map((e) => (
        <li key={e.clause_id} data-call={e.clause_id} data-call-state={e.call} className="border-l-2 border-rule pl-2.5">
          <p className="flex items-center gap-2 font-sans text-xs">
            <span className="font-semibold">§{e.section}</span>
            <Badge tone="neutral" className="px-1.5 py-0 text-[0.65rem]">{e.call === 'answered' ? 'Live' : 'Cached'}</Badge>
            {e.asked && (
              <span className="ml-auto font-mono text-[0.68rem] text-ink-faint">
                {/* With no call there is no call time: the stamp is when the cached terms were served. */}
                {e.call === 'none' ? 'served ' : 'asked '}
                <time dateTime={e.asked.at}>{e.asked.at}</time>
              </span>
            )}
          </p>
          <dl className="mt-1 grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2 text-ink-soft [&_dt]:text-ink-faint">
            {e.call === 'none' ? (
              <>
                <dt>call</dt>
                <dd>none made: {noCallReason(e.fallback_reason)}</dd>
              </>
            ) : (
              <>
                <dt>model</dt>
                <dd className="[overflow-wrap:anywhere]">{e.model ?? 'not reported: the server names the model only on a reply it used'}</dd>
                <dt>sent</dt>
                <dd className="[overflow-wrap:anywhere]">{e.sent!.clause_id} · §{e.sent!.section} · {e.sent!.chars.toLocaleString('en-US')} characters of clause text</dd>
                <dt>back</dt>
                <dd>{e.call === 'answered' ? termsLine(e) : `${unusedReply(e.fallback_reason)} · not used`}</dd>
                {e.measured && (
                  <>
                    <dt>call</dt>
                    <dd>
                      upstream_ms {e.measured.upstream_ms.toLocaleString('en-US')} ({seconds(e.measured.upstream_ms)}) · {plural(e.measured.attempts, 'attempt')} · {plural(e.measured.calls, 'HTTP call')}
                    </dd>
                  </>
                )}
                {e.measured?.rejection && (
                  <>
                    <dt>rejected</dt>
                    <dd className="text-manual">first reading: {e.measured.rejection}</dd>
                  </>
                )}
              </>
            )}
            {e.call !== 'answered' && (
              <>
                <dt>shown</dt>
                <dd>
                  cached{e.recorded_from ? `, recorded from ${e.recorded_from}` : ''}: {termsLine(e)}
                </dd>
              </>
            )}
          </dl>
        </li>
      ))}
      {waiting.map((c) => (
        <li key={c.clause.clause_id} data-call={c.clause.clause_id} data-call-state="waiting" className="border-l-2 border-rule-soft pl-2.5 font-sans text-xs text-ink-faint">
          <span className="font-semibold text-ink-soft">§{c.clause.source_span.section}</span> no answer yet, so nothing to log
        </li>
      ))}
    </ol>
  )
}

function Tool({ title, caption, children }: { title: string; caption: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">{title}</h3>
      <div className="mt-2">{children}</div>
      <p className="mt-1.5 text-xs leading-snug text-ink-soft">{caption}</p>
    </section>
  )
}
