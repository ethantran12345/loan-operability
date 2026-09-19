/**
 * Deterministic evaluator.
 *
 * Given requirements compiled from the agreement and a versioned capability
 * graph, decide whether a COMPLETE operating path exists. The search is a
 * bounded cartesian traversal over the roles an operation requires, because the
 * institution's real constraint is that every leg has to line up on the same
 * path: an EUR funding window paired with a Toronto booking entity is not a
 * path, it is two capabilities that cannot be used together.
 */

import { COMPARATORS } from './comparators'
import { sha256Hex } from './sha256'
import { isEffectiveAt } from './time'
import type {
  CandidatePath,
  Capability,
  CapabilityGraph,
  CheckResult,
  ClauseResult,
  Conflict,
  Decision,
  EvaluationReport,
  ExtractedClause,
  ManualFlag,
  Operation,
  PathRole,
  Requirement,
  RequirementResult,
  Unknown,
} from './types'

export const EVALUATOR_VERSION = '0.1.0'

/** Every leg an operation needs before a path counts as complete. */
const REQUIRED_ROLES: Record<Operation, PathRole[]> = {
  receive_notice: ['notice_intake'],
  fund_draw: ['notice_intake', 'funding_window', 'booking_entity'],
  book_facility: ['booking_entity'],
  calculate_interest: ['interest_engine'],
  collect_fee: ['fee_engine'],
}

const SEVERITY: Record<Decision, number> = { PASS: 0, MANUAL: 1, FAIL: 2 }

export const mostSevere = (decisions: Decision[]): Decision =>
  decisions.reduce<Decision>((worst, d) => (SEVERITY[d] > SEVERITY[worst] ? d : worst), 'PASS')

export const leastSevere = (decisions: Decision[]): Decision =>
  decisions.reduce<Decision>((best, d) => (SEVERITY[d] < SEVERITY[best] ? d : best), 'FAIL')

function cartesian<T>(groups: T[][]): T[][] {
  return groups.reduce<T[][]>((acc, group) => acc.flatMap((path) => group.map((g) => [...path, g])), [[]])
}

function verdictOf(checks: CheckResult[]): Decision {
  // Unknown never becomes PASS: a path nothing could evaluate is not a proven path.
  if (checks.length === 0) return 'MANUAL'
  return mostSevere(checks.map((c) => c.verdict))
}

/**
 * Candidate legs for one role.
 *
 * Settlement basis is part of the requirement's identity, not a negotiable leg:
 * a clause that promises same-day funding is not satisfied by a T-1 window, so a
 * T-1 window is not a candidate path for it — it is an ALTERNATIVE, which is the
 * repair step's job to propose. Pruning here keeps the conflict set honest
 * (amount, cutoff, entity) instead of burying it under "we could do T-1".
 *
 * The prune never manufactures an incomplete path: if it would empty the role,
 * every capability is reconsidered so the mismatch surfaces as a real conflict.
 */
function candidatesForRole(
  role: PathRole,
  req: Requirement,
  effective: Capability[],
): Capability[] {
  const all = effective.filter((c) => c.role === role)
  const settlement = req.timing?.settlement
  if (role !== 'funding_window' || !settlement || settlement === 'unspecified') return all
  const matching = all.filter(
    (c) => c.constraints.settlement === undefined || c.constraints.settlement === settlement,
  )
  return matching.length > 0 ? matching : all
}

/** Evaluate one requirement against the graph by searching complete paths. */
export function evaluateRequirement(
  req: Requirement,
  graph: CapabilityGraph,
  txTime: string,
): RequirementResult {
  const roles = REQUIRED_ROLES[req.operation]
  const effective = graph.capabilities.filter((c) =>
    isEffectiveAt(c.effective_from, c.effective_to, txTime),
  )

  const groups: Capability[][] = roles.map((role) => candidatesForRole(role, req, effective))
  const emptyRoleIndex = groups.findIndex((g) => g.length === 0)

  if (emptyRoleIndex >= 0) {
    const missingRole = roles[emptyRoleIndex]!
    const conflict: Conflict = {
      field: `path.${missingRole}`,
      required: `a ${missingRole.replace(/_/g, ' ')} effective at the transaction time`,
      supported: 'none',
      reason: `No capability provides the ${missingRole.replace(/_/g, ' ')} leg, so no complete path exists`,
      capability_id: '-',
    }
    return {
      requirement_id: req.requirement_id,
      decision: 'FAIL',
      mandatory: req.mandatory,
      selected_path_id: 'incomplete',
      matched_capabilities: [],
      conflicts: [conflict],
      manual_flags: [],
      unknowns: [],
      manual_owner: null,
      candidate_paths: [
        {
          path_id: 'incomplete',
          legs: [],
          decision: 'FAIL',
          checks: [],
          complete: false,
          incomplete_reason: conflict.reason,
        },
      ],
      suggested_alternative: null,
    }
  }

  const paths: CandidatePath[] = cartesian(groups).map((combo) => {
    const checks = combo.flatMap((cap) =>
      COMPARATORS.flatMap(({ run }) => run(req, cap, graph, txTime)),
    )
    return {
      path_id: combo.map((c) => c.capability_id).join('+'),
      legs: combo.map((c, i) => ({ role: roles[i]!, capability_id: c.capability_id, label: c.label })),
      decision: verdictOf(checks),
      checks,
      complete: true,
    }
  })

  const decision = leastSevere(paths.map((p) => p.decision))

  // Pick the path that justifies the decision. A conflict report is only
  // actionable if it is against the path the transaction would actually use, so
  // identity violations are ranked ahead of raw conflict count: a EUR draw
  // reported as "wrong currency" against a USD window tells the drafter nothing.
  const eligible = paths.filter((p) => p.decision === decision)
  const selected = [...eligible].sort(rankPaths)[0]!

  const conflicts: Conflict[] = selected.checks
    .filter((c) => c.verdict === 'FAIL')
    .map((c) => ({
      field: c.field,
      required: c.required,
      supported: c.supported,
      reason: c.reason,
      capability_id: c.capability_id,
    }))

  const manual_flags: ManualFlag[] = selected.checks
    .filter((c) => c.verdict === 'MANUAL' && c.field !== 'evidence.freshness')
    .map((c) => ({
      field: c.field,
      reason: c.reason,
      owner: c.owner ?? 'loan operations',
      sla_business_days: c.sla_business_days ?? null,
      capability_id: c.capability_id,
    }))

  const unknowns: Unknown[] = [
    ...req.ambiguities.map((a) => ({ field: 'extraction', reason: a })),
    ...selected.checks
      .filter((c) => c.verdict === 'MANUAL' && c.field === 'evidence.freshness')
      .map((c) => ({ field: c.field, reason: c.reason })),
  ]

  return {
    requirement_id: req.requirement_id,
    decision,
    mandatory: req.mandatory,
    // The path the decision was reported against, including on a FAIL: conflicts
    // only mean something relative to the path they were measured on, and the
    // repair step needs that path to know which bounds to draft toward. The
    // replay record still shows selected_path null on a FAIL, because no path
    // was actually selected for execution.
    selected_path_id: selected.path_id,
    matched_capabilities: selected.legs.map((l) => l.capability_id),
    conflicts,
    manual_flags,
    unknowns,
    manual_owner: manual_flags[0]?.owner ?? null,
    candidate_paths: paths,
    suggested_alternative: null,
  }
}

/**
 * Fields that define which path the transaction is even about. A clause naming
 * EUR, same-day settlement, or email delivery is not "about" the USD window, the
 * T-1 window, or the portal — reporting those mismatches as the headline conflict
 * would tell the drafter nothing they can act on.
 */
const IDENTITY_FIELDS = new Set(['currency', 'timing.settlement', 'notice_channel'])

const countChecks = (p: CandidatePath, verdict: Decision, identityOnly = false) =>
  p.checks.filter(
    (c) => c.verdict === verdict && (!identityOnly || IDENTITY_FIELDS.has(c.field)),
  ).length

/** Total order over candidate paths. Deterministic: ties break on path_id. */
function rankPaths(a: CandidatePath, b: CandidatePath): number {
  return (
    countChecks(a, 'FAIL', true) - countChecks(b, 'FAIL', true) ||
    countChecks(a, 'FAIL') - countChecks(b, 'FAIL') ||
    countChecks(a, 'MANUAL') - countChecks(b, 'MANUAL') ||
    countChecks(b, 'PASS') - countChecks(a, 'PASS') ||
    a.path_id.localeCompare(b.path_id)
  )
}

export function evaluateClause(
  clause: ExtractedClause,
  graph: CapabilityGraph,
  txTime: string,
): ClauseResult {
  const requirement_results = clause.requirements.map((r) => evaluateRequirement(r, graph, txTime))

  // A clause passes only if every MANDATORY requirement passes. A non-mandatory
  // requirement can raise the clause to MANUAL but never to FAIL on its own.
  const mandatory = requirement_results.filter((r) => r.mandatory)
  const optional = requirement_results.filter((r) => !r.mandatory)
  const decision = mostSevere([
    ...mandatory.map((r) => r.decision),
    ...optional.map((r): Decision => (r.decision === 'FAIL' ? 'MANUAL' : r.decision)),
  ])

  return {
    clause_id: clause.clause_id,
    clause_type: clause.clause_type,
    decision,
    requirement_results,
    suggested_alternative: null,
  }
}

export function evaluate(
  clauses: ExtractedClause[],
  graph: CapabilityGraph,
  txTime: string,
  agreementVersion = 'draft-7',
): EvaluationReport {
  const clause_results = clauses.map((c) => evaluateClause(c, graph, txTime))
  const decision = mostSevere(clause_results.map((c) => c.decision))

  const allRequirements = clauses.flatMap((c) => c.requirements)
  const allResults = clause_results.flatMap((c) => c.requirement_results)

  const replay = {
    agreement_version: agreementVersion,
    requirement_bundle_hash: `sha256:${sha256Hex(JSON.stringify(allRequirements))}`,
    capability_graph_version: graph.version,
    evaluator_version: EVALUATOR_VERSION,
    transaction_time: txTime,
    candidate_paths: [...new Set(allResults.flatMap((r) => r.candidate_paths.map((p) => p.path_id)))],
    selected_path:
      decision !== 'FAIL' && allResults.length === 1 ? allResults[0]!.selected_path_id : null,
    decision,
    decisive_conflicts: [...new Set(allResults.flatMap((r) => r.conflicts.map((c) => c.field)))],
    evidence_ids: [
      ...new Set([
        ...clauses.map((c) => c.clause_id),
        ...allResults.flatMap((r) => r.matched_capabilities),
        ...allResults.flatMap((r) => r.conflicts.map((c) => c.capability_id)),
      ]),
    ].filter((id) => id !== '-'),
  }

  return { decision, clause_results, replay }
}
