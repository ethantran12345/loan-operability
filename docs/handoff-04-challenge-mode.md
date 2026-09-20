# Handoff 04 — challenge mode: check the model's work

Commit on `dev`, no branch, no PR. Timebox: 2 hours. This is additive — a new
API route and a new panel behind a flag. The existing four-clause demo must not
change. If it is not green and deployed at 2h, revert the UI/API commits; the
domain layer below stays.

## What already landed (do not redo)

`src/domain/challenge.ts` + 19 tests (131/131 green):

- `ModelAnswerSchema` — the JSON a general model must reply with.
- `buildChallengeBundle(clause, graph, txTime)` — the exact files sent to the
  model: clause text, transaction time, the FULL capability graph JSON, and the
  instruction text. Same file the engine reads. Use it verbatim; do not write a
  second prompt.
- `gradeChallenge(answers, clause, result, graph, engineHash)` — the scorecard.
  Pure. Grades verdict agreement, path enumeration against the real 32, invented
  or incomplete paths, ungrounded values in the proposed fix, assumptions about
  facts the clause does not state, and run-to-run consistency.

Read the file header before building. The framing matters: **the claim is never
"the model is wrong."** The engine is a referee, and every line on the scorecard
is derived from the graph and the evaluator, not from prose.

## Task 1 — `api/challenge.ts`

POST `{ clause_id, graph_version: 7 | 8, runs?: number }` (default `runs: 2`, max 3).

1. Load the clause text from `agreement.json` and the graph from
   `capabilityGraphs[graph_version]`. Build the bundle with
   `buildChallengeBundle`. The user message is
   `bundle.instructions + "\n\nCLAUSE:\n" + clause_text + "\n\nCAPABILITY_GRAPH:\n" + JSON.stringify(graph)`.
2. Fire `runs` calls to the same NVIDIA endpoint and model as extraction, **in
   parallel**, same 25 s budget pattern, **temperature 0 exactly as extraction
   uses**. Do not raise temperature to manufacture drift. If the runs agree, the
   scorecard says so; that is the honest result.
3. Parse each reply with the existing tolerant JSON parser, then
   `ModelAnswerSchema.safeParse`. One retry per run on parse failure, feeding
   the Zod error back. A run that still fails is dropped, not faked.
4. Return `{ model, source: 'live', answers: ModelAnswer[], raw: string[], latency_ms: number[], bundle }`.
   If zero runs succeed, return `{ source: 'unavailable', reason }`.
5. **No cached fallback for this route by default.** A fabricated model answer
   would poison the whole panel. The only permitted fallback is
   `src/fixtures/challenge-recorded.json`: a REAL response you record during
   verification, with `recorded_at` ISO timestamp, model, clause_id and
   graph_version. Serve it with `source: 'recorded'` only when live fails.
6. Same header/log-line diagnostics as extract. Never log the API key.

Tests (mocked fetch): two good runs; one good + one unparseable-twice → one
answer; both fail → `unavailable`; `recorded` served with its timestamp.

## Task 2 — the panel on Results

Behind `VITE_CHALLENGE_MODE` (default on; `"off"` hides the panel entirely —
this is the kill switch if it misbehaves on the day).

Placement: after the verdict block and the v7/v8 control, before "Contract
requires, bank supports". Title: **Check the model's work.** Subtitle: "The
same clause and the same capability-graph file, given to the same model with
no engine. Then the engine grades the answer."

- Button **Run challenge** (do not pre-warm all four clauses; pre-warm only the
  clause currently on Results, and only after its own extraction is on screen).
  Re-run when the graph version changes.
- Two columns.
  **Left — The model's answer, verbatim.** Badge with `source` (`Live · nvidia/…`
  or `Recorded 2026-09-20 14:02`). Verdict, reasoning, the paths it listed with
  its own verdicts, its conflicts, its proposed fix, its declared assumptions.
  Show raw JSON behind a disclosure. Never edit or summarise it.
  **Right — The engine's grade.** One row per scorecard line, from
  `gradeChallenge(answers, extractedClause, requirementResult, graph, replay.requirement_bundle_hash)`:
  - Verdict: `agrees` → neutral green "Agrees with the engine (FAIL)". Not a failure. Say it plainly.
  - Paths: "Named 3 of 32 complete paths · 1 real · 2 not paths" then each `not_real` with its reason.
  - Verdict mismatches on real paths, if any.
  - Fix: "2 of 3 proposed values are not in the capability graph" then each `ungrounded` with its reason.
  - Assumptions: declared items + `detected` items, against "Engine carried N unknowns without guessing".
  - Reproducibility: "2 runs · 1 verdict · 2 conflict sets" beside "Engine hash `sha256:…` identical by construction".
- Footer, always visible: **"The model may well reach the right verdict. What it
  cannot do is prove it searched every path, use only the bank's real bounds,
  refuse to guess, or give the same answer twice. Those are properties of the
  method, not the model."**
- Disclosure: **Files sent to the model** — render `bundle` (instructions,
  clause, and the graph JSON) so a judge can see the model got everything.
- If `source === 'unavailable'`: one calm line, no scorecard, no empty columns.

## Task 3 — README

Section "Challenge mode" — what is sent, how it is graded, that the claim is
about method not intelligence, that no model answer is ever fabricated, and
the `VITE_CHALLENGE_MODE=off` switch. Fix the stale "65 tests" line while there.

## Do not

- Change `src/domain/` except appended tests.
- Touch the extraction prompt, guards, or fallback.
- Write any pre-authored "model answer". Recorded means recorded from a real call.
- Pre-warm the challenge for clauses not on screen (it is two model calls each).

## Done criteria

- `npm test` ≥ 131 green; typecheck and build clean.
- On production, clause 2.03(a) v7: Run challenge → left column shows a real
  model answer with a Live badge, right column shows every scorecard line with
  numbers derived from the grade, files disclosure renders the graph.
- Clause 2.03(c) v7 and v8 both run; the grade reflects each version.
- `VITE_CHALLENGE_MODE=off` hides the panel and nothing else changes.
- The four-clause demo, repair loop and v7/v8 switch behave exactly as before.
