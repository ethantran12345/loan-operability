import { cn } from '@/lib/cn'
import type { Span } from '@/documents/citations'

export type MarkTone = 'fail' | 'manual' | 'pass' | 'evidence'

const TONES: Record<MarkTone, string> = {
  fail: 'bg-fail-soft text-fail ring-1 ring-fail-rule',
  manual: 'bg-manual-soft text-manual ring-1 ring-manual-rule',
  pass: 'bg-pass-soft text-pass ring-1 ring-pass-rule',
  evidence: 'bg-mark text-ink ring-1 ring-mark-rule',
}

export interface ToneSpan extends Span {
  tone: MarkTone
}

/**
 * A paragraph's exact text with some character ranges marked. `offset` is where
 * the text starts in its document's raw file, the same coordinates spans use.
 */
export function Marked({ text, offset, spans }: { text: string; offset: number; spans: ToneSpan[] }) {
  const inside = spans
    .filter((s) => s.start >= offset && s.end <= offset + text.length)
    .sort((a, b) => a.start - b.start)
  if (inside.length === 0) return <>{text}</>
  const out: React.ReactNode[] = []
  let at = 0
  inside.forEach((s, i) => {
    const from = s.start - offset
    if (from < at) return
    out.push(text.slice(at, from))
    out.push(
      <mark key={i} data-evidence-mark className={cn('rounded-sm box-decoration-clone px-0.5', TONES[s.tone])}>
        {text.slice(from, s.end - offset)}
      </mark>,
    )
    at = s.end - offset
  })
  out.push(text.slice(at))
  return <>{out}</>
}
