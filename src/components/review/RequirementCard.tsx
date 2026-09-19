import { useId, type ReactNode } from 'react'
import { AlertTriangle, PencilLine, RotateCcw } from 'lucide-react'
import { Badge, Id } from '@/components/ui/badge'
import { OPERATOR_WORDS, businessDays, humanize, money } from '@/lib/format'
import type { Requirement } from '@/domain/types'

const SETTLEMENT: Record<string, string> = { same_day: 'Same day', t_plus_1: 'T+1' }

function Silent() {
  return <span className="text-ink-faint italic">Not stated in the clause</span>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-x-4 gap-y-1 border-t border-rule-soft py-2.5 first:border-t-0 sm:grid-cols-[10rem_1fr]">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="min-w-0 text-sm font-medium">{children}</dd>
    </div>
  )
}

/** The reviewer's typed amount, or null when it is not a usable number. */
export function parseAmountDraft(draft: string | undefined): number | null {
  if (draft === undefined || draft.trim() === '') return null
  const n = Number(draft.replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

interface Props {
  requirement: Requirement
  amountDraft: string | undefined
  onAmountDraft: (value: string | null) => void
}

export function RequirementCard({ requirement: r, amountDraft, onAmountDraft }: Props) {
  const amountId = useId()
  const errorId = useId()
  const t = r.timing
  const edited = amountDraft !== undefined
  const parsed = parseAmountDraft(amountDraft)
  const invalid = edited && parsed === null
  const changed = edited && parsed !== null && r.amount !== null && parsed !== r.amount.value
  const pct = Math.round(r.confidence * 100)

  return (
    <article className="rounded-lg border border-rule bg-sheet">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-soft px-4 py-3">
        <div className="flex items-center gap-2">
          <Id>{r.requirement_id}</Id>
          <Badge tone={r.mandatory ? 'accent' : 'neutral'}>
            {r.mandatory ? 'Mandatory' : 'Optional'}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-soft">Extraction confidence</span>
          <span
            role="meter"
            aria-label="Extraction confidence"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-1.5 w-20 overflow-hidden rounded-full bg-rule-soft"
          >
            <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </span>
          <span className="font-semibold tabular-nums">{pct}%</span>
        </div>
      </header>

      {/* Ambiguities lead the card. A silence in the clause is a finding, not a footnote. */}
      {r.ambiguities.length > 0 ? (
        <section
          aria-label="Ambiguities in this clause"
          className="border-b border-manual-rule bg-manual-soft px-4 py-3 text-manual"
        >
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle aria-hidden className="size-4" />
            {r.ambiguities.length === 1
              ? '1 ambiguity the clause leaves open'
              : `${r.ambiguities.length} ambiguities the clause leaves open`}
          </h4>
          <ul className="mt-1.5 list-disc space-y-1 pl-6 text-sm">
            {r.ambiguities.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="border-b border-rule-soft px-4 py-2.5 text-sm text-ink-soft">
          No ambiguities were reported for this requirement.
        </p>
      )}

      <dl className="px-4 py-1.5">
        <Row label="Operation">
          {humanize(r.operation)} <Id className="ml-1">{r.operation}</Id>
        </Row>
        <Row label="Currency">{r.currency ?? <Silent />}</Row>

        <Row label="Amount">
          {r.amount === null ? (
            <Silent />
          ) : (
            <div className="space-y-1.5">
              <label htmlFor={amountId} className="flex items-start gap-1.5 text-xs font-normal text-ink-soft">
                <PencilLine aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                Limit is {OPERATOR_WORDS[r.amount.operator]} this amount in {r.amount.unit}. Correct it
                if the extraction is wrong.
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={amountId}
                  inputMode="numeric"
                  autoComplete="off"
                  value={amountDraft ?? String(r.amount.value)}
                  onChange={(e) => onAmountDraft(e.target.value)}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? errorId : undefined}
                  className="min-h-11 w-44 rounded-md border border-rule bg-white px-3 font-mono text-sm tabular-nums aria-[invalid=true]:border-fail"
                />
                <span className="text-sm text-ink-soft">
                  {parsed !== null ? money(parsed, r.amount.unit) : money(r.amount.value, r.amount.unit)}
                </span>
              </div>
              {invalid && (
                <p id={errorId} className="text-xs font-medium text-fail">
                  Enter a non-negative number, for example {r.amount.value}.
                </p>
              )}
              {changed && (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
                  <Badge tone="accent">Edited by reviewer</Badge>
                  <span>Extracted value was {money(r.amount.value, r.amount.unit)}.</span>
                  <button
                    type="button"
                    onClick={() => onAmountDraft(null)}
                    className="inline-flex min-h-6 items-center gap-1 font-semibold text-accent underline underline-offset-2"
                  >
                    <RotateCcw aria-hidden className="size-3" />
                    Restore
                  </button>
                </p>
              )}
            </div>
          )}
        </Row>

        <Row label="Settlement">
          {t && SETTLEMENT[t.settlement] ? SETTLEMENT[t.settlement] : <Silent />}
        </Row>
        <Row label="Notice cutoff">{t?.notice_cutoff ?? <Silent />}</Row>
        <Row label="Cutoff timezone">{t?.timezone ?? <Silent />}</Row>
        <Row label="Advance notice">
          {t?.notice_lead_business_days != null ? (
            businessDays(t.notice_lead_business_days)
          ) : (
            <Silent />
          )}
        </Row>
        <Row label="Service level">
          {t?.service_level_business_days != null ? (
            businessDays(t.service_level_business_days)
          ) : (
            <Silent />
          )}
        </Row>
        <Row label="Booking entity">
          {r.booking_entity === null ? (
            <Silent />
          ) : (
            <>
              {humanize(r.booking_entity)}
              {r.booking_entity === 'any_lending_office' && (
                <span className="block text-xs font-normal text-ink-soft">
                  A promise of every lending office, not a free choice for the bank.
                </span>
              )}
            </>
          )}
        </Row>
        <Row label="Notice channel">
          {r.notice_channel && r.notice_channel !== 'unspecified' ? (
            humanize(r.notice_channel)
          ) : (
            <Silent />
          )}
        </Row>
        <Row label="Notice must specify">
          {r.required_fields ? (
            <ul className="flex flex-wrap gap-1.5">
              {r.required_fields.map((f) => (
                <li key={f}>
                  <Id>{f}</Id>
                </li>
              ))}
            </ul>
          ) : (
            <Silent />
          )}
        </Row>
        <Row label="Interest">
          {r.interest ? (
            <span>
              {r.interest.benchmark}, {r.interest.method}
              {r.interest.day_count && `, ${r.interest.day_count}`}
              {r.interest.observation_shift_days != null &&
                `, ${r.interest.observation_shift_days}-day observation shift`}
              {r.interest.floor_bps != null && `, floor ${r.interest.floor_bps} bps`}
            </span>
          ) : (
            <Silent />
          )}
        </Row>
        <Row label="Fee">
          {r.fee ? (
            <span>
              {r.fee.basis}, {r.fee.recipients} recipient{r.fee.recipients === 1 ? '' : 's'},{' '}
              {r.fee.currencies.join(' / ')}
              {r.fee.recalculation_frequency && `, recalculated ${r.fee.recalculation_frequency}`}
            </span>
          ) : (
            <Silent />
          )}
        </Row>
      </dl>
    </article>
  )
}
