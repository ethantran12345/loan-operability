import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, FileQuestion, FolderOpen, Landmark, Upload, X } from 'lucide-react'
import { DocumentRow, versionLabel } from '@/components/workspace/DocumentTray'
import { AgreementPane } from './AgreementPane'
import type { Intake, IntakeEntry, PolicyInForce } from '@/documents/intake'
import { FORMAT_NOTE } from '@/documents/packet'
import { cn } from '@/lib/cn'
import { filesFromDrop } from '@/lib/dropFiles'

const NONE: ReadonlySet<string> = new Set()
const kilobytes = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`)

/** The reader's key for a policy in force. Entries are keyed by file name, and no file name has a colon. */
const policyKey = (p: PolicyInForce) => `policy:${p.doc.meta.document_id}`

/**
 * Where a run starts: the analyst hands over the draft agreement, and it is read,
 * parsed and hashed as it lands. The bank's policies are already here, shown once
 * as one block that opens them in the reader. The tray only ever describes the
 * text of a file it was given, and the sample agreement is labelled as the sample
 * on its row.
 */
export function IntakePanel({
  intake,
  traced,
  readError,
  reading,
  onRead,
  onFiles,
  onSample,
  onRemove,
  onClear,
}: {
  intake: Intake
  /** Capability values found word for word in the policies in force, out of those that cite one. */
  traced: { verified: number; of: number }
  /** The run's own read of the packet refusing it, should that ever disagree with the intake check. */
  readError: string | null
  /** The document open in the reader: a handed-over file by name, or a policy in force. null: the drop zone. */
  reading: string | null
  onRead: (file: string | null) => void
  onFiles: (files: File[]) => void
  onSample: () => void
  onRemove: (file: string) => void
  onClear: () => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  // The whole window takes the drop. A file let go a little off the target would otherwise
  // make the browser navigate to it, and the product would be gone from the screen.
  useEffect(() => {
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const over = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e) || !e.dataTransfer) return
      e.preventDefault()
      setDragging(false)
      void filesFromDrop(e.dataTransfer).then(onFiles)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [onFiles])

  const sample = intake.source === 'sample'
  const needed = intake.entries.filter((e) => e.status === 'needed')
  const unused = intake.entries.filter((e) => e.status === 'unused')
  const rejected = intake.entries.filter((e) => e.status === 'rejected')
  const blockers = [...intake.blockers, ...(readError && intake.ready ? [readError] : [])]
  const policyOpen = intake.policies.find((p) => policyKey(p) === reading) ?? null
  // A drag takes the drop zone back, so the target is on screen while files are over the window.
  const open = dragging ? null : (intake.entries.find((e) => e.file === reading)?.doc ?? policyOpen?.doc ?? null)

  const remove = (e: IntakeEntry) => (
      <button type="button" aria-label={`Remove ${e.file}`} title={`Remove ${e.file}`} onClick={() => onRemove(e.file)} className="ml-auto shrink-0 rounded p-1 text-ink-faint hover:bg-rule-soft hover:text-ink">
        <X aria-hidden className="size-3.5" />
      </button>
  )

  const row = (e: IntakeEntry) => (
    <li
      key={e.file}
      data-intake={e.status}
      data-source={e.source}
      className={cn('flex items-start rounded-md border transition-colors', open && e.file === reading ? 'border-accent/50 bg-accent-soft' : 'border-transparent hover:bg-rule-soft')}
    >
      <button type="button" data-control="read" aria-pressed={open !== null && e.file === reading} title={`Open ${e.file}`} onClick={() => onRead(e.file)} className="min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-left">
      <DocumentRow kind={e.doc!.meta.kind} title={e.doc!.meta.title} identity={`${e.doc!.meta.document_id} · ${versionLabel(e.doc!.meta.version)}`} muted={e.status === 'unused'}>
        <span className="mt-0.5 block font-mono text-[0.68rem] break-all text-ink-soft">{e.file}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] text-ink-soft">
          {e.status === 'needed' ? (
            <span className="inline-flex items-center gap-1">
              <Check aria-hidden className="size-3 text-pass" />
              Read · {e.doc!.pages} {e.doc!.pages === 1 ? 'page' : 'pages'} · {e.doc!.paragraph_count} paragraphs
            </span>
          ) : (
            <span className="rounded bg-manual-soft px-1 font-semibold text-manual">{e.note}</span>
          )}
          <span className="tabular-nums">{kilobytes(e.size)}</span>
          <span className="font-mono" title={`SHA-256 of the text of this file: ${e.sha256}`}>
            {e.sha256!.slice(0, 12)}
          </span>
          {e.source === 'sample' && <span className="rounded bg-accent-soft px-1 font-semibold text-accent">Sample</span>}
        </span>
      </DocumentRow>
      </button>
      {remove(e)}
    </li>
  )

  const heading = 'px-2.5 pt-1 pb-1 text-[0.68rem] font-semibold tracking-wide text-ink-faint uppercase'
  return (
    <main id="main" className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_28.75rem]">
      {open ? (
        <section aria-label={open.meta.title} className="min-h-0 min-w-0">
          <AgreementPane
            doc={open}
            clauses={[]}
            found={NONE}
            swept={NONE}
            stamped={NONE}
            still
            retested={{}}
            selectedClauseId={null}
            spans={[]}
            onSelectClause={() => {}}
            onBack={() => onRead(null)}
            backLabel="Close document"
          />
        </section>
      ) : (
      <section aria-label="Add the draft agreement" className="flex min-h-0 min-w-0 flex-col p-6">
        <div
          data-testid="drop-zone"
          data-dragging={dragging || undefined}
          className={cn(
            'flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 text-center transition-colors',
            dragging ? 'border-accent bg-accent-soft' : 'border-rule bg-sheet',
          )}
        >
          <Upload aria-hidden className={cn('size-9', dragging ? 'text-accent' : 'text-ink-faint')} />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">{dragging ? 'Drop to add' : 'Drop the draft agreement here'}</h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-soft">The bank's policies are already loaded.</p>
          <div className="mt-5 flex items-center gap-3">
            <button type="button" data-control="choose-files" onClick={() => picker.current?.click()} className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-sheet px-3.5 py-1.5 text-sm font-semibold text-ink hover:bg-rule-soft">
              <FolderOpen aria-hidden className="size-4" />
              Choose file
            </button>
            <button type="button" data-control="sample" onClick={onSample} className="rounded-md border border-accent/40 bg-accent-soft px-3.5 py-1.5 text-sm font-semibold text-accent hover:border-accent">
              Load the sample agreement
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              data-testid="file-picker"
              className="sr-only"
              onChange={(e) => {
                onFiles(Array.from(e.target.files ?? []))
                // The same file can be chosen again after it has been removed.
                e.target.value = ''
              }}
            />
          </div>
          <p className="mt-5 max-w-md text-xs leading-relaxed text-ink-faint">{FORMAT_NOTE}</p>
        </div>
      </section>
      )}

      <aside aria-label="Files added" className="flex min-h-0 flex-col border-l border-rule bg-sheet">
        <div className="flex shrink-0 items-center gap-2 border-b border-rule-soft px-4 py-2">
          <p data-testid="intake-source" className="text-xs font-semibold text-ink">
            {intake.entries.length === 0
              ? 'No agreement yet'
              : intake.entries.every((e) => e.source === 'sample')
                ? `Sample ${intake.entries.length === 1 && sample ? 'agreement' : 'files'} · bundled with the app`
                : `${intake.entries.length} ${intake.entries.length === 1 ? 'file' : 'files'} added`}
          </p>
          {intake.entries.length > 0 && (
            <button type="button" onClick={onClear} className="ml-auto text-xs text-ink-soft underline underline-offset-2 hover:text-ink">
              Remove all
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {rejected.length > 0 && (
            <>
              <p className={cn(heading, 'text-fail')}>Can't be read</p>
              <ul className="mb-2 space-y-1">
                {rejected.map((e) => (
                  <li key={e.file} data-intake="rejected" className="flex items-start rounded-md border border-fail-rule bg-fail-soft px-2.5 py-1.5">
                    <span className="flex min-w-0 items-start gap-2">
                      <FileQuestion aria-hidden className="mt-0.5 size-4 shrink-0 text-fail" />
                      <span className="min-w-0">
                        <span className="block font-mono text-[0.72rem] font-semibold break-all text-fail">{e.file}</span>
                        <span className="mt-0.5 block text-[0.7rem] leading-snug text-ink-soft">
                          {e.note} <span className="tabular-nums">({kilobytes(e.size)})</span>
                        </span>
                      </span>
                    </span>
                    {remove(e)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {needed.some((e) => e.doc!.meta.kind === 'agreement') && (
            <>
              <p className={heading}>Agreement</p>
              <ul className="space-y-0.5">{needed.filter((e) => e.doc!.meta.kind === 'agreement').map(row)}</ul>
            </>
          )}
          {needed.some((e) => e.doc!.meta.kind === 'policy') && (
            <>
              <p className={cn(heading, 'mt-2')}>Policies you added</p>
              <ul className="space-y-0.5">{needed.filter((e) => e.doc!.meta.kind === 'policy').map(row)}</ul>
            </>
          )}
          {unused.length > 0 && (
            <>
              <p className={cn(heading, 'mt-2')}>Not needed for this check</p>
              <ul className="space-y-0.5">{unused.map(row)}</ul>
            </>
          )}
        </div>
        <section aria-label="Bank policies in force" data-testid="standing-policies" className="shrink-0 border-t border-rule-soft p-2">
          <button
            type="button"
            data-control="policies"
            aria-expanded={policyOpen !== null}
            title={policyOpen ? 'Close the policies' : 'Read the policies'}
            onClick={() => onRead(policyOpen ? null : policyKey(intake.policies[0]!))}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-rule-soft"
          >
            <Landmark aria-hidden className="size-4 shrink-0 text-ink-faint" />
            <span data-testid="registry-label" className="min-w-0">
              <span className="block text-xs font-semibold text-ink">Bank capabilities v{intake.graph_version}</span>
              <span className="block text-[0.7rem] text-ink-soft">
                {intake.policies.length} policies in force ·{' '}
                <span className={traced.verified < traced.of ? 'font-semibold text-manual' : undefined}>
                  {traced.verified}/{traced.of} citations traced
                </span>
              </span>
            </span>
            {policyOpen ? <ChevronDown aria-hidden className="ml-auto size-4 shrink-0 text-ink-faint" /> : <ChevronRight aria-hidden className="ml-auto size-4 shrink-0 text-ink-faint" />}
          </button>
          {policyOpen && (
            <ul className="mt-1 space-y-0.5">
              {intake.policies.map((p) => (
                <li key={policyKey(p)} data-policy={p.source}>
                  <button
                    type="button"
                    data-control="read-policy"
                    aria-pressed={p === policyOpen}
                    onClick={() => onRead(policyKey(p))}
                    className={cn('flex w-full items-baseline gap-2 rounded-md border px-2.5 py-1 text-left text-xs', p === policyOpen ? 'border-accent/50 bg-accent-soft' : 'border-transparent hover:bg-rule-soft')}
                  >
                    <span className="min-w-0 truncate text-ink">{p.doc.meta.title}</span>
                    <span className="ml-auto shrink-0 text-[0.68rem] text-ink-soft">
                      {p.doc.meta.document_id} · {versionLabel(p.doc.meta.version)}
                    </span>
                    {p.source !== 'standing' && (
                      <span className="shrink-0 rounded bg-accent-soft px-1 text-[0.68rem] font-semibold text-accent" title={`Read from ${p.doc.file}, in place of the bank's standing copy`}>
                        {p.source === 'sample' ? 'Sample' : 'Added'}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div role="status" data-testid="intake-state" data-ready={intake.ready && !readError} className="shrink-0 border-t border-rule px-4 py-2.5 text-xs leading-relaxed">
          {blockers.length === 0 ? (
            <p className="flex items-center gap-1.5 font-semibold text-pass">
              <Check aria-hidden className="size-3.5" />
              {sample ? 'Sample agreement ready. Press Run dry run.' : 'Agreement ready. Press Run dry run.'}
            </p>
          ) : intake.entries.length === 0 ? (
            <p className="text-ink-soft">Add the draft agreement to run.</p>
          ) : (
            <ul className="space-y-1">
              {blockers.map((b) => (
                <li key={b} className="flex items-start gap-1.5 text-ink-soft">
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-manual" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </main>
  )
}
