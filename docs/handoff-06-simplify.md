# Handoff 06 — one screen, five controls

Commit on `dev`, no branch, no PR. **Hard timebox: 2.5 hours.** Build the new
screen as `src/routes/Dryrun.tsx` mounted at `/`, move the current Workspace to
`/workspace`, and keep every other route. If the new screen is not solid at the
timebox, point `/` back at Workspace and stop. Nothing under `src/domain/` or
`src/documents/` changes. No new dependencies.

## The diagnosis

The product and the demo instrumentation are on the same screen. Registry
v7/v8, Copy chat packet, the progress strip, the review checkbox, Challenge
mode, four nav items and a download icon are all things a **judge** needs and
none of them are things a **loan ops analyst** needs. Mixed, they read as
twenty controls. Separated, the product is five.

The test for every element: would a new analyst on day one need this to do
the job? If not, it goes in the Demo drawer or it goes away.

## The screen

One route, no tabs, no top banner stack. Three regions.

**Header (one row).** Wordmark "Dryrun" and tagline on the left. On the right,
ONE primary button that is a state machine:

- idle: **Run dry run**
- running: **Reading 5 documents…** → **Extracting 4 clauses…** (with the
  live/cached badge inline) → **Checking 64 routes…**
- done: **3 findings · 1 fail · 1 needs a person · 2 pass** (neutral, not a
  button; a small "Run again" text link beside it)

Next to it, a quiet label, not a control: `Registry v8 · 2026-09-15 · 16/16
citations verified`. Then a single icon control: **Demo tools** (a gear or
flask icon, with the word). That is the entire header.

**Left: the agreement.** Full document as today, but the four in-scope clauses
get a verdict pill in the left margin once the run completes (FAIL red, MANUAL
amber, PASS green), and the document itself is the navigation: clicking a
pill or a clause heading selects that finding on the right and scrolls to it.
No policy-document tray. The bank's procedures appear only inside a finding's
evidence, where they matter.

**Right: findings.** One card per in-scope clause, in document order. Collapsed
card = verdict pill, section, one plain sentence ("Same-day amount above the
bank's limit"), and the pair: **Agreement says** EUR 40,000,000 / **Bank
supports** up to EUR 25,000,000. That pair is the whole product in one glance;
give it the typographic weight.

Expanded card (click) shows, in order:
1. Every conflict as the same pair, each with its cited procedure and section
   as a small line (this replaces the Compare-evidence tab: the two passages
   appear side by side *inside the card*, highlighted, with "Open in agreement"
   / "Open in procedure" text links).
2. For FAIL/MANUAL with proposals: the proposed changes as strikethrough →
   new value with the capability id, and ONE button: **Apply fix and re-test**.
   No checkbox. Replace the checkbox with a one-line note under the button:
   "Suggested drafting from the bank's verified limits. Not approval."
   After re-test the card shows both pills, FAIL → PASS, and the changed
   values stay visible.
3. For MANUAL with no proposals: the human step and its owner, in one line.
4. A text link **Show route search** that expands the 32-path grid from `/run`
   (reuse the component) inside the card. Collapsed by default.

**Footer (one line).** The synthetic-data disclaimer as a single slim line at
the bottom of the viewport, and an **Export record** text link that downloads
the replay JSON. Keep the disclaimer; it is required. It does not need to be a
yellow banner at the top of the screen.

## Control budget — exactly these, nothing else visible

| # | Control | Where |
|---|---|---|
| 1 | Run dry run (state machine) | header |
| 2 | Finding card expand/collapse | findings |
| 3 | Apply fix and re-test | inside a FAIL/MANUAL card |
| 4 | Export record | footer |
| 5 | Demo tools | header |

Text links inside an expanded card (Open in agreement, Open in procedure, Show
route search, Run again) are not counted; they are quiet, underlined, and never
styled as buttons.

## The Demo drawer

A right-side drawer opened by **Demo tools**. It holds, in this order, with a
one-line caption each:

- **Bank registry version**: v7 (2026-09-09) / v8 (2026-09-15) segmented
  control, with the changelog line under it. Switching re-runs the check and
  closes the drawer; the header label updates. The orange "Bank change" banner
  is deleted; the changelog line in the drawer replaces it.
- **Copy chat packet** and **Download packet** — with the caption "The same
  five documents and registry, for pasting into a chat model."
- **Check the model's work** → opens Challenge mode (link to `/results` panel
  or embed; do not rebuild it).
- **Watch the run** → `/run/<current clause>`.
- **Per-clause extraction**: the four clauses with live/cached badge and a
  "Try live again" per clause. This is where the extraction diagnostics live
  now, not in the progress strip.
- **Technical results** → `/results`.
- **Old workspace** → `/workspace`.

## Visual rules

- One accent per verdict and nothing else coloured: FAIL, MANUAL, PASS. Every
  other surface is the existing warm neutral. The screenshot has four
  competing colour bars (yellow disclaimer, orange bank-change, blue strip,
  dark nav); the new screen has zero bars.
- Serif for the agreement and for clause headings only. Everything else is the
  existing sans.
- No monospace in the product view except capability ids and the hash in the
  export. Timings, route counts and citation counts belong in the drawer.
- Whitespace: the findings column is 420–480px, cards have 20px padding and
  16px between them, the document column takes the rest. At 1280 wide nothing
  wraps awkwardly.
- Motion: the pill in the margin and on the card animate FAIL → PASS on
  re-test; nothing else moves. Respect `prefers-reduced-motion`.
- Empty state before the first run: the agreement is visible, the findings
  column shows one sentence — "Run a dry run to check this agreement against
  the bank's verified capabilities" — and nothing else.

## Do not

- Add a step wizard, a progress bar with stage names, or a tour.
- Show route counts, timings, hashes, or "citations verified" anywhere except
  the header label and the drawer.
- Change any verdict logic, the extraction path, or the packet.
- Leave the yellow banner, the orange banner, or the tab strip on `/`.

## Done criteria

- `/` at 1920×1080 and 1280×720: exactly five visible controls before a card
  is expanded. Count them.
- Run dry run → four pills appear in the document margin, four cards on the
  right, FAIL / MANUAL / PASS / FAIL.
- Expand §2.03(a) → three pairs with cited procedures → Apply fix and re-test
  → pill flips to PASS, values stay visible.
- Demo tools → switch to v8 → §2.03(c) becomes MANUAL; drawer closes; header
  label reads v8.
- Export record downloads the replay JSON.
- Footer disclaimer visible at both sizes. No yellow or orange banner.
- `npm test` ≥ 175, typecheck and build clean. `/workspace`, `/review`,
  `/results`, `/run` all still work.
