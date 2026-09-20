# Handoff 07 — the run happens on screen

Commit on `dev`, no branch, no PR. **Hard timebox: 2 hours.** This changes only
`src/routes/Dryrun.tsx` and the components it owns. Nothing under
`src/domain/` or `src/documents/`; no verdict, extraction, or packet changes;
no new dependencies. Keep the five-control budget from handoff 06 exactly.
If not solid at the timebox, revert to 1cd209b's screen.

## The problem with the current screen

Pressing **Run dry run** changes a label and then four finished cards appear.
A viewer cannot see what Nemotron did or what the engine did. The `/run`
route shows that, but as a ten-stage timeline that is too much for the
product screen. This handoff moves the *visible work* into the two panes that
already exist, driven by the same real data `/run` uses.

The rule from handoff 05 still holds: every frame is real output; pacing is
the only thing added; the actual timings are shown.

## Three acts, in place

### Act 1 — Find the clauses (≈600 ms, engine)

On Run, the document pane scrolls to Article II and the four in-scope clauses
get an outline, one after another (~150 ms apart), as if being found. The
header reads **Reading the agreement · 4 borrowing clauses found**. The
findings column shows four *placeholder cards* in document order, each with
just the section and headline and a thin reading indicator. Nothing else.

### Act 2 — Nemotron reads each clause (real latency)

Fire the four extractions exactly as today (parallel; live/cached labelled).
As each response lands, that clause's card comes alive **in the order
responses arrive** — that is honest and it looks like real work.

For the landing card:
- The clause in the document gets a highlight sweep (left to right, ~500 ms).
- Under the card headline, the **extracted terms land one at a time as
  chips**, ~110 ms apart, in this order, only the ones present on the
  requirement: `Fund draw` · `EUR` · `40,000,000` · `Same day` · `Cutoff
  11:00` · `Timezone not stated` (amber) · `Any lending office` · `Channel not
  stated` (amber) · `Fields not stated` (amber). Amber chips are the
  requirement's nulls and `ambiguities`. This is "how Nemotron read it":
  its output, as it arrived, nothing invented.
- If the response carries a guard retry (the `x-extraction-*` headers from
  handoff 05), one small line appears above the chips before they land:
  **"Rejected a guessed timezone · asked again"** (use the real reason).
- A badge on the card: **Live Nemotron · 6.9 s** or **Cached fixture**, using
  the real elapsed time. While waiting, the card shows a tenths-of-a-second
  counter, exactly like `/run` stage 2.
- Confidence as a thin bar under the chips (the requirement's `confidence`).

### Act 3 — The engine checks the terms (≈1.5 s per card, staged)

Immediately after a card's chips land, the engine runs (instantly) and the
result is *revealed* in stages on that card:

1. A counter beside the headline runs **"searching routes · 12 of 32"** to 32
   over ~800 ms. (Use the real `candidate_paths.length`; 32 for fund_draw, 2
   for receive_notice.)
2. Each chip gets a **verdict mark** in place, one at a time, ~120 ms apart,
   using the decisive path's checks matched to the chip's field: a green tick,
   an amber person icon, or a red cross, and the chip grows a second line
   with the bank's side: `40,000,000` → **✗ up to 25,000,000** · `Cutoff
   11:00` → **✗ 09:30 Europe/London** · `Any lending office` → **✗ london
   only** · `EUR` → **✓** · `Same day` → **✓**. This is the "Agreement says /
   Bank supports" pair, now appearing *on the term it belongs to*.
3. The verdict pill stamps on the card (scale-in, ~200 ms) and, at the same
   moment, in the document margin beside the clause.
4. Header count updates as each card finishes: **2 of 4 checked · 1 fail …**

Cards are independent: card 3 may finish Act 3 while card 1 is still in
Act 2. That is fine and honest.

### The repair, on the same chips

Expanded FAIL card → **Apply fix and re-test** (the one button). Then:
- The crossed chips animate: old value strikes through, new value types in
  with its capability id (`25,000,000 · cap-010`). Amber chips resolve to
  their proposed value the same way (`Timezone not stated` → `Europe/London`).
- The route counter runs again (~500 ms), the verdict marks re-run in place,
  crosses become ticks, and the pill flips FAIL → PASS on the card and in the
  margin. Both pills stay visible on the card: **FAIL → PASS**.

Everything below the chips in the expanded card stays as handoff 06 built it
(cited procedure pairs, Open in agreement / procedure, Show route search).

## Status line

One line under the header, only during and after a run, replacing nothing:
**"Nemotron 4 clauses · 6.9–24.8 s · Engine 98 routes · 19 ms · every value
shown is real output, paced for reading."** Real numbers from the run.

## Controls: unchanged

Run dry run · card expand · Apply fix and re-test · Export record · Demo
tools. Chips and pills are not controls; the margin pills still navigate.

## Reuse

`src/components/run/` already has the field-landing, check-ticking, path
counter and elapsed counter. Reuse them; do not rewrite. `prefers-reduced-
motion` → everything lands instantly, marks and pills included.

## Do not

- Add a stage list, timeline, progress bar with stage names, or log console.
- Show model "thoughts". Nemotron's output is the requirement; that is what
  "how it thinks" means here, and it is shown as chips. Never fabricate
  narration.
- Slow the real work. Pacing may delay *reveals*, never calls or evaluation.

## Done criteria

- On production at 1280×720: Run → clauses outline in the document → cards
  come alive as responses arrive → chips land → route counter → verdict marks
  on chips → pill on card and in margin. A viewer with no narration can say
  what happened.
- §2.03(a): chips show 40,000,000 ✗ up to 25,000,000, Cutoff ✗ 09:30
  Europe/London, Any lending office ✗ london only, EUR ✓, Same day ✓, two
  amber chips. Apply fix → chips retype → ticks → FAIL → PASS on card and
  margin.
- A guard retry, when one happens live, is shown as one line with the real
  reason. When none happens, no line.
- Reduced motion: same end state, no animation.
- Five controls, `npm test` ≥ 175, typecheck and build clean, no console
  errors, `/workspace` `/review` `/results` `/run` still load.
