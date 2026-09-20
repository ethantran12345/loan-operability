<!--
Devpost submission copy. Paste from "Title" down.

The "What a chatbot can't do" numbers come from src/fixtures/challenge-recorded.json
(six recorded Nemotron runs: 2.03(a) on v7, 2.03(c) on v7 and v8, two runs each),
graded by gradeChallenge. Re-check them if the recordings change.
The market figures under "Why it matters" are the author's and are not verified by anything in this repo.
-->

Title: Dryrun
Tagline: Dry-run the loan before you sign.

What it does
Banks sign loan agreements that promise things their operations can't do. A EUR 40M same-day draw through "any lending office" when the bank funds EUR only through London, only to EUR 25M, only before 9:30. Today a few people per bank catch this by reading. JPMorgan has a job title for it: reviewing loan documentation "for operational feasibility."

Dryrun tests the contract against the bank before signature. Nemotron reads each clause into a typed requirement. A deterministic engine then searches every complete operating path in the bank's versioned capability graph and returns PASS, MANUAL, or FAIL with evidence. On a FAIL it proposes a repair using only bounds that exist in the graph, re-tests, and shows the clause go green. Change the bank instead of the contract and it re-tests again. Every decision comes with a replay record and a hash, so it can be reproduced.

Why it matters
9,601 syndicated deals last year, $6.6 trillion. 20 of the top 25 lenders run the same servicing platform. When the human check slips it costs real money: Citi sent $894M by manual error in 2020 and spent two years recovering it, and paid a $400M penalty for risk-control failures the same quarter. McKinsey says the fix is to identify nonstandard deals early and structure them within what the bank's systems can do. That check is what we built.

How we built it
Vite, React, TypeScript, Tailwind, Zod, Vitest. The bank's policies and capability version are standing state, loaded when the app opens. A run starts from the one new thing, the draft agreement: it is parsed, hashed with SHA-256 and listed, and anything that is not packet format v1 is rejected by name with the run blocked. A policy file handed over anyway replaces the standing copy with the same identity, and is labelled as handed over. It reads .md packet files only: no PDF, no OCR. Vercel function calling NVIDIA's hosted Nemotron 3.5 for extraction, with one retry and a labelled cached fallback. The evaluator is pure TypeScript: 14 typed comparators, a bounded path search over a versioned JSON capability graph, a grounded repair generator, and a replay record with a SHA-256 of the inputs. 208 tests. The document workspace reads a six-file packet with verified citations back to the operating procedures.

What a chatbot can't do
The same clause and the same files, given to the same model with no engine, usually reaches the same verdict: in our recorded runs it matched the engine on two of three scenarios. It can't show it searched all 32 paths. It named four or five, and in half the runs at least one of those wasn't a path the bank has. In half the runs it proposed a value that isn't in the bank's graph. And two runs on identical inputs reached the same verdict with different lists of conflicts. Challenge mode in the app grades all of this live, with the engine as referee. The claim isn't that the model is wrong. It's that the method has properties the model doesn't.

What's next
A real capability graph is the product. Every institution already has this knowledge scattered across procedures, registers, and people. Dryrun makes it a versioned, testable model, and the loan review is the first thing you test against it.

Contract readers tell banks what an agreement says. We prove whether the institution can support it.
