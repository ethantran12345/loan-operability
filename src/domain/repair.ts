/**
 * Repair proposals.
 *
 * The model may write the sentence, but it may not invent the number. Every
 * proposal here is derived from a bound that already exists in the capability
 * graph, and carries the capability_id it came from, so a judge can trace any
 * suggested value back to the operating procedure that authorises it.
 *
 * Proposals are DRAFTING changes. Where the only route is a human step (a manual
 * authentication, an approval, stale evidence), no proposal is offered and the
 * reason is stated instead.
 */

import type {
  Capability,
  CapabilityGraph,
  CheckResult,
  NoticeChannel,
  Requirement,
  RequirementResult,
  Settlement,
} from './types'

export type RepairPatch =
  | { kind: 'amount.value'; value: number }
  | { kind: 'amount.increment'; increment: number }
  | { kind: 'timing.cutoff'; cutoff: string; timezone: string }
  | { kind: 'timing.settlement'; settlement: Settlement }
  | { kind: 'timing.notice_lead'; days: number }
  | { kind: 'timing.service_level'; days: number }
  | { kind: 'booking_entity'; entity: string }
  | { kind: 'notice_channel'; channel: NoticeChannel }
  | { kind: 'required_fields'; fields: string[] }
  | { kind: 'interest.observation_shift'; days: number }
  | { kind: 'interest.floor_bps'; bps: number }
  | { kind: 'fee.recipients'; count: number }
  | { kind: 'fee.currencies'; currencies: string[] }

export interface RepairProposal {
  field: string
  from: string
  to: string
  rationale: string
  /** The capability whose verified bound supplied the new value. */
  capability_id: string
  patch: RepairPatch
}

export interface Unrepairable {
  field: string
  reason: string
}

export interface RepairPlan {
  proposals: RepairProposal[]
  unrepairable: Unrepairable[]
  /** Human-readable drafting suggestion. Always labelled as a suggestion. */
  narrative: string | null
}

/** Fields whose only resolution is a human step, not a drafting change. */
const HUMAN_ONLY = new Set(['capability.outcome', 'approval', 'evidence.freshness', 'manual_path.sla'])

const money = (n: number, unit = '') =>
  `${unit ? unit + ' ' : ''}${n.toLocaleString('en-US')}`

function proposalFor(
  check: CheckResult,
  cap: Capability,
  req: Requirement,
): RepairProposal | Unrepairable | null {
  const c = cap.constraints
  const unit = req.amount?.unit ?? req.currency ?? ''
  const cite = `${cap.label} (${cap.capability_id}), ${cap.evidence.section}`

  switch (check.field) {
    case 'amount.value': {
      if (c.max_amount === undefined) return null
      return {
        field: 'amount.value',
        from: money(req.amount?.value ?? 0, unit),
        to: money(c.max_amount, unit),
        rationale: `${money(c.max_amount, unit)} is the verified same-day ceiling in ${cite}`,
        capability_id: cap.capability_id,
        patch: { kind: 'amount.value', value: c.max_amount },
      }
    }
    case 'amount.increment': {
      if (c.amount_increment === undefined) return null
      const rounded = Math.floor((req.amount?.value ?? 0) / c.amount_increment) * c.amount_increment
      return {
        field: 'amount.increment',
        from: money(req.amount?.value ?? 0, unit),
        to: money(rounded, unit),
        rationale: `Draws settle in multiples of ${money(c.amount_increment, unit)} per ${cite}`,
        capability_id: cap.capability_id,
        patch: { kind: 'amount.increment', increment: c.amount_increment },
      }
    }
    case 'timing.notice_cutoff': {
      if (!c.cutoff || !c.timezone) return null
      return {
        field: 'timing.notice_cutoff',
        from: `${req.timing?.notice_cutoff ?? 'not stated'}${req.timing?.timezone ? ' ' + req.timing.timezone : ' (timezone not stated)'}`,
        to: `${c.cutoff} ${c.timezone}`,
        rationale: `${c.cutoff} ${c.timezone} is the verified cutoff in ${cite}, and stating the zone removes the ambiguity`,
        capability_id: cap.capability_id,
        patch: { kind: 'timing.cutoff', cutoff: c.cutoff, timezone: c.timezone },
      }
    }
    case 'timing.settlement': {
      if (!c.settlement) return null
      return {
        field: 'timing.settlement',
        from: req.timing?.settlement ?? 'not stated',
        to: c.settlement,
        rationale: `${cite} operates on ${c.settlement}`,
        capability_id: cap.capability_id,
        patch: { kind: 'timing.settlement', settlement: c.settlement },
      }
    }
    case 'timing.notice_lead': {
      if (c.notice_lead_business_days === undefined) return null
      return {
        field: 'timing.notice_lead',
        from: `T-${req.timing?.notice_lead_business_days ?? 0}`,
        to: `T-${c.notice_lead_business_days}`,
        rationale: `${cite} requires T-${c.notice_lead_business_days} notice`,
        capability_id: cap.capability_id,
        patch: { kind: 'timing.notice_lead', days: c.notice_lead_business_days },
      }
    }
    case 'service_level': {
      if (c.min_service_level_business_days === undefined) return null
      return {
        field: 'service_level',
        from: `${req.timing?.service_level_business_days} business day(s)`,
        to: `${c.min_service_level_business_days} business day(s)`,
        rationale: `${c.min_service_level_business_days} business day(s) is the fastest verified turnaround in ${cite}`,
        capability_id: cap.capability_id,
        patch: { kind: 'timing.service_level', days: c.min_service_level_business_days },
      }
    }
    case 'booking_entity': {
      const allowed = c.booking_entity
      if (!allowed || allowed.length === 0) return null
      const entity = allowed[0]!
      return {
        field: 'booking_entity',
        from: req.booking_entity === 'any_lending_office' ? 'any lending office' : (req.booking_entity ?? 'not stated'),
        to: entity,
        rationale: `${entity} is the approved booking entity for this currency per ${cite}; naming it replaces an open promise with one the bank can keep`,
        capability_id: cap.capability_id,
        patch: { kind: 'booking_entity', entity },
      }
    }
    case 'notice_channel': {
      const allowed = c.notice_channel?.filter((x) => x !== 'any')
      if (!allowed || allowed.length === 0) return null
      const channel = allowed[0]!
      return {
        field: 'notice_channel',
        from: req.notice_channel ?? 'not stated',
        to: channel,
        rationale: `${channel} intake is the automated path in ${cite}`,
        capability_id: cap.capability_id,
        patch: { kind: 'notice_channel', channel },
      }
    }
    case 'required_fields': {
      if (!c.required_fields || c.required_fields.length === 0) return null
      return {
        field: 'required_fields',
        from: req.required_fields?.join(', ') || 'not stated',
        to: c.required_fields.join(', '),
        rationale: `${cite} cannot process a notice without these fields, so the clause should commit the borrower to them`,
        capability_id: cap.capability_id,
        patch: { kind: 'required_fields', fields: [...c.required_fields] },
      }
    }
    case 'interest.observation_shift_days': {
      if (c.max_observation_shift_days === undefined) return null
      return {
        field: 'interest.observation_shift_days',
        from: `${req.interest?.observation_shift_days} business days`,
        to: `${c.max_observation_shift_days} business days`,
        rationale: `${c.max_observation_shift_days} business days is the platform maximum in ${cite}`,
        capability_id: cap.capability_id,
        patch: { kind: 'interest.observation_shift', days: c.max_observation_shift_days },
      }
    }
    case 'interest.floor_bps': {
      const allowed = c.allowed_floor_bps
      if (!allowed || allowed.length === 0) return null
      const bps = allowed[0]!
      return {
        field: 'interest.floor_bps',
        from: `${req.interest?.floor_bps} bps`,
        to: `${bps} bps`,
        rationale: `${bps} bps is the standard configuration in ${cite}; anything else needs the rate engine configured by hand`,
        capability_id: cap.capability_id,
        patch: { kind: 'interest.floor_bps', bps },
      }
    }
    case 'fee.recipients': {
      if (c.max_fee_recipients === undefined) return null
      return {
        field: 'fee.recipients',
        from: `${req.fee?.recipients}`,
        to: `${c.max_fee_recipients}`,
        rationale: `${cite} allocates automatically to at most ${c.max_fee_recipients} recipient(s)`,
        capability_id: cap.capability_id,
        patch: { kind: 'fee.recipients', count: c.max_fee_recipients },
      }
    }
    case 'fee.currencies': {
      if (c.max_fee_currencies === undefined) return null
      const kept = (req.fee?.currencies ?? []).slice(0, c.max_fee_currencies)
      return {
        field: 'fee.currencies',
        from: (req.fee?.currencies ?? []).join(', '),
        to: kept.join(', '),
        rationale: `${cite} settles a single fee in at most ${c.max_fee_currencies} currency`,
        capability_id: cap.capability_id,
        patch: { kind: 'fee.currencies', currencies: kept },
      }
    }
    default:
      return null
  }
}

/**
 * Build a repair plan from the path the evaluator actually selected. Both hard
 * conflicts and unresolved manual flags are addressed, because a MANUAL is not a
 * PASS: the revision has to clear everything that stood between the clause and a
 * complete automated path.
 */
export function proposeRepairs(
  req: Requirement,
  result: RequirementResult,
  graph: CapabilityGraph,
): RepairPlan {
  const selected =
    result.candidate_paths.find((p) => p.path_id === result.selected_path_id) ??
    // FAIL selects no path; repair against the one the conflicts were reported from.
    result.candidate_paths.find((p) =>
      result.conflicts.some((c) => p.legs.some((l) => l.capability_id === c.capability_id)),
    )

  if (!selected || !selected.complete) {
    return {
      proposals: [],
      unrepairable: [
        {
          field: 'path',
          reason:
            'No complete operating path exists for this operation, so no drafting change can make it executable.',
        },
      ],
      narrative: null,
    }
  }

  const proposals: RepairProposal[] = []
  const unrepairable: Unrepairable[] = []
  const seen = new Set<string>()

  for (const check of selected.checks) {
    if (check.verdict === 'PASS') continue
    if (seen.has(check.field)) continue
    seen.add(check.field)

    if (HUMAN_ONLY.has(check.field)) {
      unrepairable.push({
        field: check.field,
        reason: check.reason,
      })
      continue
    }

    const cap = graph.capabilities.find((c) => c.capability_id === check.capability_id)
    if (!cap) continue
    const outcome = proposalFor(check, cap, req)
    if (!outcome) continue
    if ('patch' in outcome) proposals.push(outcome)
    else unrepairable.push(outcome)
  }

  return { proposals, unrepairable, narrative: describeAlternative(req, proposals) }
}

/** Apply a plan's patches to produce the revised requirement. Pure. */
export function applyRepairs(req: Requirement, proposals: RepairProposal[]): Requirement {
  let next = structuredClone(req)
  for (const { patch } of proposals) {
    switch (patch.kind) {
      case 'amount.value':
        if (next.amount) next.amount = { ...next.amount, value: patch.value }
        break
      case 'amount.increment':
        if (next.amount)
          next.amount = {
            ...next.amount,
            value: Math.floor(next.amount.value / patch.increment) * patch.increment,
          }
        break
      case 'timing.cutoff':
        if (next.timing)
          next.timing = { ...next.timing, notice_cutoff: patch.cutoff, timezone: patch.timezone }
        break
      case 'timing.settlement':
        if (next.timing) next.timing = { ...next.timing, settlement: patch.settlement }
        break
      case 'timing.notice_lead':
        if (next.timing) next.timing = { ...next.timing, notice_lead_business_days: patch.days }
        break
      case 'timing.service_level':
        if (next.timing) next.timing = { ...next.timing, service_level_business_days: patch.days }
        break
      case 'booking_entity':
        next.booking_entity = patch.entity
        break
      case 'notice_channel':
        next.notice_channel = patch.channel
        break
      case 'required_fields':
        next.required_fields = patch.fields
        break
      case 'interest.observation_shift':
        if (next.interest)
          next.interest = { ...next.interest, observation_shift_days: patch.days }
        break
      case 'interest.floor_bps':
        if (next.interest) next.interest = { ...next.interest, floor_bps: patch.bps }
        break
      case 'fee.recipients':
        if (next.fee) next.fee = { ...next.fee, recipients: patch.count }
        break
      case 'fee.currencies':
        if (next.fee) next.fee = { ...next.fee, currencies: patch.currencies }
        break
    }
  }
  // The revision resolves the ambiguities the original clause left open.
  const resolved = new Set(proposals.map((p) => p.field))
  if (resolved.has('timing.notice_cutoff') || resolved.has('notice_channel')) {
    next = { ...next, ambiguities: [] }
  }
  return next
}

function describeAlternative(req: Requirement, proposals: RepairProposal[]): string | null {
  if (proposals.length === 0) return null
  const parts: string[] = []
  const byField = new Map(proposals.map((p) => [p.field, p]))

  const amount = byField.get('amount.value') ?? byField.get('amount.increment')
  if (amount) parts.push(`cap the same-day advance at ${amount.to}`)

  const cutoff = byField.get('timing.notice_cutoff')
  if (cutoff) parts.push(`require the Borrowing Notice by ${cutoff.to}`)

  const channel = byField.get('notice_channel')
  if (channel) parts.push(`delivered through the ${channel.to}`)

  const fields = byField.get('required_fields')
  if (fields) parts.push(`specifying ${fields.to.replace(/_/g, ' ')}`)

  const entity = byField.get('booking_entity')
  if (entity) parts.push(`and book the advance through the ${entity.to} lending office`)

  for (const p of proposals) {
    if (
      ['amount.value', 'amount.increment', 'timing.notice_cutoff', 'notice_channel', 'required_fields', 'booking_entity'].includes(
        p.field,
      )
    )
      continue
    parts.push(`set ${p.field.replace(/[._]/g, ' ')} to ${p.to}`)
  }

  let sentence = parts.join(', ').replace(/, and /g, ' and ')
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.'
  if (byField.has('amount.value')) {
    sentence += ` Advances above ${byField.get('amount.value')!.to} move to advance-notice funding.`
  }
  return `${sentence} Suggested drafting change, constructed from verified capability limits — not legal advice.`
}
