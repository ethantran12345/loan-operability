/**
 * Timezone handling with no date library. The only thing we need is: what is the
 * UTC offset of an IANA zone at a given instant. Intl knows this, including DST,
 * so the answer is real rather than a hardcoded offset table.
 */

export function tzOffsetMinutes(timeZone: string, atISO: string): number {
  const at = new Date(atISO)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(at)) if (p.type !== 'literal') parts[p.type] = p.value
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return Math.round((asUTC - at.getTime()) / 60000)
}

/** "09:30" -> 570 minutes past midnight. */
export function parseClock(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

export function formatClock(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Express a wall-clock time in one zone as the equivalent wall clock in another.
 * Returns minutes past midnight in the target zone (may cross a day boundary,
 * which the caller reads as "later than any cutoff").
 */
export function convertClock(
  minutes: number,
  fromTz: string,
  toTz: string,
  atISO: string,
): number {
  const from = tzOffsetMinutes(fromTz, atISO)
  const to = tzOffsetMinutes(toTz, atISO)
  return minutes - from + to
}

export function isEffectiveAt(
  effectiveFrom: string,
  effectiveTo: string | null,
  atISO: string,
): boolean {
  const t = new Date(atISO).getTime()
  if (t < new Date(effectiveFrom).getTime()) return false
  if (effectiveTo && t > new Date(effectiveTo).getTime()) return false
  return true
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.floor((new Date(toISO).getTime() - new Date(fromISO).getTime()) / 86400000)
}
