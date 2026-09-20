// How policy evidence connects to the capability registry.
//
// The registry (capability-graph.vN.json) is hand-authored structured data. It
// is NOT derived from the policy documents, and nothing here pretends it is.
// What this module does is verify the link in one direction:
//
//   1. Resolve. A capability cites a policy section by title
//      (`evidence.section`); an approval is cited by a section whose title
//      carries its id, e.g. "Treasury exception authority (apr-021)".
//   2. Verify. Every checked registry value is rendered the way a procedure
//      writes it (25000000 -> "EUR 25,000,000", "09:30" -> "9:30 A.M.",
//      "Europe/London" -> "London time", "2026-08-31" -> "31 August 2026") and
//      must appear verbatim in the cited section.
//   3. Cite. The exact character spans that matched are kept, so a finding can
//      open the passage and highlight the words that support the bank's value.
//
// Limits, stated plainly: a value that is in the policy but missing from the
// registry is not detected; effective dates of capabilities and the `outcome`
// field are not text-verified; records whose section is not in the packet
// (interest and fee engines) are reported as "not in packet", never as verified.

import type { Approval, Capability, CapabilityGraph, CheckResult } from '../domain/types'
import type { DocParagraph, DocSection } from './parse'
import type { PacketDocument } from './packet'

export type CitedField =
  | 'currency'
  | 'max_amount'
  | 'amount_increment'
  | 'cutoff'
  | 'timezone'
  | 'settlement'
  | 'notice_lead'
  | 'booking_entity'
  | 'notice_channel'
  | 'required_fields'
  | 'manual_path'
  | 'requires_approval'
  | 'threshold'
  | 'effective_from'
  | 'effective_to'
  | 'lending_offices'

/** Exact text at exact offsets in a document's raw file. */
export interface Span {
  start: number
  end: number
  text: string
}

export interface FieldCitation {
  field: CitedField
  /** The registry's value, as stored. */
  registry_value: string
  /** What the verifier looked for in the policy text. */
  needles: string[]
  spans: Span[]
  verified: boolean
}

export interface RecordCitation {
  record_id: string
  record_kind: 'capability' | 'approval' | 'lending_offices'
  status: 'verified' | 'mismatch' | 'not_in_packet'
  document_id: string | null
  document_version: string | null
  section: DocSection | null
  fields: FieldCitation[]
}

export interface CitationIndex {
  graph_version: number
  records: Record<string, RecordCitation>
  verified: number
  mismatched: number
  not_in_packet: number
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-08-31" -> "31 August 2026". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m! - 1]} ${y}`
}

/** "09:30" -> "9:30 A.M.", "16:00" -> "4:00 P.M.". */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const hour = h! % 12 === 0 ? 12 : h! % 12
  return `${hour}:${String(m).padStart(2, '0')} ${h! < 12 ? 'A.M.' : 'P.M.'}`
}

const OFFICE_NAMES: Record<string, string> = { london: 'London', new_york: 'New York', toronto: 'Toronto' }
const officeName = (entity: string) => OFFICE_NAMES[entity] ?? entity
const zoneCity = (zone: string) => zone.split('/')[1]!.replace(/_/g, ' ')
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five']
const businessDays = (n: number) => `${NUMBER_WORDS[n] ?? n} (${n}) Business Day`
const grouped = (n: number) => n.toLocaleString('en-US')

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** First occurrence of a needle in a section. Numbers must not be part of a longer number. */
function findNeedle(section: DocSection, needle: string): Span | null {
  const numeric = /\d$/.test(needle)
  const re = new RegExp(`${/^\d/.test(needle) ? '(?<![\\d,.])' : ''}${escapeRe(needle)}${numeric ? '(?!,?\\d)' : ''}`, 'i')
  for (const p of section.paragraphs) {
    const m = re.exec(p.text)
    if (m) return { start: p.start + m.index, end: p.start + m.index + m[0].length, text: m[0] }
  }
  return null
}

function cite(section: DocSection, field: CitedField, registry_value: string, needles: string[]): FieldCitation {
  const spans = needles.map((n) => findNeedle(section, n))
  return {
    field,
    registry_value,
    needles,
    spans: spans.filter((s): s is Span => s !== null),
    verified: spans.every((s) => s !== null),
  }
}

function capabilityFields(cap: Capability, section: DocSection): FieldCitation[] {
  const c = cap.constraints
  const out: FieldCitation[] = []
  const unit = c.currency?.length === 1 ? `${c.currency[0]} ` : ''
  if (c.currency) out.push(cite(section, 'currency', c.currency.join(', '), c.currency))
  if (c.max_amount !== undefined) out.push(cite(section, 'max_amount', String(c.max_amount), [`${unit}${grouped(c.max_amount)}`]))
  if (c.amount_increment !== undefined) out.push(cite(section, 'amount_increment', String(c.amount_increment), [`${unit}${grouped(c.amount_increment)}`]))
  if (c.cutoff) out.push(cite(section, 'cutoff', c.cutoff, [clock12(c.cutoff)]))
  if (c.timezone) out.push(cite(section, 'timezone', c.timezone, [`${zoneCity(c.timezone)} time`]))
  if (c.settlement) out.push(cite(section, 'settlement', c.settlement, [c.settlement === 'same_day' ? 'same-day' : 'T+1']))
  if (c.notice_lead_business_days) out.push(cite(section, 'notice_lead', String(c.notice_lead_business_days), [businessDays(c.notice_lead_business_days)]))
  if (c.booking_entity) out.push(cite(section, 'booking_entity', c.booking_entity.join(', '), c.booking_entity.map(officeName)))
  if (c.notice_channel) out.push(cite(section, 'notice_channel', c.notice_channel.join(', '), c.notice_channel))
  if (c.required_fields) out.push(cite(section, 'required_fields', c.required_fields.join(', '), c.required_fields))
  if (cap.manual_path && cap.outcome === 'manual') {
    out.push(cite(section, 'manual_path', `${cap.manual_path.owner}, ${cap.manual_path.sla_business_days} business day(s)`, [cap.manual_path.owner, businessDays(cap.manual_path.sla_business_days)]))
  }
  if (cap.requires_approval) out.push(cite(section, 'requires_approval', cap.requires_approval.join(', '), cap.requires_approval))
  return out
}

function approvalFields(a: Approval, section: DocSection): FieldCitation[] {
  return [
    cite(section, 'threshold', String(a.threshold), [grouped(a.threshold)]),
    cite(section, 'effective_from', a.effective_from, [longDate(a.effective_from)]),
    cite(section, 'effective_to', a.effective_to ?? 'null', [a.effective_to ? longDate(a.effective_to) : 'No expiry date']),
  ]
}

function locate(policies: PacketDocument[], match: (s: DocSection) => boolean) {
  for (const doc of policies) {
    const section = doc.sections.find(match)
    if (section) return { doc, section }
  }
  return null
}

function record(
  record_id: string,
  record_kind: RecordCitation['record_kind'],
  hit: { doc: PacketDocument; section: DocSection } | null,
  fields: (section: DocSection) => FieldCitation[],
): RecordCitation {
  if (!hit) return { record_id, record_kind, status: 'not_in_packet', document_id: null, document_version: null, section: null, fields: [] }
  const cited = fields(hit.section)
  return {
    record_id,
    record_kind,
    status: cited.every((f) => f.verified) ? 'verified' : 'mismatch',
    document_id: hit.doc.meta.document_id,
    document_version: hit.doc.meta.version,
    section: hit.section,
    fields: cited,
  }
}

export const LENDING_OFFICES_ID = 'lending_offices'

/** Verify every registry record against the policy documents that were read. */
export function verifyCitations(graph: CapabilityGraph, policies: PacketDocument[]): CitationIndex {
  const records: Record<string, RecordCitation> = {}
  for (const cap of graph.capabilities) {
    const want = cap.evidence.section.trim().toLowerCase()
    const hit = locate(policies, (s) => s.title.toLowerCase() === want)
    records[cap.capability_id] = record(cap.capability_id, 'capability', hit, (s) => capabilityFields(cap, s))
  }
  for (const a of graph.approvals) {
    const hit = locate(policies, (s) => s.title.includes(`(${a.approval_id})`))
    records[a.approval_id] = record(a.approval_id, 'approval', hit, (s) => approvalFields(a, s))
  }
  records[LENDING_OFFICES_ID] = record(
    LENDING_OFFICES_ID,
    'lending_offices',
    locate(policies, (s) => s.title.toLowerCase() === 'lending offices'),
    (s) => [
      cite(
        s,
        'lending_offices',
        graph.lending_offices.map((o) => `${o.entity} ${o.timezone}`).join(', '),
        graph.lending_offices.flatMap((o) => [officeName(o.entity), o.timezone]),
      ),
    ],
  )
  const all = Object.values(records)
  return {
    graph_version: graph.version,
    records,
    verified: all.filter((r) => r.status === 'verified').length,
    mismatched: all.filter((r) => r.status === 'mismatch').length,
    not_in_packet: all.filter((r) => r.status === 'not_in_packet').length,
  }
}

// ------------------------------------------------------------ evidence for a check

/** A policy passage that supports the bank side of one check. */
export interface EvidencePassage {
  record_id: string
  document_id: string
  document_version: string
  section: DocSection
  paragraphs: DocParagraph[]
  /** The verified words inside the passage. Empty when the link could not be verified. */
  highlights: Span[]
  verified: boolean
}

/** Which registry values a comparator's check rests on. */
const CHECK_FIELDS: Record<string, CitedField[]> = {
  currency: ['currency'],
  'amount.value': ['max_amount'],
  'amount.increment': ['amount_increment'],
  'timing.settlement': ['settlement'],
  'timing.notice_lead': ['notice_lead'],
  'timing.notice_cutoff': ['cutoff', 'timezone'],
  booking_entity: ['booking_entity', 'currency'],
  notice_channel: ['notice_channel'],
  required_fields: ['required_fields'],
  'capability.outcome': ['manual_path'],
  'manual_path.sla': ['manual_path'],
  service_level: ['manual_path'],
  approval: ['requires_approval'],
}

function passage(rec: RecordCitation | undefined, fields: CitedField[]): EvidencePassage | null {
  if (!rec || !rec.section || !rec.document_id || !rec.document_version) return null
  const cited = rec.fields.filter((f) => fields.includes(f.field))
  return {
    record_id: rec.record_id,
    document_id: rec.document_id,
    document_version: rec.document_version,
    section: rec.section,
    paragraphs: rec.section.paragraphs,
    highlights: cited.flatMap((f) => f.spans),
    verified: cited.length > 0 && cited.every((f) => f.verified),
  }
}

/**
 * The policy passages behind one check, in reading order. An approval check
 * cites two: the procedure that demands the approval, then the register entry
 * that says whether that authority is in force.
 */
export function evidenceForCheck(check: CheckResult, index: CitationIndex, graph: CapabilityGraph): EvidencePassage[] {
  const out: EvidencePassage[] = []
  const primary = passage(index.records[check.capability_id], CHECK_FIELDS[check.field] ?? [])
  if (primary) out.push(primary)
  if (check.field === 'approval') {
    const approval = graph.approvals.find((a) => check.required.toLowerCase().startsWith(a.role))
    const register = approval && passage(index.records[approval.approval_id], ['threshold', 'effective_from', 'effective_to'])
    if (register) out.push(register)
  }
  if (check.field === 'booking_entity' && /any lending office/i.test(check.required)) {
    const offices = passage(index.records[LENDING_OFFICES_ID], ['lending_offices'])
    if (offices) out.push(offices)
  }
  return out
}
