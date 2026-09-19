/**
 * Typed comparator registry.
 *
 * Each comparator answers one question about one field, against one capability,
 * and returns CheckResults carrying both sides of the comparison plus the
 * capability that authorised the answer. Nothing here is fuzzy: a comparator
 * either has enough typed information to decide, or it returns MANUAL. An
 * unknown never becomes a PASS.
 */

import type {
  Capability,
  CapabilityGraph,
  CheckResult,
  Requirement,
} from './types'
import {
  convertClock,
  daysBetween,
  formatClock,
  parseClock,
} from './time'

export type Comparator = (
  req: Requirement,
  cap: Capability,
  graph: CapabilityGraph,
  txTime: string,
) => CheckResult[]

const pass = (
  field: string,
  required: string,
  supported: string,
  reason: string,
  cap: Capability,
): CheckResult => ({
  field,
  verdict: 'PASS',
  required,
  supported,
  reason,
  capability_id: cap.capability_id,
})

const fail = (
  field: string,
  required: string,
  supported: string,
  reason: string,
  cap: Capability,
): CheckResult => ({
  field,
  verdict: 'FAIL',
  required,
  supported,
  reason,
  capability_id: cap.capability_id,
})

const manual = (
  field: string,
  required: string,
  supported: string,
  reason: string,
  cap: Capability,
  owner?: string,
  sla?: number | null,
): CheckResult => ({
  field,
  verdict: 'MANUAL',
  required,
  supported,
  reason,
  capability_id: cap.capability_id,
  owner: owner ?? cap.manual_path?.owner,
  sla_business_days: sla ?? cap.manual_path?.sla_business_days ?? null,
})

const money = (n: number, unit = '') =>
  `${unit ? unit + ' ' : ''}${n.toLocaleString('en-US')}`

// ---------------------------------------------------------------- currency

export const currencyComparator: Comparator = (req, cap) => {
  const allowed = cap.constraints.currency
  if (!allowed || !req.currency) return []
  if (allowed.includes(req.currency)) {
    return [
      pass('currency', req.currency, allowed.join(', '), 'Currency is supported on this path', cap),
    ]
  }
  return [
    fail(
      'currency',
      req.currency,
      allowed.join(', '),
      `${req.currency} is not supported by ${cap.label}`,
      cap,
    ),
  ]
}

// ---------------------------------------------------------------- amount

export const amountComparator: Comparator = (req, cap) => {
  const out: CheckResult[] = []
  const amt = req.amount
  if (!amt) return out
  const unit = amt.unit || req.currency || ''

  if (cap.constraints.max_amount !== undefined) {
    const supported = cap.constraints.max_amount
    // Inclusive limit: required === supported passes.
    if (amt.value <= supported) {
      out.push(
        pass(
          'amount.value',
          money(amt.value, unit),
          `max ${money(supported, unit)}`,
          'Requested size is within the supported band',
          cap,
        ),
      )
    } else {
      out.push(
        fail(
          'amount.value',
          money(amt.value, unit),
          `max ${money(supported, unit)}`,
          `${cap.label} maximum exceeded by ${money(amt.value - supported, unit)}`,
          cap,
        ),
      )
    }
  }

  if (cap.constraints.amount_increment !== undefined) {
    const inc = cap.constraints.amount_increment
    if (amt.value % inc === 0) {
      out.push(
        pass(
          'amount.increment',
          money(amt.value, unit),
          `multiples of ${money(inc, unit)}`,
          'Amount is a permitted increment',
          cap,
        ),
      )
    } else {
      out.push(
        fail(
          'amount.increment',
          money(amt.value, unit),
          `multiples of ${money(inc, unit)}`,
          'Draws must be in permitted increments',
          cap,
        ),
      )
    }
  }
  return out
}

// ---------------------------------------------------------------- settlement

export const settlementComparator: Comparator = (req, cap) => {
  const reqSettlement = req.timing?.settlement
  const capSettlement = cap.constraints.settlement
  if (!reqSettlement || !capSettlement) return []
  if (reqSettlement === 'unspecified') {
    return [
      manual(
        'timing.settlement',
        'unspecified',
        capSettlement,
        'Clause does not state a settlement basis, so timing cannot be proven',
        cap,
        'loan operations',
        null,
      ),
    ]
  }
  if (reqSettlement === capSettlement) {
    return [
      pass('timing.settlement', reqSettlement, capSettlement, 'Settlement basis matches', cap),
    ]
  }
  return [
    fail(
      'timing.settlement',
      reqSettlement,
      capSettlement,
      `${cap.label} operates on ${capSettlement}, not ${reqSettlement}`,
      cap,
    ),
  ]
}

// ---------------------------------------------------------------- notice lead

export const noticeLeadComparator: Comparator = (req, cap) => {
  const required = req.timing?.notice_lead_business_days
  const capLead = cap.constraints.notice_lead_business_days
  if (required === null || required === undefined || capLead === undefined) return []
  // T-1 is a business-day concept, not 24 hours: compare in business days only.
  if (required >= capLead) {
    return [
      pass(
        'timing.notice_lead',
        `${required} business day(s)`,
        `${capLead} business day(s) required`,
        'Contractual notice period meets the operational minimum',
        cap,
      ),
    ]
  }
  return [
    fail(
      'timing.notice_lead',
      `${required} business day(s)`,
      `${capLead} business day(s) required`,
      `${cap.label} needs T-${capLead} notice; the clause concedes only T-${required}`,
      cap,
    ),
  ]
}

// ---------------------------------------------------------------- cutoff

/**
 * Cutoff is the comparator that earns the product.
 *
 * A clause that names a wall-clock time but no timezone is genuinely ambiguous,
 * and guessing is how a real bank gets hurt. So:
 *   - timezone stated      -> normalise and compare, inclusive.
 *   - timezone missing     -> test EVERY lending office the clause could mean.
 *       all interpretations pass -> PASS  (ambiguity is immaterial)
 *       all interpretations fail -> FAIL  (ambiguity cannot rescue it)
 *       mixed                    -> MANUAL (the answer depends on the missing fact)
 */
export const cutoffComparator: Comparator = (req, cap, graph, txTime) => {
  const reqCutoff = req.timing?.notice_cutoff
  const capCutoff = cap.constraints.cutoff
  const capTz = cap.constraints.timezone
  if (!reqCutoff || !capCutoff || !capTz) return []

  const reqMin = parseClock(reqCutoff)
  const capMin = parseClock(capCutoff)
  if (reqMin === null || capMin === null) return []

  const supported = `${capCutoff} ${capTz}`
  const reqTz = req.timing?.timezone

  if (reqTz) {
    const normalised = convertClock(reqMin, reqTz, capTz, txTime)
    if (normalised <= capMin) {
      return [
        pass(
          'timing.notice_cutoff',
          `${reqCutoff} ${reqTz}`,
          supported,
          `${formatClock(normalised)} ${capTz} is at or before the cutoff`,
          cap,
        ),
      ]
    }
    return [
      fail(
        'timing.notice_cutoff',
        `${reqCutoff} ${reqTz}`,
        supported,
        `${formatClock(normalised)} ${capTz} is after the ${capCutoff} cutoff`,
        cap,
      ),
    ]
  }

  // No timezone stated. Test every office the clause could be read against.
  const offices = graph.lending_offices
  const outcomes = offices.map((o) => ({
    entity: o.entity,
    normalised: convertClock(reqMin, o.timezone, capTz, txTime),
  }))
  const passing = outcomes.filter((o) => o.normalised <= capMin)
  const required = `${reqCutoff} (timezone not stated)`

  if (passing.length === outcomes.length) {
    return [
      pass(
        'timing.notice_cutoff',
        required,
        supported,
        'Cutoff is met under every candidate lending-office timezone, so the omission is immaterial',
        cap,
      ),
    ]
  }
  if (passing.length === 0) {
    const worst = outcomes
      .map((o) => `${o.entity} -> ${formatClock(o.normalised)}`)
      .join(', ')
    return [
      fail(
        'timing.notice_cutoff',
        required,
        supported,
        `Cutoff is missed under every candidate lending-office timezone (${worst}), so the missing timezone cannot rescue the clause`,
        cap,
      ),
    ]
  }
  return [
    manual(
      'timing.notice_cutoff',
      required,
      supported,
      `The outcome depends on the unstated timezone: ${passing
        .map((o) => o.entity)
        .join(', ')} would qualify, others would not`,
      cap,
      'loan operations',
      null,
    ),
  ]
}

// ---------------------------------------------------------------- booking entity

export const bookingEntityComparator: Comparator = (req, cap, graph) => {
  const allowed = cap.constraints.booking_entity
  if (!allowed || !req.booking_entity) return []

  // "Any lending office" is a promise of EVERY office, not a choice for the bank.
  if (req.booking_entity === 'any_lending_office') {
    const promised = graph.lending_offices.map((o) => o.entity)
    const missing = promised.filter((e) => !allowed.includes(e))
    if (missing.length === 0) {
      return [
        pass(
          'booking_entity',
          'any lending office',
          allowed.join(', '),
          'Every promised office is an approved booking entity',
          cap,
        ),
      ]
    }
    return [
      fail(
        'booking_entity',
        'any lending office',
        allowed.join(', '),
        `The clause promises every lending office, but ${missing.join(
          ', ',
        )} cannot book this obligation. Narrower drafting is required.`,
        cap,
      ),
    ]
  }

  if (allowed.includes(req.booking_entity)) {
    return [
      pass(
        'booking_entity',
        req.booking_entity,
        allowed.join(', '),
        'Booking entity is approved for this currency and operation',
        cap,
      ),
    ]
  }
  return [
    fail(
      'booking_entity',
      req.booking_entity,
      allowed.join(', '),
      `${req.booking_entity} is not an approved booking entity for this path`,
      cap,
    ),
  ]
}

// ---------------------------------------------------------------- notice channel

export const noticeChannelComparator: Comparator = (req, cap) => {
  const allowed = cap.constraints.notice_channel
  if (!allowed || !req.notice_channel) return []
  if (req.notice_channel === 'unspecified') {
    return [
      manual(
        'notice_channel',
        'unspecified',
        allowed.join(', '),
        'Clause does not name a delivery channel, so intake cannot be proven',
        cap,
        'loan operations',
        null,
      ),
    ]
  }
  if (!allowed.includes(req.notice_channel) && !allowed.includes('any')) {
    return [
      fail(
        'notice_channel',
        req.notice_channel,
        allowed.join(', '),
        `${cap.label} does not accept ${req.notice_channel} notices`,
        cap,
      ),
    ]
  }
  return [
    pass(
      'notice_channel',
      req.notice_channel,
      allowed.join(', '),
      'Channel is accepted by this intake path',
      cap,
    ),
  ]
}

// ---------------------------------------------------------------- required fields

export const requiredFieldsComparator: Comparator = (req, cap) => {
  const needed = cap.constraints.required_fields
  if (!needed || needed.length === 0) return []
  if (req.required_fields === null) {
    return [
      manual(
        'required_fields',
        'not stated',
        needed.join(', '),
        'Clause does not commit the borrower to the fields the bank must have',
        cap,
        'loan operations',
        null,
      ),
    ]
  }
  const missing = needed.filter((f) => !req.required_fields!.includes(f))
  if (missing.length === 0) {
    return [
      pass(
        'required_fields',
        req.required_fields.join(', '),
        needed.join(', '),
        'Notice carries every field required for processing',
        cap,
      ),
    ]
  }
  return [
    fail(
      'required_fields',
      req.required_fields.join(', ') || 'none',
      needed.join(', '),
      `Notices missing ${missing.join(', ')} cannot be processed`,
      cap,
    ),
  ]
}

// ---------------------------------------------------------------- interest

export const interestComparator: Comparator = (req, cap) => {
  const i = req.interest
  if (!i) return []
  const out: CheckResult[] = []
  const c = cap.constraints

  if (c.benchmark) {
    out.push(
      c.benchmark.includes(i.benchmark)
        ? pass('interest.benchmark', i.benchmark, c.benchmark.join(', '), 'Benchmark is supported', cap)
        : fail('interest.benchmark', i.benchmark, c.benchmark.join(', '), `${i.benchmark} is not a supported benchmark`, cap),
    )
  }
  // Matching the method name alone is not sufficient; parameters are checked below.
  if (c.method) {
    out.push(
      c.method.includes(i.method)
        ? pass('interest.method', i.method, c.method.join(', '), 'Calculation method is supported', cap)
        : fail('interest.method', i.method, c.method.join(', '), `${i.method} is not implemented in the servicing platform`, cap),
    )
  }
  if (c.day_count && i.day_count) {
    out.push(
      c.day_count.includes(i.day_count)
        ? pass('interest.day_count', i.day_count, c.day_count.join(', '), 'Day count is supported', cap)
        : fail('interest.day_count', i.day_count, c.day_count.join(', '), `${i.day_count} day count is not supported for this benchmark`, cap),
    )
  }
  if (c.max_observation_shift_days !== undefined && i.observation_shift_days !== null) {
    const max = c.max_observation_shift_days
    out.push(
      i.observation_shift_days <= max
        ? pass('interest.observation_shift_days', `${i.observation_shift_days} business days`, `max ${max} business days`, 'Observation shift is within platform limits', cap)
        : fail('interest.observation_shift_days', `${i.observation_shift_days} business days`, `max ${max} business days`, `Observation shifts beyond ${max} business days are not supported`, cap),
    )
  }
  if (c.allowed_floor_bps && i.floor_bps !== null) {
    out.push(
      c.allowed_floor_bps.includes(i.floor_bps)
        ? pass('interest.floor_bps', `${i.floor_bps} bps`, c.allowed_floor_bps.map((b) => `${b} bps`).join(', '), 'Floor is a standard configuration', cap)
        : manual('interest.floor_bps', `${i.floor_bps} bps`, c.allowed_floor_bps.map((b) => `${b} bps`).join(', '), 'A non-standard negative floor requires manual configuration of the rate engine', cap, cap.manual_path?.owner ?? 'loan servicing', cap.manual_path?.sla_business_days ?? null),
    )
  }
  return out
}

// ---------------------------------------------------------------- fee

export const feeComparator: Comparator = (req, cap) => {
  const f = req.fee
  if (!f) return []
  const out: CheckResult[] = []
  const c = cap.constraints

  if (c.fee_basis) {
    out.push(
      c.fee_basis.includes(f.basis)
        ? pass('fee.basis', f.basis, c.fee_basis.join(', '), 'Fee basis is calculable by the platform', cap)
        : manual('fee.basis', f.basis, c.fee_basis.join(', '), `A ${f.basis} basis depends on data the platform does not hold, so the fee must be calculated by hand`, cap),
    )
  }
  if (c.max_fee_recipients !== undefined) {
    const max = c.max_fee_recipients
    out.push(
      f.recipients <= max
        ? pass('fee.recipients', `${f.recipients}`, `max ${max}`, 'Recipient count is within automated allocation limits', cap)
        : manual('fee.recipients', `${f.recipients}`, `max ${max}`, 'Allocation across this many recipients is a manual operation', cap),
    )
  }
  if (c.max_fee_currencies !== undefined) {
    const max = c.max_fee_currencies
    out.push(
      f.currencies.length <= max
        ? pass('fee.currencies', f.currencies.join(', '), `max ${max} currency`, 'Settlement currency count is supported', cap)
        : manual('fee.currencies', f.currencies.join(', '), `max ${max} currency`, 'Splitting one fee across multiple settlement currencies is a manual allocation', cap),
    )
  }
  return out
}

// ---------------------------------------------------------------- service level

/**
 * The bank's fastest honest turnaround for this path, against the turnaround the
 * contract promises. This is separate from the manual-path check: an automated
 * path can also be too slow for a one-business-day drafting promise.
 */
export const serviceLevelComparator: Comparator = (req, cap) => {
  const floor = cap.constraints.min_service_level_business_days
  const promised = req.timing?.service_level_business_days
  if (floor === undefined || promised === null || promised === undefined) return []
  if (promised >= floor) {
    return [
      pass(
        'service_level',
        `${promised} business day(s) promised`,
        `${floor} business day(s) minimum`,
        'Promised turnaround is achievable on this path',
        cap,
      ),
    ]
  }
  return [
    fail(
      'service_level',
      `${promised} business day(s) promised`,
      `${floor} business day(s) minimum`,
      `${cap.label} cannot complete in under ${floor} business day(s); the clause promises ${promised}`,
      cap,
    ),
  ]
}

// ---------------------------------------------------------------- manual SLA

/**
 * A documented manual path is not automatically a MANUAL verdict. If the bank's
 * own turnaround is slower than the service level the contract promises, the
 * manual path cannot satisfy the clause at all.
 */
export const manualPathComparator: Comparator = (req, cap) => {
  if (cap.outcome === 'unsupported') {
    return [
      fail(
        'capability.outcome',
        'an automated or manual path',
        'no path',
        `${cap.label} is not supported and has no documented manual alternative`,
        cap,
      ),
    ]
  }
  if (cap.outcome !== 'manual' || !cap.manual_path) return []

  const promised = req.timing?.service_level_business_days
  const sla = cap.manual_path.sla_business_days
  if (promised !== null && promised !== undefined && sla > promised) {
    return [
      fail(
        'manual_path.sla',
        `${promised} business day(s) promised`,
        `${sla} business day(s) actual`,
        `${cap.manual_path.description} takes ${sla} business day(s) — the clause promises ${promised}, so the manual path cannot meet the contract`,
        cap,
      ),
    ]
  }
  return [
    manual(
      'capability.outcome',
      'automated processing',
      `manual: ${cap.manual_path.description}`,
      `${cap.manual_path.description} requires human handling by ${cap.manual_path.owner}`,
      cap,
      cap.manual_path.owner,
      sla,
    ),
  ]
}

// ---------------------------------------------------------------- approvals

export const approvalComparator: Comparator = (req, cap, graph, txTime) => {
  const roles = cap.requires_approval
  if (!roles || roles.length === 0) return []
  const out: CheckResult[] = []
  const amount = req.amount?.value ?? 0

  for (const role of roles) {
    const approval = graph.approvals.find((a) => a.role === role)
    if (!approval) {
      out.push(fail('approval', role, 'no such approval role', `No approval authority exists for ${role}`, cap))
      continue
    }
    const effective =
      new Date(txTime).getTime() >= new Date(approval.effective_from).getTime() &&
      (!approval.effective_to || new Date(txTime).getTime() <= new Date(approval.effective_to).getTime())
    if (!effective) {
      out.push(fail('approval', role, `authority expired ${approval.effective_to}`, `${role} authority is not effective at the transaction time`, cap))
      continue
    }
    if (approval.self_approval) {
      out.push(fail('approval', role, 'independent approver', `${role} would be self-approving, which is not sufficiently independent`, cap))
      continue
    }
    if (amount > approval.threshold) {
      out.push(fail('approval', money(amount), `${role} threshold ${money(approval.threshold)}`, `${role} cannot authorise this size`, cap))
      continue
    }
    out.push(
      manual(
        'approval',
        `${role} sign-off`,
        `${role} authorised to ${money(approval.threshold)}`,
        `${role} must approve this exception before signing`,
        cap,
        role,
        1,
      ),
    )
  }
  return out
}

// ---------------------------------------------------------------- evidence

/** Stale evidence cannot silently authorise a PASS. */
export const evidenceComparator: Comparator = (_req, cap, graph, txTime) => {
  const age = daysBetween(cap.evidence.last_verified, txTime)
  const limit = graph.evidence_freshness_days
  if (age <= limit) return []
  return [
    manual(
      'evidence.freshness',
      `verified within ${limit} days`,
      `last verified ${cap.evidence.last_verified} (${age} days)`,
      `The operating procedure behind ${cap.label} is past its verification window and must be re-confirmed`,
      cap,
      'loan operations',
      null,
    ),
  ]
}

// ---------------------------------------------------------------- registry

export const COMPARATORS: { name: string; run: Comparator }[] = [
  { name: 'currency', run: currencyComparator },
  { name: 'amount', run: amountComparator },
  { name: 'settlement', run: settlementComparator },
  { name: 'notice_lead', run: noticeLeadComparator },
  { name: 'cutoff', run: cutoffComparator },
  { name: 'booking_entity', run: bookingEntityComparator },
  { name: 'notice_channel', run: noticeChannelComparator },
  { name: 'required_fields', run: requiredFieldsComparator },
  { name: 'interest', run: interestComparator },
  { name: 'fee', run: feeComparator },
  { name: 'service_level', run: serviceLevelComparator },
  { name: 'manual_path', run: manualPathComparator },
  { name: 'approval', run: approvalComparator },
  { name: 'evidence', run: evidenceComparator },
]
