# Handoff — /api/extract + the two routes

Repo: `~/Developer/loan-operability`. Commit on `dev`, no branch, no PR.
Model: top model for the API contract and the results view; the rest is mechanical.

## What already exists and must not be rewritten

`src/domain/` is done and green (65 tests, `npm test`). Read `README.md` first,
then `src/domain/types.ts`. Do not change evaluator behaviour to make the UI
easier — if a UI need implies a domain change, say so before touching it.

Public surface you build against:

```ts
import { evaluate, evaluateClause, evaluateRequirement } from '@/domain/evaluate'
import { proposeRepairs, applyRepairs } from '@/domain/repair'
import { agreement, capabilityGraph, cachedExtraction, TRANSACTION_TIME } from '@/domain/fixtures'
```

## Task 1 — `api/extract.ts` (Vercel Function)

Input: `{ clause_id, clause_type, source_text, source_span }`.
Output: an `ExtractedClause` exactly as typed in `src/domain/types.ts`.

1. Add `src/domain/schema.ts`: Zod schemas mirroring `Requirement`,
   `AmountConstraint`, `TimingConstraint`, `InterestConstraint`, `FeeConstraint`,
   `ExtractedClause`. Export `ExtractedClauseSchema`. The Zod types must be the
   single source of truth — derive the TS types from Zod with `z.infer` and have
   `types.ts` re-export them, rather than keeping two hand-written copies that
   can drift.
2. POST to NVIDIA's hosted Nemotron (OpenAI-compatible chat completions,
   `https://integrate.api.nvidia.com/v1/chat/completions`), key from
   `process.env.NVIDIA_API_KEY`, `temperature: 0`, and ask for JSON only.
3. Parse, `safeParse` with Zod. On failure, **one** retry with the validation
   error fed back in the prompt.
4. On second failure, or any network/auth error, return
   `cachedExtraction(clause_id)` and set `extraction_source: 'fixture'`.
   Never 500 into the demo.
5. The prompt must instruct: extract only what the clause says; set a field to
   `null` when the clause is silent; put every silence in `ambiguities`. Do not
   let it guess a timezone — the unstated-timezone case is a headline feature.

Tests: mock the fetch. Cover good JSON, malformed JSON then good on retry,
malformed twice -> fixture, and a non-200 -> fixture.

## Task 2 — Review route (`/`)

- Synthetic agreement rendered from `agreement.json`, three selectable clauses.
- Selecting a clause highlights its `source_text` and calls `/api/extract`.
- Show the extracted requirement beside the clause: typed fields, `confidence`,
  and `ambiguities` called out rather than hidden.
- One field must be editable (amount is fine) so a human can correct extraction.
- A badge showing `extraction_source`: live Nemotron or cached fixture. Be honest
  about which one served the result.
- Primary action: **Run operability test**.

## Task 3 — Results route (`/results`)

1. Large `PASS` / `MANUAL` / `FAIL`.
2. **Contract requires** vs **Bank supports**, per conflicting field, with the
   `capability_id` and its evidence section cited. Data is already on
   `RequirementResult.conflicts` / `.manual_flags` / `.unknowns`.
3. Candidate capability paths: a custom linear component, one row per path,
   showing its legs and per-leg verdict. Mark the path the decision was reported
   against (`selected_path_id`). Showing the rejected paths is the point — it is
   the visible proof a search happened.
4. **Apply operational alternative** — render `proposeRepairs(...)`, each row
   `from -> to` with its rationale and `capability_id`. Show `unrepairable`
   entries too, with their reason.
5. **Re-test revision** — `applyRepairs` then re-evaluate, and animate
   `FAIL -> PASS`. Keep both results on screen; the transition is the product.
6. Expandable technical proof panel: the full `ReplayRecord` plus every
   `CheckResult` on the selected path.

## Constraints

- Tailwind v4 (`@tailwindcss/vite`, already wired), Radix/shadcn-style primitives,
  `clsx` + `tailwind-merge`, `lucide-react`. No component library beyond that.
- No Supabase, no auth, no graph DB, no PDF upload, no OCR, no chatbot.
- Never fabricate a bank, a borrower, a quote, or a number. Everything on screen
  traces to a fixture.
- Keep the synthetic-data disclaimer visible on both routes.

## Done criteria

- `npm test` green, `npm run typecheck` clean, `npm run build` clean.
- Clicking each of the three clauses produces FAIL, MANUAL, PASS respectively.
- The FAIL clause repairs to PASS in the UI, with every proposed value traceable
  to a `capability_id`.
- Works with `NVIDIA_API_KEY` unset (fixture path) — verify this explicitly.
