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

import { cachedExtraction } from '../domain/fixtures.js'
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
  | 'network_error'
  | 'invalid_output'
  | `http_${number}`

export interface ExtractOutcome {
  clause: ExtractedClause
  fallback_reason: FallbackReason | null
  /** Live model calls made. 0 when no key was configured. */
  attempts: number
}

export interface ExtractDeps {
  apiKey: string | undefined
  fetch: typeof fetch
  model?: string
  timeoutMs?: number
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

const SYSTEM_PROMPT = `detailed thinking off

You convert ONE clause of a loan agreement into structured operational requirements.
Reply with a single JSON object and nothing else: no prose, no markdown, no code fence.

Rules
1. Extract only what the clause itself says. Never use outside knowledge, market convention, or what is "usually" meant.
2. When the clause is silent on a field, set that field to null (or "unspecified" where the enum offers it). Never fill a gap with a likely value.
3. Every silence or undefined term that an operations team would need resolved goes in "ambiguities" as one plain sentence each. If nothing is unclear, use [].
4. Timezone: set "timezone" to an IANA zone ONLY when the clause names a place or zone for the time (for example "London time"). A bare clock time such as "11:00 A.M." has timezone null, and the missing timezone must be listed in "ambiguities". Do not infer a zone from the currency, the parties, or the lending office.
5. "any Lending Office" means booking_entity "any_lending_office". A single named office is its lowercase city, for example "london".
6. Clock times are 24-hour "HH:MM". Amounts are plain numbers with no separators.
7. "confidence" is your own 0 to 1 confidence that the requirement matches the clause text.

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
      "required_fields": ["facility_id" | "amount" | "currency" | "value_date" | other snake_case names] | null,
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

  return { ok: true, clause: result.data }
}

function fixture(
  input: ExtractRequest,
  fallback_reason: FallbackReason,
  attempts: number,
): ExtractOutcome {
  return {
    clause: { ...cachedExtraction(input.clause_id), extraction_source: 'fixture' },
    fallback_reason,
    attempts,
  }
}

/**
 * Extract a clause. One live call, one retry with the validation error fed back,
 * then the cached fixture. Any network or auth failure goes straight to the
 * fixture: retrying a 401 only delays the demo.
 *
 * Throws only when the fixture itself is missing (an unknown clause_id).
 */
export async function extractClause(
  input: ExtractRequest,
  deps: ExtractDeps,
): Promise<ExtractOutcome> {
  if (!deps.apiKey) return fixture(input, 'no_api_key', 0)

  const model = deps.model ?? DEFAULT_MODEL
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt(input) },
  ]

  for (let attempt = 1; attempt <= 2; attempt++) {
    let content: string
    try {
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
        signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
      })
      if (!res.ok) return fixture(input, `http_${res.status}`, attempt)
      const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
      const raw = body.choices?.[0]?.message?.content
      content = typeof raw === 'string' ? raw : ''
    } catch {
      return fixture(input, 'network_error', attempt)
    }

    const validation = validateModelOutput(input, content, model)
    if (validation.ok) return { clause: validation.clause, fallback_reason: null, attempts: attempt }

    messages.push(
      { role: 'assistant', content: content || '(empty reply)' },
      {
        role: 'user',
        content: `That reply was rejected.\n${validation.error}\n\nReturn the corrected JSON object only.`,
      },
    )
  }

  return fixture(input, 'invalid_output', 2)
}
