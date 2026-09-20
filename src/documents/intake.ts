// Document intake: what the analyst handed over, checked before anything is run.
//
// The bank's policies are standing state: the app already holds the ones in force
// for each capability version, so the only file a run needs from the analyst is
// the draft agreement. A policy file that is handed over anyway is read like any
// other file, and replaces the standing copy with the same identity.
//
// Everything here is decided from the text of the file that was handed over. A
// file is identified by what its own front matter says it is, never by its name,
// and a standing copy is never used in place of a file that was dropped.

import { sha256Hex } from '../domain/sha256'
import { PacketFormatError, parseDocument } from './parse'
import {
  readPacketFrom,
  requiredDocuments,
  sampleAgreementFile,
  samplePolicyFiles,
  standingPolicies,
  type PacketDocument,
  type PacketFile,
  type RequiredDocument,
} from './packet'

/** 'sample' is a file bundled with the app. It is never shown as something that was dropped. */
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

/** A policy this run will read: the bank's standing copy, or the handed-over file that replaced it. */
export interface PolicyInForce {
  doc: PacketDocument
  source: IntakeSource | 'standing'
}

export interface Intake {
  graph_version: number
  /** Where the agreement came from. Null until one is in. */
  source: IntakeSource | null
  /** The files that were handed over. Standing policies are not entries: nobody handed them over. */
  entries: IntakeEntry[]
  /** The policies in force for this capability version, in the order the version lists them. */
  policies: PolicyInForce[]
  /** Only ever the agreement. A policy is never asked for. */
  missing: RequiredDocument[]
  /** Exactly what the run reads: the files handed over, plus the standing policies nothing replaced. */
  packet_files: PacketFile[]
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
  if (!/\.md$/i.test(f.file)) return rejected('Not a .md text file.')
  try {
    const doc: PacketDocument = { ...parseDocument(f.raw, f.file), file: f.file }
    return { file: f.file, size: f.size, source: f.source, status: 'unused', sha256: sha256Hex(f.raw), doc, note: null }
  } catch (err) {
    if (!(err instanceof PacketFormatError)) throw err
    // parseDocument prefixes its message with the file name, which the tray already shows.
    const reason = err.message.startsWith(`${f.file}: `) ? err.message.slice(f.file.length + 2) : err.message
    return rejected(`Can't be read as a packet file: ${reason}`)
  }
}

/**
 * Check the files handed over against one capability version. Run is possible as
 * soon as an agreement is in, nothing was rejected, and the packet actually reads.
 */
export function checkIntake(files: IntakeFile[], graphVersion: number): Intake {
  const required = requiredDocuments(graphVersion)
  const entries = files.map(readEntry)

  for (const e of entries) {
    if (!e.doc) continue
    if (required.some((r) => matches(r, e.doc!))) e.status = 'needed'
    else e.note = `${e.doc.meta.document_id} ${versionLabel(e.doc.meta.version)} is not in force for capabilities v${graphVersion}`
  }

  const handedOver = (r: RequiredDocument) => entries.filter((e) => e.doc && matches(r, e.doc))
  const policies = standingPolicies(graphVersion).map((held): PolicyInForce => {
    const given = handedOver({ ...held.meta, file: held.file })[0]
    return given ? { doc: given.doc!, source: given.source } : { doc: held, source: 'standing' }
  })
  const packet_files: PacketFile[] = [...files, ...policies.filter((p) => p.source === 'standing').map((p) => ({ file: p.doc.file, raw: p.doc.raw }))]

  const missing = required.filter((r) => r.kind === 'agreement' && handedOver(r).length === 0)
  const blockers = entries.filter((e) => e.status === 'rejected').map((e) => `${e.file} can't be read. Remove or replace it.`)
  if (missing.length > 0) blockers.push('Still needed: the draft agreement.')
  if (blockers.length === 0) {
    // The same read the run will do. Its refusals (wrong agreement draft, a section in scope
    // that is not in the document, two files claiming one identity) are intake errors.
    try {
      readPacketFrom(packet_files, graphVersion)
    } catch (err) {
      blockers.push((err as Error).message)
    }
  }

  return {
    graph_version: graphVersion,
    source: entries.find((e) => e.status === 'needed' && e.doc!.meta.kind === 'agreement')?.source ?? null,
    entries,
    policies,
    missing,
    packet_files,
    blockers,
    ready: blockers.length === 0,
  }
}

const bytes = new TextEncoder()
const asSample = (f: PacketFile): IntakeFile => ({ ...f, size: bytes.encode(f.raw).length, source: 'sample' })

/** The bundled sample agreement, as an intake file. Always labelled as the sample. */
export const sampleAgreementIntake = (): IntakeFile => asSample(sampleAgreementFile())

/** Every bundled policy file, as intake files. Judge tooling: the standing policies are already loaded without this. */
export const samplePolicyIntake = (): IntakeFile[] => samplePolicyFiles().map(asSample)

const kindOf = (f: IntakeFile) => readEntry(f).doc?.meta.kind ?? null

/**
 * Hand over more files. A file handed over again replaces the one with its name,
 * and a new agreement replaces the agreement already in: the run reads one.
 */
export function addIntakeFiles(prev: IntakeFile[], incoming: IntakeFile[]): IntakeFile[] {
  const bringsAgreement = incoming.some((f) => kindOf(f) === 'agreement')
  return [...prev.filter((p) => !incoming.some((f) => f.file === p.file) && !(bringsAgreement && kindOf(p) === 'agreement')), ...incoming]
}

/** Put the handed-over policy files down, so every policy in force is the bank's standing copy again. */
export const withoutPolicies = (files: IntakeFile[]): IntakeFile[] => files.filter((f) => kindOf(f) !== 'policy')

// What this page load was handed, so coming back from a demo view does not ask for the files again.
let remembered: IntakeFile[] = []
export const rememberedIntake = (): IntakeFile[] => remembered
export const rememberIntake = (files: IntakeFile[]) => {
  remembered = files
}
