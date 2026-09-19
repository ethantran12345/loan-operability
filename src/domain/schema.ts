// Zod schemas for everything that crosses the extraction boundary.
//
// These are the single source of truth for the Requirement side of the domain:
// types.ts re-exports the inferred types, so the shape Nemotron is validated
// against and the shape the evaluator consumes cannot drift apart.

import { z } from 'zod'

export const DecisionSchema = z.enum(['PASS', 'MANUAL', 'FAIL'])

export const OperationSchema = z.enum([
  'receive_notice',
  'fund_draw',
  'book_facility',
  'calculate_interest',
  'collect_fee',
])

export const ClauseTypeSchema = z.enum([
  'borrowing_notice',
  'currency',
  'amount_limit',
  'interest_calculation',
  'repayment_structure',
  'fee',
  'booking_location',
  'approval',
])

export const SettlementSchema = z.enum(['same_day', 't_plus_1', 'unspecified'])
export const NoticeChannelSchema = z.enum(['portal', 'email', 'any', 'unspecified'])
export const AmountOperatorSchema = z.enum(['lte', 'gte', 'eq'])

/** "HH:MM", 24-hour. */
const ClockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be 24-hour "HH:MM"')

export const AmountConstraintSchema = z.object({
  operator: AmountOperatorSchema,
  value: z.number().finite().nonnegative(),
  unit: z.string().min(1),
})

export const TimingConstraintSchema = z.object({
  settlement: SettlementSchema,
  /** Contractual cutoff as "HH:MM", or null when the clause is silent. */
  notice_cutoff: ClockSchema.nullable(),
  /** IANA zone. null means the clause never said — an unknown the evaluator must not guess past. */
  timezone: z.string().min(1).nullable(),
  /** Business days of advance notice the contract concedes. 0 = same day. */
  notice_lead_business_days: z.number().int().nonnegative().nullable(),
  /** Business days the contract promises for a manual/operational step. */
  service_level_business_days: z.number().int().nonnegative().nullable(),
})

export const InterestConstraintSchema = z.object({
  benchmark: z.string().min(1),
  method: z.string().min(1),
  day_count: z.string().min(1).nullable(),
  observation_shift_days: z.number().int().nullable(),
  /** Floor in basis points. 0 = zero floor. -50 = -0.50%. */
  floor_bps: z.number().nullable(),
})

export const FeeConstraintSchema = z.object({
  basis: z.string().min(1),
  recipients: z.number().int().nonnegative(),
  currencies: z.array(z.string().min(1)),
  recalculation_frequency: z.string().min(1).nullable(),
})

export const RequirementSchema = z.object({
  requirement_id: z.string().min(1),
  operation: OperationSchema,
  currency: z.string().min(1).nullable(),
  amount: AmountConstraintSchema.nullable(),
  timing: TimingConstraintSchema.nullable(),
  /** 'any_lending_office' is a promise of EVERY office, not a free choice for the bank. */
  booking_entity: z.string().min(1).nullable(),
  notice_channel: NoticeChannelSchema.nullable(),
  required_fields: z.array(z.string().min(1)).nullable(),
  interest: InterestConstraintSchema.nullable(),
  fee: FeeConstraintSchema.nullable(),
  mandatory: z.boolean(),
  confidence: z.number().min(0).max(1),
  ambiguities: z.array(z.string()),
})

export const SourceSpanSchema = z.object({
  document: z.string().min(1),
  section: z.string().min(1),
  page: z.number().int().positive(),
})

export const ExtractionSourceSchema = z.enum(['nemotron', 'fixture'])

export const ExtractedClauseSchema = z.object({
  clause_id: z.string().min(1),
  clause_type: ClauseTypeSchema,
  source_text: z.string().min(1),
  source_span: SourceSpanSchema,
  requirements: z.array(RequirementSchema).min(1),
  /** 'nemotron' when live, 'fixture' when the cached fallback served it. */
  extraction_source: ExtractionSourceSchema,
  model: z.string().optional(),
})

/** What /api/extract accepts. */
export const ExtractRequestSchema = z.object({
  clause_id: z.string().min(1),
  clause_type: ClauseTypeSchema,
  source_text: z.string().min(1),
  source_span: SourceSpanSchema,
})

export type Decision = z.infer<typeof DecisionSchema>
export type Operation = z.infer<typeof OperationSchema>
export type ClauseType = z.infer<typeof ClauseTypeSchema>
export type Settlement = z.infer<typeof SettlementSchema>
export type NoticeChannel = z.infer<typeof NoticeChannelSchema>
export type AmountOperator = z.infer<typeof AmountOperatorSchema>
export type AmountConstraint = z.infer<typeof AmountConstraintSchema>
export type TimingConstraint = z.infer<typeof TimingConstraintSchema>
export type InterestConstraint = z.infer<typeof InterestConstraintSchema>
export type FeeConstraint = z.infer<typeof FeeConstraintSchema>
export type Requirement = z.infer<typeof RequirementSchema>
export type SourceSpan = z.infer<typeof SourceSpanSchema>
export type ExtractedClause = z.infer<typeof ExtractedClauseSchema>
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>
