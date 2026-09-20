import type { Extraction } from '@/lib/extractClient'
import type { CandidatePath, Decision, ReplayRecord, Requirement } from '@/domain/types'
import { OPERATOR_WORDS, humanize, money } from './format'

/** One typed field of a requirement, as the process view lands it. null = the clause never said. */
export interface FieldRow {
  key: string
  label: string
  value: string | null
}

/** The requirement's fields in the order the process view lands them. Nothing is invented: null stays null. */
export function fieldRows(req: Requirement): FieldRow[] {
  const t = req.timing
  const rows: FieldRow[] = [
    { key: 'operation', label: 'Operation', value: humanize(req.operation) },
    { key: 'currency', label: 'Currency', value: req.currency },
    {
      key: 'amount',
      label: 'Amount',
      value: req.amount ? `${OPERATOR_WORDS[req.amount.operator]} ${money(req.amount.value, req.amount.unit)}` : null,
    },
    {
      key: 'timing.settlement',
      label: 'Settlement',
      value: t && t.settlement !== 'unspecified' ? humanize(t.settlement) : null,
    },
    { key: 'timing.notice_cutoff', label: 'Notice cutoff', value: t?.notice_cutoff ?? null },
    { key: 'timing.timezone', label: 'Cutoff timezone', value: t?.timezone ?? null },
    { key: 'booking_entity', label: 'Booking entity', value: req.booking_entity ? humanize(req.booking_entity) : null },
    {
      key: 'notice_channel',
      label: 'Notice channel',
      value: req.notice_channel && req.notice_channel !== 'unspecified' ? humanize(req.notice_channel) : null,
    },
    {
      key: 'required_fields',
      label: 'Required fields',
      value: req.required_fields?.length ? req.required_fields.join(', ') : null,
    },
  ]
  if (req.interest) {
    rows.push({
      key: 'interest',
      label: 'Interest',
      value: [req.interest.benchmark, req.interest.method, req.interest.day_count].filter(Boolean).join(' · '),
    })
  }
  if (req.fee) {
    rows.push({
      key: 'fee',
      label: 'Fee',
      value: `${req.fee.basis} · ${req.fee.recipients} recipient${req.fee.recipients === 1 ? '' : 's'} · ${req.fee.currencies.join(', ')}`,
    })
  }
  return rows
}

/** How many primitive values a validated structure holds. */
export function leafCount(value: unknown): number {
  if (value === null || typeof value !== 'object') return 1
  return Object.values(value as Record<string, unknown>).reduce<number>((n, v) => n + leafCount(v), 0)
}

/**
 * A replay record as JSON, one key per line. Only the whitespace differs from
 * JSON.stringify(record, null, 2): id lists stay on one line so the whole record
 * fits a screen. It parses back to the same record.
 */
export function recordLines(record: ReplayRecord): string[] {
  const entries = Object.entries(record)
  return [
    '{',
    ...entries.map(([k, v], i) => {
      const body = Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(', ')}]` : JSON.stringify(v)
      return `  ${JSON.stringify(k)}: ${body}${i < entries.length - 1 ? ',' : ''}`
    }),
    '}',
  ]
}

/**
 * What the search rejected or held a path on: the first check that carries the
 * path's own verdict. A FAIL path is tagged with its first FAIL, not with a
 * MANUAL that happened to fire earlier.
 */
export function firstBlockingField(path: CandidatePath): string | null {
  if (path.decision === 'PASS') return null
  const decisive = path.checks.find((k) => k.verdict === path.decision) ?? path.checks.find((k) => k.verdict !== 'PASS')
  return decisive?.field ?? (path.complete ? null : 'incomplete')
}

export const countDecisions = (paths: Pick<CandidatePath, 'decision'>[]): Record<Decision, number> =>
  paths.reduce<Record<Decision, number>>((acc, p) => ({ ...acc, [p.decision]: acc[p.decision] + 1 }), {
    PASS: 0,
    MANUAL: 0,
    FAIL: 0,
  })

export const ms = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)} ms`
export const seconds = (n: number) => `${(n / 1000).toFixed(1)} s`
export const shortHash = (hash: string) => `${hash.slice(0, 'sha256:'.length + 4)}…`

/** The status line's model half. Only ever a time the server measured. */
export function modelCallText(e: Extraction | null): string {
  if (!e) return 'not made yet'
  const d = e.diagnostics
  if (e.clause.extraction_source === 'nemotron') return d ? seconds(d.upstream_ms) : 'live'
  if (e.fallback_reason === 'no_api_key' || !d || d.calls === 0) return 'none made · cached fixture shown'
  return `no usable answer in ${seconds(d.upstream_ms)} · cached fixture shown`
}
