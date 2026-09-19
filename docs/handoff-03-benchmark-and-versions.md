# Handoff 03 — benchmark clause + graph versions

Commit on `dev`, no branch, no PR. Timebox: 90 minutes. If the UI is not green
and deployed by then, revert the UI commits only. The data and tests below are
already green (112/112) and stay.

## What already landed (do not redo)

- `src/fixtures/capability-graph.v7.json`: two new capabilities and one approval.
  `cap-013` New York EUR same-day exception window (max EUR 20M, cutoff 10:30
  America/New_York, requires `treasury` approval). `cap-027` New York EUR booking.
  `apr-021` treasury authority, **expired 2026-08-31**. A `changelog` array.
- `src/fixtures/capability-graph.v8.json`: identical except `apr-021` renewed,
  effective 2026-09-15. `changelog` says so.
- `src/domain/fixtures.ts` exports `capabilityGraphV8` and
  `capabilityGraphs: Record<number, CapabilityGraph>` (keys 7 and 8).
  `AgreementClause` has an optional `benchmark?: boolean`.
- `src/fixtures/agreement.json`: fourth clause `credit-agreement-2.03-c`,
  `scenario: "FAIL"`, `benchmark: true`. Cached extraction added.
- `src/domain/__tests__/benchmark.test.ts`: proves v7 → FAIL on the New York
  path with exactly one conflict (expired authority), v8 → MANUAL with owner
  `treasury`, and that the three original scenarios did not move.

Consequence you must absorb: `fund_draw` now searches **32** paths, not 18.
Anything in the UI or copy that says 18 is now wrong.

## Task 1 — clause 4 renders and pre-warms

Review must list all four clauses from `agreement.clauses`. The pre-warm loop
must cover four, not three. Mark the benchmark clause visually (a small
"benchmark" tag next to the headline) and give it a one-line caption:

> Read as prose against the rulebook, New York supports this draw with a
> Treasury exception. The decisive fact is a date.

## Task 2 — graph version selector on Results

A segmented control: **v7 (2026-09-09)** / **v8 (2026-09-15)**. Default v7.
Switching re-runs `evaluate` against `capabilityGraphs[n]` with the SAME
extracted clause — no re-extraction, no model call. Show the graph's `changelog`
entry for the selected version next to the control, so the judge reads what
changed in the bank.

When the verdict changes across versions, keep both replay records visible
(you already do this for repair) and highlight `capability_graph_version` in
each. That is the proof: same requirement hash, different graph version,
different decision.

## Task 3 — the benchmark panel (honest version)

On Results for the benchmark clause only, above the path list, a two-column
card titled **What the rulebook reads like vs. what the institution knows**.

Left column: the selected path's checks with `field !== 'approval'`, each
rendered as PASS. Caption: "Every constraint a reader can check from the
rulebook passes."

Right column: the `approval` check, rendered as FAIL, with `apr-021`'s
`effective_to` date shown. Caption: "The authority that makes this path legal
expired 2026-08-31. That date is in the capability graph, not in the rulebook
text."

**Do not fabricate an LLM answer.** Do not write "ChatGPT says …". The claim
is that language understanding alone is insufficient, and the panel proves it
from the engine's own checks.

Under the card: "See what changes when the bank renews the authority →" which
switches the version selector to v8.

## Task 4 — README

Add a section "The benchmark clause" explaining the New York exception path,
the expired authority, v7 vs v8, and the 18 → 32 path count. Keep the existing
"Two decisions that diverge from the written spec" section as is.

## Do not

- Change anything under `src/domain/` except by appending tests.
- Touch the extraction prompt. Clause 4's live extraction may or may not come
  back clean; the fixture fallback is designed to carry it and is labelled.
- Add a fifth clause, a graph editor, or a v9.

## Done criteria

- `npm test` ≥ 112 green, `npm run typecheck` and `npm run build` clean.
- In a real browser on production: clause 4 → FAIL (v7) → switch to v8 → MANUAL,
  owner treasury, no re-extraction. Clause 1 still FAIL with three conflicts,
  repairs to PASS. Clause 2 MANUAL. Clause 3 PASS.
- Path count reads 32 wherever it is shown.
