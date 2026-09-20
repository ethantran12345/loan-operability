# Dryrun — dry-run the loan before you sign

A pre-signing compatibility test for loan agreements.

**Live demo:** https://loan-operability.vercel.app

**Source:** https://github.com/ethantran12345/loan-operability

An analyst adds a draft credit agreement. The fictional bank's four operating
policies are standing state the application already holds, and the bundled sample
agreement and the policies are all synthetic. The application reads the documents, Nemotron turns
the borrowing clauses into structured operational requirements, and a deterministic
engine tests them against a fictional bank's versioned capability registry. Each
clause returns `PASS`, `MANUAL`, or `FAIL`, with the agreement passage and the
policy passage behind every finding side by side, a grounded redraft, and a
re-test of the redrafted terms.

> **Nemotron understands the language. Our system owns the institution's verified
> operating state and deterministically proves whether a complete execution path
> exists.**

All bank data in this repository is synthetic. Nothing here describes any real
institution's operations, and nothing here is legal or financial advice.

![Dryrun flow: the analyst adds the draft agreement, Nemotron reads each clause, and the deterministic engine tests it against the bank's capability graph and returns a verdict with one of three answers](docs/flow-diagram.png)

*One clause, end to end: the model reads the clause, the graph decides whether the bank can do it.*

## Status

| Phase | State |
|---|---|
| Domain types, capability graph, fixtures | done |
| Deterministic evaluator + path search | done, 224 tests green across the repo |
| Repair generator (`FAIL -> repair -> PASS`) | done |
| `/api/extract` (Nemotron, Zod-validated, fixture fallback) | done, verified against the live hosted NVIDIA endpoint |
| Challenge mode (`/api/challenge`, grader) | server and grader done and tested; it has no screen in the app now |
| The app (`/`, `?v=7\|8`) | done: document intake, citation verification, findings with evidence, redraft and re-test, export record |

## The app (`/`)

One screen, and `/` is the only route. Any other path lands on it.

**Document intake.** The run starts from what the analyst hands over. The bank's
policies are standing state: the ones in force for the capabilities version are
loaded when the app opens, each listed by document id and version, and their
registry citations are already traced. The analyst adds only the draft agreement, by
dropping it, choosing the file, or loading the bundled sample, which is always
labelled as the sample. A file is identified by what its own front matter says it
is, never by its name. A file that cannot be read is refused with the reason, and
**Run dry run** stays disabled until an agreement is in and the packet reads.

**The run.** The agreement is on the left and one finding card per borrowing
clause is on the right. Every clause is asked for when Run is pressed, and the
requests to `/api/extract` leave 1.5 s apart, in the order the agreement states
the clauses. A card whose request has not left says so, and then counts its real
wait from when its own request left. When a response lands the card shows the
extracted terms, the number of bank routes the engine searched, a mark on each
term, and the verdict. The engine's work is already finished by then: only the
reveal is paced for reading, and the status line under the header says so and
adds up only what is already on screen. All four cards fit at 1440x760 with no
scrolling. **Export record** downloads the run as JSON: every file's SHA-256 and
where it came from, the capabilities version, and each clause's decision,
extraction source and replay record.

**Demo tools** holds four things and nothing else: the bank capabilities version
switch (v7 / v8), the chat packet (copy or download), **Try live again** per
clause, and the Nemotron call log. The call log has one entry per clause in the
order this session asked, with only the extraction result and what the server
measured of its own call. A cached clause made no call, and none is shown.

### What is actually read

`src/packet/` holds six text files: `credit-agreement.draft-7.md` (6 pages, 9
articles, 32 paragraphs), three operating procedures (notice intake, funding
windows and limits, booking entities) and the approvals register in two versions
(v3 for registry v7, v4 for registry v8). `src/documents/parse.ts` parses them at
runtime into document id, version, date, pages, sections and paragraphs. Every
paragraph keeps its exact text and its character offsets into the raw file, and
every file is identified by its SHA-256. The clause text sent to Nemotron is read
out of the parsed agreement, not out of a fixture. A test pins that text to the
text the cached extractions were recorded on.

**Supported input: one format**, "packet text format v1": UTF-8 `.md` with a
`key: value` front matter, `<!-- page N -->` markers, `#` articles, `## <id>
<title>` sections and `(a)` labelled paragraphs. The parser refuses anything else
with an error rather than guessing. **Not supported:** PDF, DOCX, scanned or image
documents (there is no OCR), tables, footnotes and nested sub-paragraphs. The same
six files are in `demo-packet/` for dropping into the intake. An agreement of your
own has to be in this format and carry the sections in review scope. If its clauses
read differently from the sample's, a cached extraction is labelled
`Cached · not this text`: only a live extraction describes that file.

**Review scope is configured, not discovered.** `src/fixtures/agreement.json`
names the four Article II borrowing clauses to extract and check. The other 28
paragraphs (definitions, interest, fees, repayment, defaults and so on) are read
and displayed and included in the chat packet, but they are not extracted or
evaluated.

### How policy evidence connects to the capability registry

The registry (`src/fixtures/capability-graph.v7.json`, `.v8.json`) is
hand-authored structured data. **It is not generated from the policy documents,
and the application does not claim to turn policy prose into rules.** What
`src/documents/citations.ts` does is verify the link, in one direction, every
time the packet is read:

1. **Resolve.** A capability cites a policy section by title
   (`evidence.section`, for example "EUR funding"). An approval is cited by the
   section whose title carries its id, for example "Treasury exception authority
   (apr-021)".
2. **Verify.** Each checked registry value is rendered the way a procedure
   writes it (`25000000` becomes "EUR 25,000,000", `09:30` becomes "9:30 A.M.",
   `Europe/London` becomes "London time", `2026-08-31` becomes "31 August 2026")
   and must appear verbatim in the cited section. Numbers may not match inside a
   longer number.
3. **Cite.** The matching character spans are kept, so a finding opens the
   passage with the supporting words highlighted.

On both registry versions 16 records verify (11 capabilities, 4 approvals, the
lending-office list) and 4 are reported as "not in packet": the interest and fee
engines cite procedures this packet does not include. Tests show that changing a
registry value, or pairing registry v7 with the v8 register, is reported as a
mismatch. Limits: a rule that is in a policy but missing from the registry is not
detected; capability effective dates and the `outcome` field are not text-verified.

### Findings, redraft and re-test

A finding leads with the outcome and the two values ("Same-day amount over the
bank's limit", agreement 40,000,000, bank up to 25,000,000). Opening it shows the
agreement passage and the policy passage side by side, and "Open the procedure"
opens the policy in the document pane with the supporting words highlighted. An
approval finding cites two passages: the procedure that demands the approval, then
the register entry that says whether the authority is in force. A term the clause
never states is shown as not stated, with nothing highlighted.

Every finding answers "what do I do about this" in one of three ways. A **redraft**
shows the proposed wording against the clause's own, and **Apply and re-test** runs
the same deterministic evaluation on the redrafted terms. **The re-test is a demo
interaction held in the browser. It is not sign-off, contract approval or a durable
audit record**: the agreement file is unchanged and the agreement's own result does
not move when a re-test passes. A finding that turns on **the bank's state** (a
lapsed approval authority) offers no redraft, because no wording touches it; it
shows what the other capabilities version decides for the same terms. A finding
that needs **a person** names the step, its owner and the time the bank allows.

Switching the capabilities version swaps the approvals register in force,
re-verifies citations and re-runs the checks on the same extracted terms with no
model call. **Copy chat packet** produces one text with the question, the
transaction date, all five documents and the registry JSON, and no verdict, so a
chat model can be given the same inputs. See `docs/comparison-video.md`.

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
npm test         # 224 tests
npm run typecheck
npm run build
npm run dev      # serves the app, /api/extract and /api/challenge together
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
- **Spaced requests.** The free tier answers a burst of four with HTTP 429, so the
  browser lets requests to `/api/extract` leave 1.5 s apart. The browser's own time
  limit starts when a request leaves, not when Run is pressed.
- **Honest labels.** The badge says `Live Nemotron` only when this session's own
  call produced the requirements on screen. Anything else says `Cached`, the call
  log gives the reason, and Demo tools offers to try the live call again.
- **Diagnostics.** `/api/extract` returns `x-extraction-source`,
  `x-extraction-fallback`, `x-extraction-attempts`, `x-extraction-calls`,
  `x-extraction-ms` and `x-extraction-rejection` (the reason a first reply was
  rejected before the retry), and logs one JSON line per request (never the key or
  the text). The Nemotron call log in Demo tools shows these values as measured.

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
| "Any Lending Office" stated in the clause | A named office read as every office would be failed on worst-case analysis across all of them. |
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

## Model access (decided 2026-09-20)

Nemotron is reached through NVIDIA's hosted API and nothing else:

- Endpoint `https://integrate.api.nvidia.com/v1/chat/completions`, model
  `nvidia/nemotron-3.5-lightning-30b-a3b` (overridable with `NEMOTRON_MODEL`).
- The key lives only in the gitignored `.env.local` and the `loan-operability`
  Vercel project. It is never sent to the client, logged, committed, or
  screenshotted.
- Architecture stays `Vercel /api/extract -> hosted Nemotron -> Zod -> evaluator`.

The fallback is labelled and never relabelled: a valid hosted response is
**Live Nemotron**; a timeout, upstream error, missing key, or invalid output is
**Cached**, visibly. The free hosted tier is intermittent (a successful
production extraction has taken ~7 s; others exceed the budget), which the
labels and the spaced requests absorb.

Brev GPU credit exists and could self-host a Nemotron NIM as a reliability
backup. It is not the default path and the app is not migrated to it unless
hosted congestion becomes severe enough to justify the setup time.

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
in the capability graph. In the document packet the same date is written in the
approvals register (MCB-POL-007), and the chat packet includes it, so a reader or
a model given the packet can find it too. The finding card
shows this from the engine's own checks: every term the rulebook can check carries
a pass mark, and the one failing check is the approval, with the authority's expiry
date and the register entry that records it. It does not show, quote or imitate any
model's answer.

**v7 vs v8.** The institution's state is a versioned input, not a constant. Graph
v7 (2026-09-09) is the baseline with the lapsed authority. Graph v8 (2026-09-15)
is identical except that Treasury renewed `apr-021`, effective 2026-09-15. The
version switch, in Demo tools and on the finding itself, re-runs the evaluator on
the same extracted clause, with no re-extraction and no model call, and the
decision moves from `FAIL` to `MANUAL` with owner `treasury`. The exported records
differ the same way: same `requirement_bundle_hash`, different
`capability_graph_version`, different decision. The three original clauses decide
the same way on both versions
(`src/domain/__tests__/benchmark.test.ts`).

**18 → 32 paths.** Candidate paths are a cartesian product, so the two new
capabilities widen the search for every `fund_draw` clause from 18 paths to 32.
The extra paths are searched and rejected for the original clauses, and their
decisions did not move.

## Challenge mode

**Check the model's work.** Challenge mode has no screen in the app now: its panel
was removed when the app became one screen. The server route, the
grader, the recorded responses and their tests are in the repository and described
here. The same clause and the same
capability-graph file are given to the same model with no engine, and the engine
then grades the answer. The claim is about method, not intelligence: the model
may well reach the right verdict, and when it does the scorecard says "Agrees
with the engine" in plain words. What a direct answer cannot do is prove it
searched every path, use only the bank's real bounds, refuse to guess, or give
the same answer twice.

**What is sent.** `buildChallengeBundle` (`src/domain/challenge.ts`) produces the
instructions, the clause text, the transaction time and the complete capability
graph JSON, the same file the engine reads. `/api/challenge` sends exactly that
as one user message, to the same NVIDIA endpoint and model as extraction, at
temperature 0 exactly as extraction uses, twice in parallel. The temperature is
not raised to manufacture drift: if the runs agree, the scorecard says so.

**How it is graded.** `gradeChallenge` is pure and never reads the model's prose
for the numbers it reports:

- verdict, against the engine's decision for the same clause and graph version;
- the paths the model listed, against the engine's exhaustive set of complete
  paths (32 on either graph), with the reason each non-path is not a path;
- its verdict on each real path, against the engine's verdict on that path;
- every number, cutoff and office in its proposed fix, against the values the
  graph actually contains;
- assumptions it declared, plus any the grader detects (a timezone read into a
  clause that states none), beside the unknowns the engine carried without guessing;
- run-to-run consistency, beside the engine's requirement hash, which is
  identical by construction.

**No model answer is ever fabricated.** Each reply is parsed with the same
tolerant JSON parser as extraction and validated against `ModelAnswerSchema`,
with one retry that feeds the error back. A run that still fails is dropped. If
no run succeeds the route returns `{ source: 'unavailable', reason }` and there
is no scorecard. The only fallback is
`src/fixtures/challenge-recorded.json`: real responses recorded from real calls,
each with `recorded_at`, model, `clause_id` and `graph_version`, served with
`source: 'recorded'` and its timestamp, and only when the live call
fails for that same clause and graph version.

**Timing.** Reading the whole graph and listing paths is a ~1,500-token reply.
The hosted endpoint produced it in 31 to 65 s when it answered at all, and now
and then not within two minutes, so the route uses extraction's budget
pattern (one budget per run, retry included) at 90 s rather than 25 s, inside a
120 s function. It launches no hedged duplicates, because concurrent
calls on one key starve each other here: 39 s alone, 133 s beside a twin. For the
same reason the client (`src/lib/challengeClient.ts`) asks for its two runs in
turn, one per request.
`/api/challenge` returns `x-challenge-source`, `x-challenge-runs`,
`x-challenge-calls` and `x-challenge-ms`, and logs one JSON line per request
(never the key or the reply).

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
src/domain/challenge.ts    challenge mode: the bundle sent to the model, its answer schema, the grader
src/lib/challenge.ts       parallel model runs, one retry each, recorded-only fallback
api/challenge.ts           Vercel Function wrapping src/lib/challenge.ts
src/packet/                the synthetic document packet: agreement and policies, as text
src/documents/parse.ts     packet text format v1 parser: ids, versions, pages, exact offsets
src/documents/packet.ts    which files make up the packet for each registry version
src/documents/intake.ts    document intake: the files handed over, checked; the standing policies in force
src/documents/citations.ts registry-to-policy citation verifier, evidence passages per check
src/documents/locate.ts    where a clause states a term; a proposed redraft against the clause's wording
src/documents/bundle.ts    the chat packet for the comparison video
src/lib/challengeClient.ts browser client for /api/challenge: two runs, asked for in turn
src/lib/useAgreementReview.ts  read, extract, check: the run's real operations
src/lib/extractClient.ts   browser client for /api/extract: spaced requests, honest labels, fixture fallback
src/lib/callLog.ts         the Nemotron call log: only measured values, and no call shown where none was made
src/lib/resolution.ts      what to do about a finding: a redraft, the bank's state, or a person
src/routes/Dryrun.tsx      the app: intake, the run, the findings, export record
src/components/dryrun/     intake panel, agreement pane, finding cards, Demo tools, reveal pacing
src/components/workspace/  the document viewer, text marking and file rows the app reads documents with
src/components/run/        path-search grid, elapsed counter and typewriter used by the finding cards
src/lib/runFormat.ts       pure formatting: field rows, record lines, status-line times
demo-packet/               the same six synthetic files, for dropping into the intake
```

## Replay record

Every evaluation emits the inputs it was made against — agreement version, SHA-256
of the requirement bundle, capability graph version, evaluator version, transaction
time, every candidate path, the decisive conflicts, and the evidence ids. That
record is the difference between "the AI said no" and a decision that can be
reproduced and audited.
