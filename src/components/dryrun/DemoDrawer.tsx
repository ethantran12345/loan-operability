import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { GRAPH_VERSIONS, changelogEntry } from '@/components/results/GraphVersion'
import { Badge } from '@/components/ui/badge'
import { capabilityGraphs } from '@/domain/fixtures'
import { cn } from '@/lib/cn'
import { canRetryLive, sourceDetail } from '@/lib/extractClient'
import type { PolicyInForce } from '@/documents/intake'
import type { ClauseReview } from '@/lib/useAgreementReview'

const ACTION = 'rounded-md border border-rule bg-sheet px-3 py-1.5 text-sm font-semibold text-ink hover:border-ink-faint'

/**
 * Everything a judge needs and an analyst does not: the registry version, the
 * policy packet, the chat packet, Challenge mode, the staged run, extraction diagnostics, and the
 * older views.
 */
export function DemoDrawer({
  version,
  clauses,
  diagnostics,
  policies,
  onPolicyFiles,
  onSamplePolicies,
  onStandingPolicies,
  copied,
  busy,
  onClose,
  onVersion,
  onCopyPacket,
  onDownloadPacket,
  onChallenge,
  onWatchRun,
  onTechnical,
  onWorkspace,
  onRetryLive,
}: {
  version: number
  clauses: ClauseReview[]
  /** Timings and counts from the last run. They live here, not in the product view. */
  diagnostics: string | null
  /** The policies in force, so the drawer can say how many are the bank's standing copy. */
  policies: PolicyInForce[]
  onPolicyFiles: (files: File[]) => void
  onSamplePolicies: () => void
  onStandingPolicies: () => void
  copied: string | null
  /** Set while a link is waiting on something, e.g. an extraction Results needs. */
  busy: string | null
  onClose: () => void
  onVersion: (version: number) => void
  onCopyPacket: () => void
  onDownloadPacket: () => void
  onChallenge: () => void
  onWatchRun: () => void
  onTechnical: () => void
  onWorkspace: () => void
  onRetryLive: (clauseId: string) => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const policyPicker = useRef<HTMLInputElement>(null)
  const replaced = policies.filter((p) => p.source !== 'standing').length
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
          {busy && <p role="status" className="text-sm text-ink-soft">{busy}</p>}
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

          <Tool
            title="Policy packet"
            caption="The bank's policies are standing state: the ones in force for the capabilities version are loaded when the app opens, and a run never asks for them. A policy file chosen here is parsed, hashed and labelled like any handed-over file, and replaces the standing copy with the same document id and version. The sample policy files are the five synthetic files in demo-packet/, labelled as the sample."
          >
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" data-control="choose-policies" onClick={() => policyPicker.current?.click()} className={ACTION}>Choose policy files</button>
              <button type="button" data-control="sample-policies" onClick={onSamplePolicies} className={ACTION}>Load the sample policy files</button>
              <input
                ref={policyPicker}
                type="file"
                multiple
                data-testid="policy-picker"
                className="sr-only"
                onChange={(e) => {
                  onPolicyFiles(Array.from(e.target.files ?? []))
                  e.target.value = ''
                }}
              />
            </div>
            <p role="status" data-testid="policy-state" className="mt-1.5 text-xs text-ink-soft">
              {replaced === 0 ? `All ${policies.length} policies in force are the standing copies.` : `${replaced} of ${policies.length} policies in force ${replaced === 1 ? 'was' : 'were'} handed over.`}{' '}
              {replaced > 0 && (
                <button type="button" data-control="standing-policies" onClick={onStandingPolicies} className="underline underline-offset-2 hover:text-ink">
                  Back to the standing policies
                </button>
              )}
            </p>
          </Tool>

          <Tool title="Chat packet" caption="The same five documents and bank capabilities, for pasting into a chat model.">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={onCopyPacket} className={ACTION}>Copy chat packet</button>
              <button type="button" onClick={onDownloadPacket} className={ACTION}>Download packet</button>
            </div>
            {copied && <p role="status" className="mt-1.5 text-xs text-ink-soft">{copied}</p>}
          </Tool>

          <Tool title="Check the model's work" caption="Challenge mode: the same clause goes to the model with no engine, and the engine referees the answer.">
            <button type="button" onClick={onChallenge} className={ACTION}>Open Challenge mode</button>
          </Tool>

          <Tool title="Watch the run" caption="The staged process view for the current clause.">
            <button type="button" onClick={onWatchRun} className={ACTION}>Watch the run</button>
          </Tool>

          <Tool title="Per-clause extraction" caption="Where each clause's terms came from in this session.">
            <ul className="space-y-2.5">
              {clauses.map((c) => {
                const live = c.extraction?.clause.extraction_source === 'nemotron'
                return (
                  <li key={c.clause.clause_id} data-extraction={c.clause.clause_id} className="text-xs">
                    <p className="flex items-center gap-2">
                      <span className="font-semibold">§{c.clause.source_span.section}</span>
                      {c.extraction ? (
                        <Badge tone="neutral" className="px-1.5 py-0 text-[0.65rem]">{live ? 'Live' : 'Cached'}</Badge>
                      ) : (
                        <span className="text-ink-faint">not extracted yet</span>
                      )}
                      {c.extraction && canRetryLive(c.extraction) && (
                        <button type="button" onClick={() => onRetryLive(c.clause.clause_id)} className="ml-auto text-ink-soft underline underline-offset-2 hover:text-ink">
                          Try live again
                        </button>
                      )}
                    </p>
                    {c.extraction && <p className="mt-0.5 leading-snug text-ink-soft">{sourceDetail(c.extraction)}</p>}
                  </li>
                )
              })}
            </ul>
            {diagnostics && <p className="mt-3 font-mono text-[0.7rem] leading-relaxed text-ink-faint">{diagnostics}</p>}
          </Tool>

          <Tool title="Technical results" caption="The engine's full report for the current clause.">
            <button type="button" onClick={onTechnical} className={ACTION}>Technical results</button>
          </Tool>

          <Tool title="Old workspace" caption="The earlier three-pane document workspace.">
            <button type="button" onClick={onWorkspace} className={ACTION}>Old workspace</button>
          </Tool>
        </div>
      </aside>
    </div>
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
