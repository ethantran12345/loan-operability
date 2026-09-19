# Loan Operability

A pre-signing compatibility test for loan agreements.

**Live demo:** https://loan-operability.vercel.app

**Source:** https://github.com/ethantran12345/loan-operability

Select a clause from a synthetic credit agreement. Nemotron turns the legal language
into structured operational requirements. A deterministic engine tests those
requirements against a fictional bank's versioned capability graph and returns
`PASS`, `MANUAL`, or `FAIL` — with the evidence behind the answer, a grounded
repair, and a re-test.

> **Nemotron understands the language. Our system owns the institution's verified
> operating state and deterministically proves whether a complete execution path
> exists.**

All bank data in this repository is synthetic. Nothing here describes any real
institution's operations, and nothing here is legal or financial advice.

## Status

| Phase | State |
|---|---|
| Domain types, capability graph, fixtures | done |
| Deterministic evaluator + path search | done, 65 tests green |
| Repair generator (`FAIL -> repair -> PASS`) | done |
| `/api/extract` (Nemotron, Zod-validated, fixture fallback) | done, verified against the live hosted NVIDIA endpoint |
| Review + Results routes | done |

## Team

- Ethan Tran — solo hacker — [ethantran1000@gmail.com](mailto:ethantran1000@gmail.com)

## Hackathon build provenance

This repository was created for SteelHacks XIII after hacking began at 11:00 AM
EDT on September 19, 2026. The first commit is timestamped September 19, 2026 at
1:33 PM EDT. The agreement, bank capability data, and operational evidence shown
in the demo are synthetic fixtures created for this project.

## Tools and AI disclosure

The project uses and credits the following tools:

- **NVIDIA Nemotron 3.5 Lightning 30B A3B** — runtime extraction of legal clauses
  into typed operational requirements. Nemotron does not issue the final verdict.
- **OpenAI Codex** and **Anthropic Claude** — development assistants used during
  the hackathon for implementation, debugging, testing, documentation, and review.
- **React, TypeScript, Vite, Zod, Vitest, Tailwind CSS, and Lucide** — application
  and testing libraries.
- **Vercel** — hosting and the server-side extraction function.

All final behavior is represented by the code and tests in this repository. The
deterministic evaluator—not an AI assistant—owns `PASS`, `MANUAL`, and `FAIL`.

```
npm test         # 96 tests
npm run typecheck
npm run build
npm run dev      # serves the app and /api/extract together
```

The app works fully with `NVIDIA_API_KEY` unset: `/api/extract` serves the cached
fixtures and the UI labels them as such. To try the live path, put
`NVIDIA_API_KEY=...` in `.env.local` (gitignored) and restart `npm run dev`.

## Live extraction, and what happens when it is slow

Extraction runs against NVIDIA's free hosted endpoint, which is queue-based. Measured
during the hackathon, an identical two-token request returned in either under a
second or more than twenty, always with HTTP 200. That is queue latency, not an
authentication, model or parameter problem, so the app is built around it:

- **Hedged calls.** If the first call is silent after 5 s a duplicate is launched,
  and another at 10 s. The first valid reply wins and the rest are aborted.
- **One 25 s budget** covers the whole extraction, retry included. Past it, the
  cached extraction is served with `x-extraction-fallback: timeout`.
- **Pre-warming.** The page requests every clause as the agreement renders, so
  the queue is waited out while the clause is being read.
- **Honest labels.** The badge says `Live Nemotron` only when this session's own
  call produced the requirements on screen. Anything else says `Cached fixture`,
  gives the reason, and offers to try the live call again.
- **Diagnostics.** `/api/extract` returns `x-extraction-source`,
  `x-extraction-fallback`, `x-extraction-attempts`, `x-extraction-calls` and
  `x-extraction-ms`, and logs one JSON line per request (never the key or the text).

The cached extractions in `src/fixtures/extractions.json` are recordings of real
replies from the configured Nemotron model that passed every check below.

### What a model reply has to survive

A reply is validated before the evaluator sees it. A rejected reply is sent back
once with the reason; a second rejection serves the cached extraction.

| Check | Why |
|---|---|
| Zod schema | The evaluator's input type and the model's output type are one definition. |
| Timezone named in the clause | A guessed zone would erase the headline finding. |
| Missing timezone listed as an ambiguity | An open question has to be reported, not just left null. |
| Notice contents stated in the clause | Customary fields filled in by the model would turn an unknown into a `PASS`. |
| Bank field names | `facility` is not `facility_id`; a near miss would read as a missing field. |
| Bank office names | `new_york_lending_office` is not `new_york`; a near miss would fail every path on an office the bank has. |
| Not hollow | A requirement that states nothing is not an extraction. |

## How a decision is made

```
clause text
  -> Nemotron extraction        (probabilistic, Zod-validated, cached fallback)
  -> Requirement[]              (typed, with ambiguities preserved)
  -> bounded path search        (every leg an operation needs, on ONE path)
  -> typed comparator registry  (14 comparators, each citing a capability)
  -> PASS / MANUAL / FAIL       (+ replay record)
  -> repair proposals           (values taken only from graph bounds)
  -> re-run the same tests
```

### Complete paths, not matching facts

An operation needs every leg before it counts as executable:

| Operation | Required legs |
|---|---|
| `receive_notice` | notice intake |
| `fund_draw` | notice intake, funding window, booking entity |
| `book_facility` | booking entity |
| `calculate_interest` | interest engine |
| `collect_fee` | fee engine |

Candidate paths are the cartesian product of the capabilities filling each leg.
This is why a EUR draw cannot borrow the USD window's higher ceiling: the currency
has to hold on the *same* path, and a EUR/Toronto pairing is not a path at all.

### Decision semantics

- `PASS` — at least one complete path satisfies every mandatory requirement.
- `MANUAL` — no path passes automatically, but a named human resolution could create one.
- `FAIL` — every candidate path violates at least one mandatory hard constraint.

A clause passes only if every mandatory requirement passes. The agreement result is
the most severe unresolved clause result. **Missing information returns `MANUAL`.
An unknown never becomes a `PASS`** — including a path no comparator could evaluate.

## Two decisions that diverge from the written spec

Both were made while building the evaluator, both are deliberate, and both change
what the demo shows.

### 1. A missing timezone is analysed, not just flagged

The spec said an unstated timezone returns `MANUAL`. That is right only when the
answer actually depends on the missing fact. The evaluator now tests the clause
against **every lending office it could be read against**:

- all readings meet the cutoff -> `PASS` (the omission is immaterial)
- all readings miss the cutoff -> `FAIL` (the ambiguity cannot rescue the clause)
- readings disagree -> `MANUAL` (the answer genuinely depends on the missing fact)

`11:00` with no timezone misses a `09:30 Europe/London` cutoff under London, New
York and Toronto readings alike, so it is a hard conflict rather than an open
question. Timezone offsets come from `Intl`, so DST is real rather than hardcoded.

### 2. Currency, settlement basis and delivery channel are path identity

These three fields decide *which path the clause is even about*. A clause promising
same-day EUR by email is not satisfied by a T-1 window, a USD window, or the
portal — those are **alternatives**, which is the repair step's job to propose.

Ranking candidate paths on raw conflict count alone made the engine report the
EUR 40M clause as a *currency* conflict against the USD window, which tells a
drafter nothing. Identity violations are now ranked ahead of conflict count, so the
FAIL reports the three conflicts a drafter can act on: amount, cutoff, booking
location.

## The benchmark clause

Section 2.03(c) is a fourth clause, built to show what reading the rulebook as
prose gets wrong. It asks for a same-day EUR 20,000,000 draw through the New York
Lending Office, with the notice delivered through the portal by 10:00 A.M. New York
time.

**The New York exception path.** The capability graph has a New York EUR same-day
exception window (`cap-013`: at most EUR 20M, cutoff 10:30 America/New_York,
requires `treasury` approval) and a New York EUR booking capability (`cap-027`).
Every constraint a reader could check against the rulebook text passes on that
path: currency, amount, increment, settlement basis, cutoff, booking entity,
channel, notice fields.

**The expired authority.** The exception is only legal while Treasury's authority
(`apr-021`) is in force, and in graph v7 that authority expired on 2026-08-31. The
engine returns `FAIL` with exactly one conflict. The decisive fact is a date held
in the capability graph. It appears nowhere in the rulebook text, so no amount of
language understanding applied to that text can recover it. The Results page
shows this from the engine's own checks: the rulebook-checkable constraints on
one side, the approval check and the authority's effective dates on the other. It
does not show, quote or imitate any model's answer.

**v7 vs v8.** The institution's state is a versioned input, not a constant. Graph
v7 (2026-09-09) is the baseline with the lapsed authority. Graph v8 (2026-09-15)
is identical except that Treasury renewed `apr-021`, effective 2026-09-15. The
version selector on Results re-runs the evaluator on the same extracted clause,
with no re-extraction and no model call, and the decision moves from `FAIL` to
`MANUAL` with owner `treasury`. Both replay records stay on screen: same
`requirement_bundle_hash`, different `capability_graph_version`, different
decision. The three original clauses decide the same way on both versions
(`src/domain/__tests__/benchmark.test.ts`).

**18 → 32 paths.** Candidate paths are a cartesian product, so the two new
capabilities widen the search for every `fund_draw` clause from 18 paths to 32.
The extra paths are searched and rejected for the original clauses, and their
decisions did not move.

## Repair proposals

The model may write the sentence. It may not invent the number. Every proposal is
derived from a bound already in the capability graph and carries the
`capability_id` it came from, so any suggested value traces back to the operating
procedure that authorises it (`src/domain/repair.ts`, and the
"never proposes a value the graph does not contain" test).

Where the only route is a human step — a manual authentication, an approval, stale
evidence — no proposal is offered and the reason is stated instead.

**The EUR 40M clause repairs to PASS with five changes, not three.** The three
conflicts (amount, cutoff, booking entity) plus the two gaps the clause left open
(delivery channel, required notice fields), because a `MANUAL` is not a `PASS`.

## Layout

```
src/domain/types.ts        domain model — Requirement vs Capability
src/domain/comparators.ts  14 typed comparators, the audit unit
src/domain/evaluate.ts     bounded path search + decision semantics
src/domain/repair.ts       grounded repair proposals + apply
src/domain/time.ts         Intl-based timezone normalisation
src/domain/sha256.ts       isomorphic hash for the replay record
src/domain/schema.ts       Zod schemas — the single source of truth for Requirement types
src/fixtures/              capability graph v7 and v8, agreement, cached extractions
src/lib/extract.ts         Nemotron call, hedging, one retry, output guards, fixture fallback
api/extract.ts             Vercel Function wrapping src/lib/extract.ts
src/routes/Review.tsx      select a clause, read and correct the extraction
src/routes/Results.tsx     verdict, conflicts, candidate paths, repair, re-test, proof
```

## Replay record

Every evaluation emits the inputs it was made against — agreement version, SHA-256
of the requirement bundle, capability graph version, evaluator version, transaction
time, every candidate path, the decisive conflicts, and the evidence ids. That
record is the difference between "the AI said no" and a decision that can be
reproduced and audited.
