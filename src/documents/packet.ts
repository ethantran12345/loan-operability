// The synthetic document packet: one agreement and four operating policies.
//
// The policies are the bank's standing state: the app holds the ones in force for
// each capability version. The agreement is what changes from run to run.
//
// The files are bundled as raw text and parsed at runtime by parse.ts. Nothing
// here is pre-parsed: the workspace's "Read documents" step is this module
// actually running. Browser-only (Vite `?raw`), so api/ must not import it.

import agreementRaw from '../packet/credit-agreement.draft-7.md?raw'
import noticeIntakeRaw from '../packet/ops-101-notice-intake.v2.3.md?raw'
import fundingRaw from '../packet/ops-204-funding-windows.v5.1.md?raw'
import bookingRaw from '../packet/ops-310-booking-entities.v4.0.md?raw'
import approvalsV3Raw from '../packet/pol-007-approvals.v3.md?raw'
import approvalsV4Raw from '../packet/pol-007-approvals.v4.md?raw'
import { agreement, type AgreementClause } from '../domain/fixtures'
import { findParagraph, parseDocument, type DocumentKind, type ParsedDocument } from './parse'

/** One file as it was handed over: its name and its exact text. Bundled or dropped, the reader cannot tell. */
export interface PacketFile {
  file: string
  raw: string
}

const AGREEMENT: PacketFile = { file: 'credit-agreement.draft-7.md', raw: agreementRaw }
const NOTICE_INTAKE: PacketFile = { file: 'ops-101-notice-intake.v2.3.md', raw: noticeIntakeRaw }
const FUNDING: PacketFile = { file: 'ops-204-funding-windows.v5.1.md', raw: fundingRaw }
const BOOKING: PacketFile = { file: 'ops-310-booking-entities.v4.0.md', raw: bookingRaw }
const APPROVALS_V3: PacketFile = { file: 'pol-007-approvals.v3.md', raw: approvalsV3Raw }
const APPROVALS_V4: PacketFile = { file: 'pol-007-approvals.v4.md', raw: approvalsV4Raw }

/**
 * Which policy files were in force for each capability-registry version. The
 * registry and the policies change together: v8 is v7 plus the renewed approvals
 * register, and nothing else.
 */
const POLICY_FILES: Record<number, PacketFile[]> = {
  7: [NOTICE_INTAKE, FUNDING, BOOKING, APPROVALS_V3],
  8: [NOTICE_INTAKE, FUNDING, BOOKING, APPROVALS_V4],
}

export const FORMAT_NOTE = 'Reads .md text files only. No PDF, DOCX or scans.'

export interface PacketDocument extends ParsedDocument {
  file: string
}

/** A clause the agreement is reviewed on, with its text taken from the parsed document. */
export interface ScopedClause extends AgreementClause {
  /** Offsets of the clause text in the agreement's raw file. */
  start: number
  end: number
}

export interface Packet {
  graph_version: number
  agreement: PacketDocument
  policies: PacketDocument[]
  documents: PacketDocument[]
  /** The clauses in review scope, read out of the agreement document. */
  clauses: ScopedClause[]
  /** Sections the parser read but no extraction or check covers. */
  out_of_scope_sections: number
  read_ms: number
}

const parseFile = (f: PacketFile): PacketDocument => ({ ...parseDocument(f.raw, f.file), file: f.file })

const versionLabel = (v: string) => (/^\d/.test(v) ? `v${v}` : v)

/** The sample packet: every file bundled with the app, both approvals registers included. */
export const samplePacketFiles = (): PacketFile[] => [AGREEMENT, NOTICE_INTAKE, FUNDING, BOOKING, APPROVALS_V3, APPROVALS_V4]

/** The sample agreement: the one file an analyst would otherwise hand over. */
export const sampleAgreementFile = (): PacketFile => AGREEMENT

/** Every bundled policy file, both approvals registers included. */
export const samplePolicyFiles = (): PacketFile[] => [NOTICE_INTAKE, FUNDING, BOOKING, APPROVALS_V3, APPROVALS_V4]

const standing = new Map<number, PacketDocument[]>()

/** The bank's standing policies for one capability version: held by the app, never asked for. */
export function standingPolicies(graphVersion: number): PacketDocument[] {
  const files = POLICY_FILES[graphVersion]
  if (!files) throw new Error(`No policy packet for bank capabilities v${graphVersion}`)
  let known = standing.get(graphVersion)
  if (!known) {
    known = files.map(parseFile)
    standing.set(graphVersion, known)
  }
  return known
}

/** A document a registry version needs, identified by what the document says it is, not by its filename. */
export interface RequiredDocument {
  /** The name this document has in the sample packet. A hint for the reader; never used to match. */
  file: string
  document_id: string
  version: string
  kind: DocumentKind
  title: string
}

const required = new Map<number, RequiredDocument[]>()

/** What a packet must hold for one registry version: the agreement in review scope, and the policies in force. */
export function requiredDocuments(graphVersion: number): RequiredDocument[] {
  const files = POLICY_FILES[graphVersion]
  if (!files) throw new Error(`No policy packet for bank capabilities v${graphVersion}`)
  let known = required.get(graphVersion)
  if (!known) {
    known = [AGREEMENT, ...files].map((f) => {
      const { meta } = parseDocument(f.raw, f.file)
      return { file: f.file, document_id: meta.document_id, version: meta.version, kind: meta.kind, title: meta.title }
    })
    required.set(graphVersion, known)
  }
  return known
}

/** Read the bundled sample packet for one registry version. */
export function readPacket(graphVersion: number): Packet {
  const files = POLICY_FILES[graphVersion]
  if (!files) throw new Error(`No policy packet for bank capabilities v${graphVersion}`)
  return readPacketFrom([AGREEMENT, ...files], graphVersion)
}

/**
 * Read a packet for one registry version out of the files given, whoever gave
 * them. The review scope (which clauses are extracted and checked) is configured
 * in fixtures/agreement.json by section reference; the clause TEXT and page come
 * from the parsed document, so an edit to the agreement file changes what is
 * extracted. Files the registry version does not need are left out of the packet.
 * Anything missing or ambiguous throws: a packet is never completed by guessing.
 */
export function readPacketFrom(given: PacketFile[], graphVersion: number): Packet {
  const started = performance.now()
  const needed = requiredDocuments(graphVersion)
  const parsed = given.map(parseFile)

  const agreements = parsed.filter((d) => d.meta.kind === 'agreement')
  if (agreements.length === 0) throw new Error('There is no agreement document in the packet')
  if (agreements.length > 1) throw new Error(`More than one agreement is in the packet: ${agreements.map((d) => d.file).join(', ')}`)
  const agreementDoc = agreements[0]!

  const policies = needed
    .filter((r) => r.kind === 'policy')
    .map((r) => {
      const hits = parsed.filter((d) => d.meta.kind === 'policy' && d.meta.document_id === r.document_id && d.meta.version === r.version)
      if (hits.length === 0) throw new Error(`Bank capabilities v${graphVersion} needs ${r.document_id} ${versionLabel(r.version)} (${r.file}) and it is not in the packet`)
      if (hits.length > 1) throw new Error(`${hits.map((d) => d.file).join(' and ')} both say they are ${r.document_id} ${versionLabel(r.version)}`)
      return hits[0]!
    })

  if (agreementDoc.meta.version !== agreement.agreement_version) {
    throw new Error(
      `Agreement document is ${agreementDoc.meta.version} but the review scope was configured for ${agreement.agreement_version}`,
    )
  }

  const clauses = agreement.clauses.map((c): ScopedClause => {
    const p = findParagraph(agreementDoc, c.source_span.section)
    if (!p) throw new Error(`Section ${c.source_span.section} is in review scope but not in the agreement document`)
    return {
      ...c,
      source_text: p.text,
      source_span: { document: agreementDoc.meta.document_id, section: p.ref, page: p.page },
      start: p.start,
      end: p.end,
    }
  })

  const scoped = new Set(clauses.map((c) => c.source_span.section))
  const allRefs = agreementDoc.sections.flatMap((s) => s.paragraphs.map((p) => p.ref))
  return {
    graph_version: graphVersion,
    agreement: agreementDoc,
    policies,
    documents: [agreementDoc, ...policies],
    clauses,
    out_of_scope_sections: allRefs.filter((r) => !scoped.has(r)).length,
    read_ms: performance.now() - started,
  }
}

/** True when this policy file is not the one in the other registry version's packet. */
export function changedBetweenVersions(doc: PacketDocument, otherVersion: number): boolean {
  if (doc.meta.kind !== 'policy') return false
  if (!POLICY_FILES[otherVersion]) return false
  return !requiredDocuments(otherVersion).some((r) => r.document_id === doc.meta.document_id && r.version === doc.meta.version)
}
