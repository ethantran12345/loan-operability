import { Check, FileText, Landmark, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { FORMAT_NOTE, changedBetweenVersions, type Packet, type PacketDocument } from '@/documents/packet'
import type { CitationIndex } from '@/documents/citations'
import type { DocumentKind } from '@/documents/parse'
import type { ReactNode } from 'react'

export const versionLabel = (version: string) => (/^\d/.test(version) ? `v${version}` : version)

/** One document in a tray: icon, title, identity, then whatever is known about it. Shared with the intake tray. */
export function DocumentRow({ kind, title, identity, muted = false, children }: { kind: DocumentKind; title: string; identity: string; muted?: boolean; children?: ReactNode }) {
  const Icon = kind === 'agreement' ? FileText : Landmark
  return (
    <span className="flex items-start gap-2">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-faint" />
      <span className="min-w-0">
        <span className={cn('block text-[0.8rem] leading-snug font-semibold', muted ? 'text-ink-soft' : 'text-ink')}>{title}</span>
        <span className="mt-0.5 block font-mono text-[0.68rem] text-ink-faint">{identity}</span>
        {children}
      </span>
    </span>
  )
}

function citedRecords(doc: PacketDocument, citations: CitationIndex | null) {
  if (!citations) return { total: 0, verified: 0 }
  const mine = Object.values(citations.records).filter((r) => r.document_id === doc.meta.document_id)
  return { total: mine.length, verified: mine.filter((r) => r.status === 'verified').length }
}

export function DocumentTray({
  packet,
  citations,
  otherVersion,
  extracting,
  selectedId,
  onSelect,
}: {
  packet: Packet
  citations: CitationIndex | null
  otherVersion: number | null
  /** Clauses still with the model. Shown on the agreement only, and only while true. */
  extracting: number
  selectedId: string
  onSelect: (documentId: string) => void
}) {
  const item = (doc: PacketDocument) => {
    const active = doc.meta.document_id === selectedId
    const cited = citedRecords(doc, citations)
    const changed = otherVersion !== null && changedBetweenVersions(doc, otherVersion)
    const isAgreement = doc.meta.kind === 'agreement'
    return (
      <li key={doc.file}>
        <button
          type="button"
          aria-pressed={active}
          onClick={() => onSelect(doc.meta.document_id)}
          className={cn(
            'block w-full rounded-md border px-2.5 py-2 text-left transition-colors',
            active ? 'border-accent/50 bg-accent-soft' : 'border-transparent hover:bg-rule-soft',
          )}
        >
          <DocumentRow kind={doc.meta.kind} title={doc.meta.title} identity={`${doc.meta.document_id} · ${versionLabel(doc.meta.version)}`}>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] text-ink-soft">
              <span className="inline-flex items-center gap-1">
                <Check aria-hidden className="size-3 text-pass" />
                Read · {doc.pages} {doc.pages === 1 ? 'page' : 'pages'} · {doc.paragraph_count} paragraphs
              </span>
              {isAgreement && extracting > 0 && (
                <span className="inline-flex items-center gap-1 text-accent">
                  <Loader2 aria-hidden className="size-3 animate-spin" />
                  extracting {extracting}
                </span>
              )}
              {!isAgreement && cited.total > 0 && (
                <span title="Capability records whose values were found verbatim in this document">
                  {cited.verified}/{cited.total} capability records verified
                </span>
              )}
              {changed && <span className="rounded bg-manual-soft px-1 font-semibold text-manual">differs in capabilities v{otherVersion}</span>}
            </span>
          </DocumentRow>
        </button>
      </li>
    )
  }

  return (
    <nav aria-label="Documents" className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <p className="px-2.5 pt-1 pb-1 text-[0.68rem] font-semibold tracking-wide text-ink-faint uppercase">Agreement</p>
        <ul>{item(packet.agreement)}</ul>
        <p className="mt-3 px-2.5 pb-1 text-[0.68rem] font-semibold tracking-wide text-ink-faint uppercase">
          Bank policies · capabilities v{packet.graph_version}
        </p>
        <ul className="space-y-0.5">{packet.policies.map(item)}</ul>
      </div>
      <p className="border-t border-rule px-3 py-2 text-[0.68rem] leading-snug text-ink-faint">
        Synthetic packet. {FORMAT_NOTE}
      </p>
    </nav>
  )
}
