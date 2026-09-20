import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, FileQuestion, FolderOpen, Upload, X } from 'lucide-react'
import { DocumentRow, versionLabel } from '@/components/workspace/DocumentTray'
import { AgreementPane } from './AgreementPane'
import type { Intake, IntakeEntry } from '@/documents/intake'
import { SUPPORTED_FORMAT, UNSUPPORTED_FORMATS, type RequiredDocument } from '@/documents/packet'
import { cn } from '@/lib/cn'
import { filesFromDrop } from '@/lib/dropFiles'

const NONE: ReadonlySet<string> = new Set()
const kilobytes = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`)

/**
 * Where a run starts: the analyst hands over the deal files, and each one is
 * read, parsed and hashed as it lands. The tray only ever describes the text of
 * the file it was given. The sample packet is a separate control and is labelled
 * as the sample on every row. Any file that parsed opens in the reader, so the
 * packet can be read before it is run.
 */
export function IntakePanel({
  intake,
  readError,
  reading,
  onRead,
  onFiles,
  onSample,
  onRemove,
  onClear,
}: {
  intake: Intake
  /** The run's own read of the packet refusing it, should that ever disagree with the intake check. */
  readError: string | null
  /** The file open in the reader, by name. null: the drop zone. */
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
  const present = (r: RequiredDocument) =>
    intake.entries.filter((e) => e.status === 'needed' && e.doc && (r.kind === 'agreement' ? e.doc.meta.kind === 'agreement' : e.doc.meta.document_id === r.document_id && e.doc.meta.version === r.version))
  const unused = intake.entries.filter((e) => e.status === 'unused')
  const rejected = intake.entries.filter((e) => e.status === 'rejected')
  const blockers = [...intake.blockers, ...(readError && intake.ready ? [readError] : [])]
  // A drag takes the drop zone back, so the target is on screen while files are over the window.
  const open = dragging ? null : (intake.entries.find((e) => e.file === reading)?.doc ?? null)

  const remove = (e: IntakeEntry) =>
    !sample && (
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
      <button type="button" data-control="read" aria-pressed={open !== null && e.file === reading} title={`Read ${e.file}`} onClick={() => onRead(e.file)} className="min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-left">
      <DocumentRow kind={e.doc!.meta.kind} title={e.doc!.meta.title} identity={`${e.doc!.meta.document_id} · ${versionLabel(e.doc!.meta.version)}`} muted={e.status === 'unused'}>
        <span className="mt-0.5 block font-mono text-[0.68rem] break-all text-ink-soft">{e.file}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] text-ink-soft">
          {e.status === 'needed' ? (
            <span className="inline-flex items-center gap-1">
              <Check aria-hidden className="size-3 text-pass" />
              Parsed · {e.doc!.pages} {e.doc!.pages === 1 ? 'page' : 'pages'} · {e.doc!.paragraph_count} paragraphs
            </span>
          ) : (
            <span className="rounded bg-manual-soft px-1 font-semibold text-manual">{e.note}</span>
          )}
          <span className="tabular-nums">{kilobytes(e.size)}</span>
          <span className="font-mono" title={`SHA-256 of the text of this file: ${e.sha256}`}>
            sha256 {e.sha256!.slice(0, 12)}
          </span>
          {e.source === 'sample' && <span className="rounded bg-accent-soft px-1 font-semibold text-accent">Sample · bundled</span>}
        </span>
      </DocumentRow>
      </button>
      {remove(e)}
    </li>
  )

  const needed = (r: RequiredDocument) => {
    const hits = present(r)
    if (hits.length > 0) return hits.map(row)
    return (
      <li key={r.file} data-intake="missing" className="rounded-md border border-dashed border-rule px-2.5 py-1.5">
        <DocumentRow kind={r.kind} title={r.title} identity={`${r.document_id} · ${versionLabel(r.version)}`} muted>
          <span className="mt-0.5 block text-[0.7rem] text-ink-soft">
            <span className="font-semibold text-manual">Still needed</span> · in the sample packet this is <span className="font-mono text-[0.68rem]">{r.file}</span>
          </span>
        </DocumentRow>
      </li>
    )
  }

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
      <section aria-label="Hand over the deal packet" className="flex min-h-0 min-w-0 flex-col p-6">
        <div
          data-testid="drop-zone"
          data-dragging={dragging || undefined}
          className={cn(
            'flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 text-center transition-colors',
            dragging ? 'border-accent bg-accent-soft' : 'border-rule bg-sheet',
          )}
        >
          <Upload aria-hidden className={cn('size-9', dragging ? 'text-accent' : 'text-ink-faint')} />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">{dragging ? 'Let go to read these files' : 'Drop the deal packet here'}</h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
            The draft credit agreement and the bank policies in force under registry v{intake.graph_version}. Files or a whole folder. Each file is read,
            parsed and hashed as it lands, and the run uses the text of exactly those files.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <button type="button" data-control="choose-files" onClick={() => picker.current?.click()} className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-sheet px-3.5 py-1.5 text-sm font-semibold text-ink hover:bg-rule-soft">
              <FolderOpen aria-hidden className="size-4" />
              Choose files
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
          <p className="mt-5 max-w-md text-xs leading-relaxed text-ink-faint">
            Format read: {SUPPORTED_FORMAT}. {UNSUPPORTED_FORMATS}
          </p>
        </div>
        <div className="mt-4 flex shrink-0 items-center gap-3 rounded-lg border border-rule bg-sheet px-4 py-2.5">
          <p className="min-w-0 text-xs leading-relaxed text-ink-soft">
            <span className="font-semibold text-ink">No deal files to hand?</span> The sample packet is the six synthetic files bundled with this app, also in{' '}
            <span className="font-mono text-[0.68rem]">demo-packet/</span>. It is labelled as the sample wherever it is used.
          </p>
          <button type="button" data-control="sample" onClick={onSample} className="ml-auto shrink-0 rounded-md border border-accent/40 bg-accent-soft px-3.5 py-1.5 text-sm font-semibold text-accent hover:border-accent">
            Load the sample packet
          </button>
        </div>
      </section>
      )}

      <aside aria-label="Files handed over" className="flex min-h-0 flex-col border-l border-rule bg-sheet">
        <div className="flex shrink-0 items-center gap-2 border-b border-rule-soft px-4 py-2">
          <p data-testid="intake-source" className="text-xs font-semibold text-ink">
            {intake.entries.length === 0 ? 'Nothing handed over yet' : sample ? 'Sample packet · bundled with this app, not dropped' : `${intake.entries.length} ${intake.entries.length === 1 ? 'file' : 'files'} handed over`}
          </p>
          {intake.entries.length > 0 && (
            <button type="button" onClick={onClear} className="ml-auto text-xs text-ink-soft underline underline-offset-2 hover:text-ink">
              Clear
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {rejected.length > 0 && (
            <>
              <p className={cn(heading, 'text-fail')}>Rejected · not read</p>
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
          <p className={heading}>Agreement</p>
          <ul className="space-y-0.5">{intake.required.filter((r) => r.kind === 'agreement').map(needed)}</ul>
          <p className={cn(heading, 'mt-2')}>Bank policies · registry v{intake.graph_version}</p>
          <ul className="space-y-0.5">{intake.required.filter((r) => r.kind === 'policy').map(needed)}</ul>
          {unused.length > 0 && (
            <>
              <p className={cn(heading, 'mt-2')}>Read, not part of this run</p>
              <ul className="space-y-0.5">{unused.map(row)}</ul>
            </>
          )}
        </div>
        <div role="status" data-testid="intake-state" data-ready={intake.ready && !readError} className="shrink-0 border-t border-rule px-4 py-2.5 text-xs leading-relaxed">
          {blockers.length === 0 ? (
            <p className="flex items-center gap-1.5 font-semibold text-pass">
              <Check aria-hidden className="size-3.5" />
              {sample ? 'The sample packet is read. Run dry run is enabled.' : 'Every file registry v' + intake.graph_version + ' needs is read. Run dry run is enabled.'}
            </p>
          ) : intake.entries.length === 0 ? (
            <p className="text-ink-soft">Run dry run stays disabled until the agreement and every policy above are handed over.</p>
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
