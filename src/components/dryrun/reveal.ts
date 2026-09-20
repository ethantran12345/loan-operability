import type { RepairPlan, RepairProposal } from '@/domain/repair'
import type { CheckResult, Decision, Requirement } from '@/domain/types'
import { bankSide } from '@/lib/findingText'
import { fieldRows } from '@/lib/runFormat'
import { decisivePath, type ClauseReview, type Evaluated } from '@/lib/useAgreementReview'

/**
 * One extracted term on a finding card. The text is the requirement's own value;
 * `missing` is a term the clause never stated, shown amber and never filled in.
 */
export interface TermChip {
  /** The fieldRows key this chip was read from. */
  key: string
  text: string
  missing: boolean
  /** For a missing term: what the model itself said about it, when it said anything. */
  note?: string
  /** Engine check fields that judge this term. Empty: nothing in the engine checks it. */
  fields: string[]
}

/** Terms that stay on the card when the clause is silent on them, because the engine asks about them. */
const MISSING: Record<string, { text: string; hint: RegExp }> = {
  'timing.timezone': { text: 'Timezone not stated', hint: /time\s?zone/i },
  notice_channel: { text: 'Channel not stated', hint: /channel/i },
  required_fields: { text: 'Fields not stated', hint: /content|field/i },
}

const FIELDS: Record<string, string[]> = {
  currency: ['currency'],
  amount: ['amount.value', 'amount.increment'],
  'timing.settlement': ['timing.settlement'],
  'timing.notice_cutoff': ['timing.notice_cutoff'],
  'timing.timezone': ['timing.notice_cutoff'],
  booking_entity: ['booking_entity'],
  notice_channel: ['notice_channel'],
  required_fields: ['required_fields'],
  interest: ['interest.benchmark', 'interest.method', 'interest.day_count', 'interest.observation_shift_days', 'interest.floor_bps'],
  fee: ['fee.basis', 'fee.recipients', 'fee.currencies'],
}

/** The requirement as chips, in landing order. Only what the model returned: a null is omitted or amber, never guessed. */
export function termChips(req: Requirement): TermChip[] {
  const chips: TermChip[] = []
  for (const row of fieldRows(req)) {
    const fields = FIELDS[row.key] ?? []
    if (row.value === null) {
      const missing = MISSING[row.key]
      // A timezone only matters once there is a cutoff for it to belong to.
      if (!missing || (row.key === 'timing.timezone' && !req.timing?.notice_cutoff)) continue
      chips.push({ key: row.key, text: missing.text, missing: true, note: req.ambiguities.find((a) => missing.hint.test(a)), fields })
      continue
    }
    const text =
      row.key === 'amount'
        ? req.amount!.value.toLocaleString('en-US')
        : row.key === 'timing.notice_cutoff'
          ? `Cutoff ${row.value}`
          : row.key === 'required_fields'
            ? `${req.required_fields!.length} notice field${req.required_fields!.length === 1 ? '' : 's'}`
            : row.value
    chips.push({ key: row.key, text, missing: false, note: row.key === 'required_fields' ? row.value : undefined, fields })
  }
  return chips
}

export interface ChipMark {
  verdict: Decision
  /** The bank's side, on a term the bank does not simply support. */
  bank: string | null
  capability_id: string
}

const RANK: Record<Decision, number> = { PASS: 0, MANUAL: 1, FAIL: 2 }

/** The decisive path's verdict on a term: the hardest of the checks that judge it. null when none does. */
export function chipMark(chip: TermChip, checks: CheckResult[]): ChipMark | null {
  const mine = checks.filter((k) => chip.fields.includes(k.field))
  if (mine.length === 0) return null
  const worst = mine.reduce((a, b) => (RANK[b.verdict] > RANK[a.verdict] ? b : a))
  if (worst.verdict === 'PASS') return { verdict: 'PASS', bank: null, capability_id: worst.capability_id }
  let bank = worst.field === 'amount.value' ? `up to ${bankSide(worst).value.replace(/^[A-Z]{3} /, '')}` : bankSide(worst).value
  // The cutoff check carries "09:30 Europe/London"; the timezone chip shows the zone half of it.
  if (chip.key === 'timing.timezone') bank = bank.replace(/^\d{1,2}:\d{2}\s+/, '')
  if (worst.field === 'booking_entity') bank = `${bank.toLowerCase()} only`
  return { verdict: worst.verdict, bank, capability_id: worst.capability_id }
}

export interface ChipChange {
  to: string
  capability_id: string
}

/** What the re-test changed on a term: the repaired requirement's own value, and the capability that supplied it. */
export function chipChange(chip: TermChip, repaired: TermChip | undefined, plan: RepairPlan): ChipChange | null {
  if (!repaired || repaired.text === chip.text) return null
  const proposal: RepairProposal | undefined = plan.proposals.find((p) => chip.fields.includes(p.field))
  if (!proposal) return null
  return { to: repaired.text, capability_id: proposal.capability_id }
}

/**
 * Decisive-path checks that no extracted term carries and that did not pass: an
 * expired approval, a manual step. They are the engine's, not the model's, so
 * they join the chips only when the marks land.
 */
export function routeChecks(chips: TermChip[], checks: CheckResult[]): CheckResult[] {
  const carried = new Set(chips.flatMap((c) => c.fields))
  return checks.filter((k) => k.verdict !== 'PASS' && !carried.has(k.field))
}

// ---------------------------------------------------------------- pacing

/**
 * When each part of a card is revealed, in ms after the card's response landed.
 * This is pacing only: by the time a card lands, the extraction has been
 * received and `evaluate()` has already returned. Nothing here delays either.
 */
export interface Timeline {
  chips: number
  chipEvery: number
  counter: number
  counterMs: number
  marks: number
  markEvery: number
  pill: number
  done: number
}

export const ACT_ONE = { every: 150, hold: 600 }
const SWEEP_MS = 500

export function cardTimeline(chips: number, marks: number, retryLine: boolean, still: boolean): Timeline {
  if (still) return { chips: 0, chipEvery: 0, counter: 0, counterMs: 0, marks: 0, markEvery: 0, pill: 0, done: 0 }
  const chipEvery = 110
  const start = retryLine ? 700 : 150
  const counter = start + chips * chipEvery + 250
  const counterMs = 800
  const markEvery = 120
  const marksAt = counter + counterMs + 100
  const pill = marksAt + marks * markEvery + 150
  return { chips: start, chipEvery, counter, counterMs, marks: marksAt, markEvery, pill, done: pill + 250 }
}

/** The re-test on the same chips: values retype, the route counter runs again, the marks re-run, the pill flips. */
export function repairTimeline(changes: number, marks: number, still: boolean): Timeline {
  if (still) return cardTimeline(0, 0, false, true)
  const chipEvery = 140
  const counter = changes * chipEvery + 750
  const counterMs = 500
  const markEvery = 120
  const marksAt = counter + counterMs + 100
  const pill = marksAt + marks * markEvery + 150
  return { chips: 0, chipEvery, counter, counterMs, marks: marksAt, markEvery, pill, done: pill + 250 }
}

/** How many of `n` items, each `every` ms apart from `from`, have been revealed at `t`. */
export const revealed = (t: number, from: number, every: number, n: number) =>
  t < from ? 0 : every <= 0 ? n : Math.min(n, Math.floor((t - from) / every) + 1)

/** The route counter's reading at `t`: the engine's real path count, counted up to over `counterMs`. */
export function routesCounted(t: number, line: Timeline, total: number): number {
  if (t < line.counter) return 0
  if (line.counterMs <= 0 || t >= line.counter + line.counterMs) return total
  return Math.max(1, Math.ceil(((t - line.counter) / line.counterMs) * total))
}

export const sweeping = (t: number) => t >= 0 && t < SWEEP_MS + 400

/** Everything a card reveals, and when. The parent reads the same plan to stamp the margin pill at the same moment. */
export function cardPlan(review: ClauseReview, retest: Evaluated | null, still: boolean) {
  const requirement = review.extraction!.clause.requirements[0]!
  const chips = termChips(requirement)
  const checks = decisivePath(review.evaluated!)?.checks ?? []
  const marks = chips.map((chip) => chipMark(chip, checks))
  const route = routeChecks(chips, checks)
  // Only what the server reported: a second round with the model, and why the first reply was turned down.
  const d = review.extraction!.diagnostics
  const retry = d && (d.rejection || d.attempts > 1) ? (d.rejection ?? '') : null
  const line = cardTimeline(chips.length, marks.filter(Boolean).length + route.length, retry !== null, still)

  if (!retest || !review.plan) return { chips, marks, route, retry, line, repair: null }
  const repairedChips = termChips(retest.clause.requirements[0]!)
  const reChecks = decisivePath(retest)?.checks ?? []
  const changes = chips.map((chip) => chipChange(chip, repairedChips.find((r) => r.key === chip.key), review.plan!))
  // A repaired term is judged as the repaired chip; the text on the card is still the original's, struck through.
  const reMarks = chips.map((chip) => chipMark(repairedChips.find((r) => r.key === chip.key) ?? chip, reChecks))
  const reRoute = routeChecks(repairedChips, reChecks)
  const repairLine = repairTimeline(changes.filter(Boolean).length, reMarks.filter(Boolean).length + reRoute.length, still)
  return { chips, marks, route, retry, line, repair: { changes, marks: reMarks, route: reRoute, line: repairLine } }
}
