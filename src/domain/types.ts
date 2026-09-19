// Domain types. Two worlds meet here:
//   Requirement = what the contract obligates the institution to deliver (probabilistic, from Nemotron).
//   Capability  = a verified path describing how the institution can deliver it (deterministic, versioned).
// The evaluator never mixes them: extraction produces Requirements, the graph owns Capabilities.

// The Requirement side of the model is defined ONCE, as Zod schemas in schema.ts,
// because it is the side that arrives from a model and has to be validated. The
// types below are inferred from those schemas and re-exported here so the rest of
// the domain keeps importing from './types'.
export type {
  Decision,
  Operation,
  ClauseType,
  Settlement,
  NoticeChannel,
  AmountOperator,
  AmountConstraint,
  TimingConstraint,
  InterestConstraint,
  FeeConstraint,
  Requirement,
  SourceSpan,
  ExtractedClause,
} from './schema'

import type {
  ClauseType,
  Decision,
  NoticeChannel,
  Operation,
  Settlement,
} from './schema'

/** The role a capability plays in a complete operating path. */
export type PathRole =
  | 'notice_intake'
  | 'funding_window'
  | 'booking_entity'
  | 'interest_engine'
  | 'fee_engine'

// ---------------------------------------------------------------- capabilities

export interface CapabilityConstraints {
  currency?: string[]
  settlement?: Settlement
  max_amount?: number
  amount_increment?: number
  cutoff?: string
  timezone?: string
  booking_entity?: string[]
  notice_channel?: NoticeChannel[]
  required_fields?: string[]
  notice_lead_business_days?: number
  benchmark?: string[]
  method?: string[]
  day_count?: string[]
  max_observation_shift_days?: number
  allowed_floor_bps?: number[]
  fee_basis?: string[]
  max_fee_recipients?: number
  max_fee_currencies?: number
  /** Fastest the bank can actually complete this path, in business days. */
  min_service_level_business_days?: number
}

export interface ManualPath {
  owner: string
  sla_business_days: number
  description: string
}

export interface Evidence {
  source: string
  section: string
  last_verified: string
}

export interface Capability {
  capability_id: string
  role: PathRole
  operation: Operation
  product: string
  label: string
  constraints: CapabilityConstraints
  outcome: 'supported' | 'manual' | 'unsupported'
  manual_path: ManualPath | null
  requires_approval: string[] | null
  effective_from: string
  effective_to: string | null
  evidence: Evidence
}

export interface Approval {
  approval_id: string
  role: string
  /** Largest amount this role may authorise. */
  threshold: number
  effective_from: string
  effective_to: string | null
  /** True when the same person requests and approves — never sufficient on its own. */
  self_approval: boolean
}

export interface CapabilityGraph {
  version: number
  institution: string
  disclaimer: string
  /** Offices the agreement's "any lending office" could mean. Drives worst-case cutoff analysis. */
  lending_offices: { entity: string; timezone: string }[]
  /** Evidence older than this is stale and cannot silently authorise a PASS. */
  evidence_freshness_days: number
  capabilities: Capability[]
  approvals: Approval[]
}

// ---------------------------------------------------------------- results

export interface Conflict {
  field: string
  required: string
  supported: string
  reason: string
  capability_id: string
}

export interface ManualFlag {
  field: string
  reason: string
  owner: string
  sla_business_days: number | null
  capability_id: string
}

export interface Unknown {
  field: string
  reason: string
}

/** One comparator firing against one capability. The audit unit. */
export interface CheckResult {
  field: string
  verdict: Decision
  required: string
  supported: string
  reason: string
  capability_id: string
  owner?: string
  sla_business_days?: number | null
}

export interface CandidatePath {
  path_id: string
  /** capability_id per role, in traversal order. */
  legs: { role: PathRole; capability_id: string; label: string }[]
  decision: Decision
  checks: CheckResult[]
  complete: boolean
  incomplete_reason?: string
}

export interface RequirementResult {
  requirement_id: string
  decision: Decision
  mandatory: boolean
  selected_path_id: string | null
  matched_capabilities: string[]
  conflicts: Conflict[]
  manual_flags: ManualFlag[]
  unknowns: Unknown[]
  manual_owner: string | null
  candidate_paths: CandidatePath[]
  suggested_alternative: string | null
}

export interface ClauseResult {
  clause_id: string
  clause_type: ClauseType
  decision: Decision
  requirement_results: RequirementResult[]
  suggested_alternative: string | null
}

export interface ReplayRecord {
  agreement_version: string
  requirement_bundle_hash: string
  capability_graph_version: number
  evaluator_version: string
  transaction_time: string
  candidate_paths: string[]
  selected_path: string | null
  decision: Decision
  decisive_conflicts: string[]
  evidence_ids: string[]
}

export interface EvaluationReport {
  decision: Decision
  clause_results: ClauseResult[]
  replay: ReplayRecord
}
