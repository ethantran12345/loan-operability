# Handoff 05 — the process view (`/run`)

Commit on `dev`, no branch, no PR. **Hard timebox: 3 hours, then stop whatever
state it is in.** This is a NEW route. Review and Results do not change. If
`/run` is not solid at the timebox, leave it unlinked and it costs nothing.

Deadline context: submission is 11:00 Sunday. Ethan will record a video from
this route. Every design choice below serves a 16:9 screen recording that a
viewer follows without narration.

## What it is

A single page that plays the whole pipeline for one clause as a vertical
sequence of stages, each one becoming active, doing visible work, then
collapsing to a one-line summary. Every frame is real engine output; the only
thing added is pacing. A persistent status line keeps that honest:

> Engine compute this run: 0.9 ms · Model call: 18.4 s · Paced for viewing —
> every value on screen is real output.

Measure engine time with `performance.now()` around `evaluate()`. Never
display a made-up number.

## Route and controls

`/run/:clauseId?v=7|8`. Default `credit-agreement-2.03-a`, v7. A slim top bar:
clause picker (four), version toggle, **Play / Pause**, speed **1× / 2× /
Instant**, and **Open full results →** (goes to `/results` with the same
session state). Auto-plays on load after a 600 ms beat. `prefers-reduced-motion`
→ Instant. Keep the synthetic-data disclaimer as a one-line slim bar, not the
current tall banner, on this route only.

Layout: max-width 1400, generous vertical rhythm, the active stage gets the
eye. Collapsed stages are one line with a check mark and their summary.

## The stages

Reuse existing components where they exist (`src/components/results`,
`src/components/review`, `ui`). Do not restyle them.

**1. Clause.** Section, page, the source text with the span highlighted.
Summary: "§2.03(a) · page 47 · 71 words".

**2. Nemotron extraction.** Active state: model name, "attempt 1", an elapsed
counter ticking in tenths of a second. Use the existing extraction client
and its diagnostics: if a retry happened, show a line "Guard: <reason> →
retried" as soon as the response lands (the `x-extraction-fallback` header and
existing fallback reasons tell you what happened; if the retry reason is not
exposed to the client today, expose it as one more header — do not change the
prompt or the guards). On completion, land the typed fields one at a time,
~120 ms apart, in this order: operation, currency, amount, settlement, notice
cutoff, cutoff timezone, booking entity, notice channel, required fields. A
null field lands in amber as "not stated". Ambiguities land last in amber.
Badge: Live Nemotron or Cached fixture, exactly as the app labels it today.
Summary: "Live · nvidia/… · 18.4 s · 1 requirement · 2 ambiguities".

**3. Validation and hash.** Quick: "Validated against schema · N fields" with
a check, then the requirement bundle hash types itself in (first 16 hex chars,
then "…"). Summary: "sha256:3f9a… · graph v7 · evaluator 0.1.0".

**4. Path search.** The centrepiece. Show the three legs as three columns of
capability chips (intake ×2, funding window ×4, booking ×4 for `fund_draw`;
derive from the graph, do not hardcode). Below, the 32 candidate paths appear
one per ~40 ms as a linear row (reuse the existing path component), each
immediately struck through in its verdict colour with its first failing field
as a tag. A counter runs: "searched 12 of 32 · pass 0 · manual 0 · fail 12".
The decisive path is pinned to the top when it appears. At the end the
counter freezes and the status line shows the real compute time. Summary:
"32 paths · 0 pass · 0 manual · 32 fail · engine 0.9 ms".

**5. Checks on the decisive path.** The `CheckResult` rows for
`selected_path_id`, ticking PASS / MANUAL / FAIL one per ~80 ms, each with
"contract requires / bank supports" and the capability id. Summary: "9 checks
· 3 fail · 2 need a person · 4 pass".

**6. Verdict.** The existing big verdict block, arriving with a short
scale-in. Summary is the verdict.

**7. Repair** (only when `proposeRepairs` returns proposals). Each proposal
animates in place: old value strikes through, new value types in, capability
id appears. ~400 ms each. Then the suggested-drafting sentence appears. If
there are no proposals (2.02(c), 2.03(c)), show the `unrepairable` reasons
instead and skip to stage 9. Summary: "5 changes, all traced to cap-001,
cap-010, cap-025".

**8. Re-test.** Stages 4–6 replay compressed (paths at ~15 ms, checks at
~40 ms) on the revised requirement, ending in the second verdict beside the
first: FAIL → PASS. Summary: "Revision: PASS · 32 paths · 1 pass".

**9. Bank changes** (benchmark clause only, or when `?v=` differs from 7).
"Capability graph v7 → v8: <changelog line>". Stages 4–6 replay on the other
version, verdicts side by side: FAIL → MANUAL. Summary is the transition.

**10. Record.** The replay record(s), pretty-printed, hash highlighted. A
**Reproduce** button re-runs `evaluate` and shows "identical · 0.8 ms" with a
check. Summary: "Reproducible · sha256:3f9a…".

## Copy bundle (for the video's other half)

In the challenge panel on `/results`, the "Files sent to the model" disclosure
gets a **Copy bundle** button that copies exactly what `buildChallengeBundle`
produces, as one pasteable text: instructions, blank line, `CLAUSE:` + text,
blank line, `CAPABILITY_GRAPH:` + JSON. Ethan will paste this into the NVIDIA
playground and screen-record the model answering, so the video's left side
uses the same files as the right. Ten lines of code; do it first.

## Implementation notes

- A small cancellable stage runner: an async function per stage that awaits
  `tick(ms)` (ms scaled by speed; 0 on Instant), checks a cancel token, and
  sets state. Changing clause/version cancels and restarts.
- All data comes from existing calls: extraction client, `evaluate`,
  `proposeRepairs`, `applyRepairs`, `capabilityGraphs`. No new API routes. No
  new dependencies. CSS transitions only.
- The path-search animation must iterate the real `candidate_paths` array in
  its real order. Do not shuffle, do not synthesise.
- Extraction happens once per clause; changing version or replaying reuses it.
  Say so on screen when it does: "Reusing this session's extraction".
- Run 1280×720 and 1920×1080 and make sure nothing is cut off on the wide
  frame. Mobile is out of scope for this route.

## Do not

- Change `src/domain/`, the prompt, the guards, Review, or Results (except
  the Copy bundle button).
- Add a scripted animation that is not backed by real output.
- Pre-fetch anything for clauses not on screen.

## Done criteria

- `/run/credit-agreement-2.03-a` plays start to finish on production with a
  live extraction: ten stages, FAIL → PASS, real compute time on the status
  line, Reproduce shows identical.
- `/run/credit-agreement-2.03-c?v=7` plays through stage 9 to FAIL → MANUAL.
- Pause, speed and Instant work; changing clause mid-run restarts cleanly.
- Copy bundle on `/results` produces text that pastes into a chat box as-is.
- `npm test` ≥ 148, typecheck and build clean. Nothing else changed.
