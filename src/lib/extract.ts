/**
 * Clause extraction: Nemotron first, cached fixture when anything goes wrong.
 *
 * Runs server-side (api/extract.ts, and the Vite dev middleware). It imports with
 * relative '.js' paths rather than the '@/' alias because Vercel executes it as
 * plain Node ESM.
 *
 * The model only ever supplies `requirements`. The clause identity, text and span
 * are copied from the request, so a model cannot rewrite the sentence it was
 * asked to read.
 */

import { cachedExtraction, capabilityGraph } from '../domain/fixtures.js'
import {
  ExtractedClauseSchema,
  type ExtractRequest,
  type ExtractedClause,
} from '../domain/schema.js'

export const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
export const DEFAULT_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b'

/** Why the fixture served the result. null when Nemotron served it. */
export type FallbackReason =
  | 'no_api_key'
  | 'timeout'
  | 'network_error'
  | 'invalid_output'
  | `http_${number}`

export interface ExtractOutcome {
  clause: ExtractedClause
  fallback_reason: FallbackReason | null
  /** Rounds with the model: 1, or 2 when a reply was rejected. 0 when no key was configured. */
  attempts: number
  /** HTTP calls launched, hedged duplicates included. */
  calls: number
  /** Wall-clock time spent waiting on the model, across attempts. */
  upstream_ms: number
  /** Why each rejected model reply was rejected, in order. For logs, not the UI. */
  rejections: string[]
}

export interface ExtractDeps {
  apiKey: string | undefined
  fetch: typeof fetch
  model?: string
  /** Budget for the WHOLE extraction, retry included. The demo never waits longer. */
  timeoutMs?: number
  /** When to launch a duplicate call if no reply has arrived yet. [] disables hedging. */
  hedgeAfterMs?: number[]
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

const SYSTEM_PROMPT = `detailed thinking off

You convert ONE clause of a loan agreement into structured operational requirements.
Reply with a single JSON object and nothing else: no prose, no markdown, no code fence.

Rules
1. Extract only what the clause itself says. Never use outside knowledge, market convention, or what is "usually" meant.
2. When the clause is silent on a field, set that field to null (or "unspecified" where the enum offers it). Never fill a gap with a likely value. Every key in the Shape must be present: inside "timing", "settlement" is "unspecified" when the clause names no settlement date.
3. Every silence or undefined term that an operations team would need resolved goes in "ambiguities" as one plain sentence each. If nothing is unclear, use []. Check each of these separately and give each one that applies ITS OWN sentence: a clock time with no timezone; a notice with no stated delivery channel; a notice whose required contents are not stated; an undefined term such as "authenticate". Do not report a gap the clause cannot have: a clause with no clock time has no timezone gap.
4. Timezone: set "timezone" to an IANA zone ONLY when the clause names a place or zone for the time (for example "London time"). A bare clock time such as "11:00 A.M." has timezone null, and the missing timezone must be listed in "ambiguities". Do not infer a zone from the currency, the parties, or the lending office.
5. "any Lending Office" means booking_entity "any_lending_office". A single named office is its lowercase city, for example "london".
6. Clock times are 24-hour "HH:MM". Amounts are plain numbers with no separators.
7. "confidence" is your own 0 to 1 confidence that the requirement matches the clause text.
8. "operation" is what the clause obliges the bank to DO, not which document it mentions. Emit ONE requirement per clause unless it holds clearly separate obligations. "requirements" is never empty: a clause about how notices are given is a "receive_notice" requirement even though no money moves.
   - "fund_draw": the Borrower may request or draw an advance (the clause gives an amount, a currency or a settlement date). A notice deadline attached to that advance belongs to the same fund_draw requirement.
   - "receive_notice": the clause is only about how a notice is validly delivered, authenticated or acted upon, and grants no advance.
   - "book_facility": only where a facility is booked. "calculate_interest": rate, benchmark or day count. "collect_fee": fees.
9. "up to X" or "not exceeding X" is operator "lte". "at least X" is "gte". An exact amount is "eq".
10. "required_fields" is non-null ONLY when the clause has words such as "shall specify" or "specifying" followed by the contents of a notice. Then use exactly these names: "the Facility" is "facility_id", "principal amount" is "amount", "currency" is "currency", "requested value date" is "value_date". Anything else the clause lists gets its own snake_case name. An amount or currency that merely describes the advance is not a notice field, and implied or customary contents do not count. With no such words, "required_fields" is null and the gap is listed in "ambiguities".
11. "notice_channel" is "email" when the clause says email, e-mail or electronic mail, and "portal" when it names a portal or electronic platform. When the clause names no channel it is "unspecified" and the missing channel is listed in "ambiguities".
12. "notice_lead_business_days" is how many Business Days BEFORE the advance the Borrower's notice is due. A notice due "on such Business Day" (the day of the advance) is 0. It is null when the clause gives no notice deadline.
13. "service_level_business_days" is how many Business Days the clause gives the BANK to authenticate, process or act ("within one Business Day of receipt" is 1). It is never a notice lead.

Shape
{
  "requirements": [
    {
      "requirement_id": "req-001",
      "operation": "receive_notice" | "fund_draw" | "book_facility" | "calculate_interest" | "collect_fee",
      "currency": "ISO 4217 code" | null,
      "amount": { "operator": "lte" | "gte" | "eq", "value": number, "unit": "ISO 4217 code" } | null,
      "timing": {
        "settlement": "same_day" | "t_plus_1" | "unspecified",
        "notice_cutoff": "HH:MM" | null,
        "timezone": "IANA zone" | null,
        "notice_lead_business_days": integer | null,
        "service_level_business_days": integer | null
      } | null,
      "booking_entity": string | null,
      "notice_channel": "portal" | "email" | "any" | "unspecified" | null,
      "required_fields": [snake_case field names] | null,
      "interest": { "benchmark": string, "method": string, "day_count": string | null, "observation_shift_days": integer | null, "floor_bps": number | null } | null,
      "fee": { "basis": string, "recipients": integer, "currencies": [string], "recalculation_frequency": string | null } | null,
      "mandatory": boolean,
      "confidence": number,
      "ambiguities": [string]
    }
  ]
}`

function userPrompt(input: ExtractRequest): string {
  return [
    `clause_id: ${input.clause_id}`,
    `clause_type: ${input.clause_type}`,
    `section: ${input.source_span.section}`,
    'clause text:',
    '"""',
    input.source_text,
    '"""',
  ].join('\n')
}

/** Pull the JSON object out of a chat completion, tolerating fences and think blocks. */
export function parseModelJson(content: string): unknown {
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('reply contained no JSON object')
  return JSON.parse(stripped.slice(start, end + 1))
}

const ZONE_ABBREVIATION = /\b(UTC|GMT|BST|CET|CEST|EST|EDT|CST|CDT|MST|MDT|PST|PDT)\b/

/**
 * The deterministic backstop behind prompt rule 4. A timezone is only accepted
 * when the clause text names it: the zone's own city, or a zone abbreviation.
 * Anything else is a guess, however plausible, and is rejected.
 */
export function timezoneIsStated(sourceText: string, timezone: string): boolean {
  const city = timezone.split('/').pop()!.replace(/_/g, ' ')
  if (sourceText.toLowerCase().includes(city.toLowerCase())) return true
  return ZONE_ABBREVIATION.test(sourceText)
}

const NOTICE_CONTENTS = /\b(specif(y|ies|ying)|set(s|ting)? out|contain(s|ing)?)\b/i

/**
 * The same backstop for notice contents. The bank needs certain fields on a
 * notice; a clause that never says what a notice must specify leaves that open,
 * and the evaluator reports it as MANUAL. A model that fills the list in from
 * custom would turn that unknown into a PASS.
 */
export function noticeContentsAreStated(sourceText: string): boolean {
  return NOTICE_CONTENTS.test(sourceText)
}

/** The notice fields the bank's own capabilities are written in. */
const BANK_NOTICE_FIELDS = [
  ...new Set(capabilityGraph.capabilities.flatMap((c) => c.constraints.required_fields ?? [])),
]

/**
 * The bank's name for a field the model spelled its own way ("facility" for
 * "facility_id"). Comparison is by exact name, so a near miss would read as a
 * missing field and turn a supported notice into a conflict.
 */
export function bankFieldFor(field: string): string | null {
  if (BANK_NOTICE_FIELDS.includes(field)) return null
  return BANK_NOTICE_FIELDS.find((known) => known.includes(field) || field.includes(known)) ?? null
}

type Validation = { ok: true; clause: ExtractedClause } | { ok: false; error: string }

/** Assemble the full clause around the model's requirements and validate it. */
export function validateModelOutput(
  input: ExtractRequest,
  content: string,
  model: string,
): Validation {
  let parsed: unknown
  try {
    parsed = parseModelJson(content)
  } catch (err) {
    return { ok: false, error: `Reply was not valid JSON: ${(err as Error).message}` }
  }

  const requirements =
    parsed !== null && typeof parsed === 'object' && 'requirements' in parsed
      ? (parsed as { requirements: unknown }).requirements
      : undefined

  if (Array.isArray(requirements) && requirements.length === 0) {
    return {
      ok: false,
      error:
        '"requirements" was empty. Every clause obliges the bank to do something. A clause about how a notice is delivered, authenticated, acted upon or what it must specify is one "receive_notice" requirement. Extract it from the clause text, following every rule.',
    }
  }

  const result = ExtractedClauseSchema.safeParse({
    clause_id: input.clause_id,
    clause_type: input.clause_type,
    source_text: input.source_text,
    source_span: input.source_span,
    requirements,
    extraction_source: 'nemotron',
    model,
  })

  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 12)
      .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    return { ok: false, error: `Schema validation failed:\n${issues.join('\n')}` }
  }

  const guessed = result.data.requirements.filter(
    (r) => r.timing?.timezone && !timezoneIsStated(input.source_text, r.timing.timezone),
  )
  if (guessed.length > 0) {
    const detail = guessed
      .map((r) => `- ${r.requirement_id}: timing.timezone "${r.timing!.timezone}"`)
      .join('\n')
    return {
      ok: false,
      error: `The clause text never names a timezone, but one was supplied:\n${detail}\nSet timing.timezone to null and list the missing timezone in "ambiguities".`,
    }
  }

  const invented = result.data.requirements.filter(
    (r) => r.required_fields !== null && !noticeContentsAreStated(input.source_text),
  )
  if (invented.length > 0) {
    const detail = invented
      .map((r) => `- ${r.requirement_id}: required_fields [${r.required_fields!.join(', ')}]`)
      .join('\n')
    return {
      ok: false,
      error: `The clause text never says what a notice must specify, but required_fields was supplied:\n${detail}\nSet required_fields to null and list the unstated notice contents in "ambiguities".`,
    }
  }

  // A requirement that states nothing is not an extraction of anything. Left in,
  // it would be evaluated as though the clause had been read.
  const hollow = result.data.requirements.filter(
    (r) =>
      r.currency === null &&
      r.amount === null &&
      r.booking_entity === null &&
      r.required_fields === null &&
      r.interest === null &&
      r.fee === null &&
      (r.notice_channel === null || r.notice_channel === 'unspecified') &&
      (r.timing === null ||
        (r.timing.settlement === 'unspecified' &&
          r.timing.notice_cutoff === null &&
          r.timing.notice_lead_business_days === null &&
          r.timing.service_level_business_days === null)),
  )
  if (hollow.length > 0) {
    const ids = hollow.map((r) => r.requirement_id).join(', ')
    return {
      ok: false,
      error: `These requirements state nothing the clause says: ${ids}.\nRe-read the clause and extract what it actually obliges, following every rule.`,
    }
  }

  const silentZone = result.data.requirements.filter(
    (r) =>
      r.timing?.notice_cutoff &&
      r.timing.timezone === null &&
      !r.ambiguities.some((a) => /time ?zone/i.test(a)),
  )
  if (silentZone.length > 0) {
    const detail = silentZone
      .map((r) => `- ${r.requirement_id}: notice_cutoff "${r.timing!.notice_cutoff}" has timezone null`)
      .join('\n')
    return {
      ok: false,
      error: `A cutoff with no timezone is an open question and must be reported:\n${detail}\nKeep timing.timezone null and add one sentence about the missing timezone to "ambiguities", alongside the others.`,
    }
  }

  const misnamed = result.data.requirements.flatMap((r) =>
    (r.required_fields ?? []).flatMap((field) => {
      const known = bankFieldFor(field)
      return known ? [`- ${r.requirement_id}: required_fields "${field}" must be written "${known}"`] : []
    }),
  )
  if (misnamed.length > 0) {
    return { ok: false, error: `Notice fields must use the standard names:\n${misnamed.join('\n')}` }
  }

  return { ok: true, clause: result.data }
}

function fixture(
  input: ExtractRequest,
  fallback_reason: FallbackReason,
  attempts: number,
  calls: number,
  upstream_ms: number,
  rejections: string[] = [],
): ExtractOutcome {
  return {
    clause: { ...cachedExtraction(input.clause_id), extraction_source: 'fixture' },
    fallback_reason,
    attempts,
    calls,
    upstream_ms,
    rejections,
  }
}

/** A settled model call: the HTTP status, and the reply text when it was a 200. */
interface ModelReply {
  status: number
  content: string
}

class BudgetExceeded extends Error {}

/**
 * Race duplicate calls against a slow queue. NVIDIA's hosted endpoint answers an
 * identical request in under a second or in over twenty, depending on the worker
 * it lands on, so a duplicate launched while the first is silent usually wins.
 *
 * The first 200 wins and the rest are aborted. A failure only counts once nothing
 * else is in flight, so a throttled duplicate cannot sink a call that is still
 * running, and a dead network or a 401 still fails at once.
 */
export function hedged(
  call: (signal: AbortSignal) => Promise<ModelReply>,
  budgetMs: number,
  hedgeAfterMs: number[],
): Promise<ModelReply> {
  return new Promise((resolve, reject) => {
    const controllers: AbortController[] = []
    const timers: ReturnType<typeof setTimeout>[] = []
    let inFlight = 0
    let done = false

    const finish = (settle: () => void) => {
      if (done) return
      done = true
      timers.forEach(clearTimeout)
      settle()
      controllers.forEach((c) => c.abort())
    }

    const launch = () => {
      if (done) return
      const controller = new AbortController()
      controllers.push(controller)
      inFlight++
      call(controller.signal).then(
        (reply) => {
          inFlight--
          if (reply.status === 200 || inFlight === 0) {
            finish(() => resolve(reply))
          }
        },
        (err) => {
          inFlight--
          if (inFlight === 0) finish(() => reject(err))
        },
      )
    }

    timers.push(setTimeout(() => finish(() => reject(new BudgetExceeded())), budgetMs))
    for (const delay of hedgeAfterMs) if (delay < budgetMs) timers.push(setTimeout(launch, delay))
    launch()
  })
}

/**
 * Extract a clause. One live attempt, one retry with the validation error fed
 * back, then the cached fixture. Any network or auth failure goes straight to the
 * fixture: retrying a 401 only delays the demo. Both attempts share one time
 * budget, so a slow first reply cannot double the wait.
 *
 * Throws only when the fixture itself is missing (an unknown clause_id).
 */
export async function extractClause(
  input: ExtractRequest,
  deps: ExtractDeps,
): Promise<ExtractOutcome> {
  if (!deps.apiKey) return fixture(input, 'no_api_key', 0, 0, 0)

  const started = Date.now()
  const elapsed = () => Date.now() - started
  const budgetMs = deps.timeoutMs ?? 25_000
  const hedgeAfterMs = deps.hedgeAfterMs ?? [5_000, 10_000]
  const rejections: string[] = []
  let calls = 0

  const model = deps.model ?? DEFAULT_MODEL
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt(input) },
  ]

  const callModel = async (signal: AbortSignal): Promise<ModelReply> => {
    calls++
    const res = await deps.fetch(NVIDIA_CHAT_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deps.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        max_tokens: 2048,
        stream: false,
        // Extraction needs bounded JSON, not a long reasoning trace. Nemotron
        // 3.5 enables thinking by default, which can exceed the demo timeout.
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal,
    })
    if (!res.ok) return { status: res.status, content: '' }
    const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
    const raw = body.choices?.[0]?.message?.content
    return { status: 200, content: typeof raw === 'string' ? raw : '' }
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    const remainingMs = budgetMs - elapsed()
    if (remainingMs < 1_000) return fixture(input, 'timeout', attempt - 1, calls, elapsed(), rejections)

    let content: string
    try {
      const reply = await hedged(callModel, remainingMs, hedgeAfterMs)
      if (reply.status !== 200) {
        return fixture(input, `http_${reply.status}`, attempt, calls, elapsed(), rejections)
      }
      content = reply.content
    } catch (err) {
      const reason = err instanceof BudgetExceeded ? 'timeout' : 'network_error'
      return fixture(input, reason, attempt, calls, elapsed(), rejections)
    }

    const validation = validateModelOutput(input, content, model)
    if (validation.ok) {
      return {
        clause: validation.clause,
        fallback_reason: null,
        attempts: attempt,
        calls,
        upstream_ms: elapsed(),
        rejections,
      }
    }
    rejections.push(validation.error)

    messages.push(
      { role: 'assistant', content: content || '(empty reply)' },
      {
        role: 'user',
        content: `That reply was rejected.\n${validation.error}\n\nReturn the corrected JSON object only.`,
      },
    )
  }

  return fixture(input, 'invalid_output', 2, calls, elapsed(), rejections)
}
