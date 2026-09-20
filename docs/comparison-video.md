# Comparison video: recording guide

Two windows side by side: a chat interface on the left, the Dryrun
workspace on the right. Both get the same inputs and the same question:

> Can this bank support the agreement? Identify conflicts and cite evidence.

The point of the video is the workflow: explicit route constraints, versioned
evidence, a reviewed amendment, a deterministic re-test and a reproducible
record. It is not a claim that a chat model cannot do this. Do not re-roll the
chat side, do not trim an answer that is right, and if it answers correctly say
so on screen.

## Same inputs

**Copy chat packet** in the workspace toolbar copies one text (about 30,000
characters; the download button saves the same text as a file):

- the question, first and last;
- the transaction date the engine uses (22 September 2026);
- all five packet documents in full, each with its id and version;
- the capability registry JSON for the selected version, the file the engine reads.

It contains no verdict, finding or hint. The packet follows the registry
selector: v7 carries register version 3 and registry v7; v8 carries register
version 4 and registry v8.

## Steps

Record at 1920x1080 (1280x720 also fits). Use https://loan-operability.vercel.app.

1. **Ingestion and cited findings.** Load `/`. The strip runs Read documents,
   Extract terms, Check routes. Extraction is a real hosted Nemotron call and can
   take up to about 25 seconds; each clause is labelled Live Nemotron or Cached
   fixture when it lands. A cached clause offers **Try live Nemotron again** under
   Extracted terms; use it if you want a live label, and leave whatever label you
   get on screen. In the chat
   window, paste the packet for registry v7 and send it.
2. Click the tray documents to show what was read. Open §2.03(a) in the findings
   and click **Unsupported same-day amount**: the agreement's "EUR 40,000,000"
   and the policy's "EUR 25,000,000" are highlighted side by side. Use **Open in
   document** to land on the passage in MCB-OPS-204.
3. **Individually supported, not on one route.** Still in §2.03(a), open
   **Supported separately, but not on one route**: EUR 40,000,000 fits the T+1
   window, which is not same-day. Compare with what the chat answer says about
   combining limits.
4. **Bank version change.** Open §2.03(c) and click **Approval authority not in
   force**: the funding procedure demands Treasury approval, and register
   version 3 says the authority expired on 31 August 2026. Switch the toolbar to
   **Registry v8**. The tray swaps in register version 4, the clause moves from
   FAIL to MANUAL (owner: treasury), and the strip says the terms were reused
   with no model call.
5. **Verdict change and evidence.** The compare view now highlights "15
   September 2026" and "No expiry date". In the chat window, start a new
   conversation, copy the packet again (now v8) and send it.
6. **Reviewed amendment and re-test.** Back on Registry v7, in §2.03(a): open
   Extracted terms, tick the terms checkbox, untick **Amount value**, tick the
   amendment checkbox, press **Re-test 4 of 5 changes**: FAIL, the amount is
   still over the limit. Tick Amount value again and re-test: PASS. The
   agreement's own result stays "Not supportable as drafted", because a re-test
   is not a redraft. Say on camera that the checkboxes are a demo review step,
   not authenticated approval.
7. **Reproduction.** Open **Route evidence and record** and press
   **Reproduce**: "Identical result from the same inputs". For the chat side,
   send the identical packet in a fresh conversation and show both answers,
   whatever they are.

## What to say honestly

- The documents, the bank and the registry are synthetic.
- The registry is hand-authored. The application verifies that each registry
  value appears in its cited policy passage; it does not derive rules from prose.
- Only the four Article II borrowing clauses are extracted and checked.
- The format read is one text format. No PDF, DOCX, scans or OCR.
