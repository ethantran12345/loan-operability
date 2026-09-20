// The synthetic document packet: one agreement and four operating policies.
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
import { findParagraph, parseDocument, type ParsedDocument } from './parse'

interface PacketFile {
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

export const SUPPORTED_FORMAT = 'Packet text format v1 (UTF-8 .md)'
export const UNSUPPORTED_FORMATS =
  'PDF, DOCX and scanned or image documents are not supported. There is no OCR.'

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

/**
 * Read the packet for one registry version. The review scope (which clauses are
 * extracted and checked) is configured in fixtures/agreement.json by section
 * reference; the clause TEXT and page come from the parsed document, so an edit
 * to the agreement file changes what is extracted.
 */
export function readPacket(graphVersion: number): Packet {
  const started = performance.now()
  const files = POLICY_FILES[graphVersion]
  if (!files) throw new Error(`No policy packet for capability registry v${graphVersion}`)
  const agreementDoc = parseFile(AGREEMENT)
  const policies = files.map(parseFile)

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
  const other = POLICY_FILES[otherVersion]
  return other !== undefined && !other.some((f) => f.file === doc.file)
}
