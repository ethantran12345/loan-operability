import type { AmountConstraint, Decision } from '@/domain/types'

export const money = (value: number, unit: string) => `${unit} ${value.toLocaleString('en-US')}`

export const OPERATOR_WORDS: Record<AmountConstraint['operator'], string> = {
  lte: 'up to',
  gte: 'at least',
  eq: 'exactly',
}

/** snake_case / dotted identifiers as readable words. A place keeps its capitals. The raw id stays visible elsewhere. */
export const humanize = (id: string) => {
  const words = id.replace(/[._]/g, ' ').trim().replace(/\bnew york\b/g, 'New York')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const businessDays = (n: number) =>
  n === 0 ? 'Same day (0 business days)' : `${n} business day${n === 1 ? '' : 's'}`

export const DECISION_MEANING: Record<Decision, string> = {
  PASS: 'At least one complete operating path satisfies every mandatory requirement.',
  MANUAL: 'No path passes automatically, but a named human resolution could create one.',
  FAIL: 'Every candidate path violates at least one mandatory hard constraint.',
}
