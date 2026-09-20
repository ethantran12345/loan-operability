// Document intake: what the analyst handed over, checked against what the
// registry version needs, before anything is run.
//
// Everything here is decided from the text of the file that was handed over. A
// file is identified by what its own front matter says it is, never by its name,
// and a bundled copy is never used in place of a file that was dropped.

import { sha256Hex } from '../domain/sha256'
import { PacketFormatError, parseDocument } from './parse'
import { SUPPORTED_FORMAT, readPacketFrom, requiredDocuments, samplePacketFiles, type PacketDocument, type PacketFile, type RequiredDocument } from './packet'

/** 'sample' is the packet bundled with the app. It is never shown as something that was dropped. */
export type IntakeSource = 'dropped' | 'sample'

export interface IntakeFile extends PacketFile {
  /** Size in bytes, as the file system reported it. */
  size: number
  source: IntakeSource
  /** Set when the browser could not read the file as text at all. */
  unreadable?: string
}

export type IntakeStatus = 'needed' | 'unused' | 'rejected'

export interface IntakeEntry {
  file: string
  size: number
  source: IntakeSource
  status: IntakeStatus
  /** SHA-256 of the text that was read. Null for a rejected file: nothing of it is used, so nothing is vouched for. */
  sha256: string | null
  doc: PacketDocument | null
  /** Why it was rejected, or why it is not part of this run. */
  note: string | null
}

export interface Intake {
  graph_version: number
  source: IntakeSource | null
  entries: IntakeEntry[]
  required: RequiredDocument[]
  missing: RequiredDocument[]
  /** Every reason Run is disabled, in words. Empty when and only when `ready`. */
  blockers: string[]
  ready: boolean
}

const versionLabel = (v: string) => (/^\d/.test(v) ? `v${v}` : v)
const matches = (r: RequiredDocument, d: PacketDocument) =>
  r.kind === 'agreement' ? d.meta.kind === 'agreement' : d.meta.kind === 'policy' && d.meta.document_id === r.document_id && d.meta.version === r.version

function readEntry(f: IntakeFile): IntakeEntry {
  const rejected = (note: string): IntakeEntry => ({ file: f.file, size: f.size, source: f.source, status: 'rejected', sha256: null, doc: null, note })
  if (f.unreadable) return rejected(f.unreadable)
  if (!/\.md$/i.test(f.file)) return rejected(`Not a .md file. The only format read is ${SUPPORTED_FORMAT}.`)
  try {
    const doc: PacketDocument = { ...parseDocument(f.raw, f.file), file: f.file }
    return { file: f.file, size: f.size, source: f.source, status: 'unused', sha256: sha256Hex(f.raw), doc, note: null }
  } catch (err) {
    if (!(err instanceof PacketFormatError)) throw err
    // parseDocument prefixes its message with the file name, which the tray already shows.
    const reason = err.message.startsWith(`${f.file}: `) ? err.message.slice(f.file.length + 2) : err.message
    return rejected(`Not packet text format v1: ${reason}`)
  }
}

/**
 * Check the files handed over against one registry version. Run is possible only
 * when nothing was rejected, nothing is missing, and the packet actually reads.
 */
export function checkIntake(files: IntakeFile[], graphVersion: number): Intake {
  const required = requiredDocuments(graphVersion)
  const entries = files.map(readEntry)

  for (const e of entries) {
    if (!e.doc) continue
    if (required.some((r) => matches(r, e.doc!))) e.status = 'needed'
    else e.note = `${e.doc.meta.document_id} ${versionLabel(e.doc.meta.version)} is not used by registry v${graphVersion}`
  }

  const missing = required.filter((r) => !entries.some((e) => e.doc && matches(r, e.doc)))
  const blockers = entries.filter((e) => e.status === 'rejected').map((e) => `${e.file} was rejected. Remove it, or replace it with a file that can be read.`)
  if (missing.length > 0) {
    blockers.push(`Still needed for registry v${graphVersion}: ${missing.map((r) => r.file).join(', ')}`)
  }
  if (blockers.length === 0) {
    // The same read the run will do. Its refusals (wrong agreement draft, a section in scope
    // that is not in the document, two files claiming one identity) are intake errors.
    try {
      readPacketFrom(files, graphVersion)
    } catch (err) {
      blockers.push((err as Error).message)
    }
  }

  return {
    graph_version: graphVersion,
    source: files[0]?.source ?? null,
    entries,
    required,
    missing,
    blockers,
    ready: blockers.length === 0,
  }
}

/** The bundled sample packet, as intake files. Always labelled as the sample. */
export function sampleIntakeFiles(): IntakeFile[] {
  const bytes = new TextEncoder()
  return samplePacketFiles().map((f) => ({ ...f, size: bytes.encode(f.raw).length, source: 'sample' }))
}

// What this page load was handed, so coming back from a demo view does not ask for the files again.
let remembered: IntakeFile[] = []
export const rememberedIntake = (): IntakeFile[] => remembered
export const rememberIntake = (files: IntakeFile[]) => {
  remembered = files
}
