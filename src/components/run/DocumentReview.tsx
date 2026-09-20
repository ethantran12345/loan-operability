import { FileText, ArrowRight, CheckCircle2, ScanLine } from 'lucide-react'
import type { AgreementClause } from '@/domain/fixtures'
import type { CapabilityGraph, CheckResult } from '@/domain/types'
import { humanize } from '@/lib/format'

export function DocumentReview({ clause, scanning = false }: { clause: AgreementClause; scanning?: boolean }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(14rem,1fr)]">
      <article className="relative overflow-hidden rounded-lg border border-rule bg-sheet shadow-sm">
        <div className="flex items-center gap-2 border-b border-rule bg-accent-soft px-4 py-3 text-sm font-semibold"><FileText className="size-4" /> Credit agreement <span className="ml-auto text-xs font-normal">Draft 7 · p. {clause.source_span.page}</span></div>
        <div className="p-5 sm:p-7">
          <p className="mb-3 text-xs tracking-widest text-ink-faint uppercase">Borrowing terms · §{clause.source_span.section}</p>
          <p className="font-serif text-xl leading-relaxed">{clause.source_text.split(/(EUR [\d,]+|11:00 A\.M\.|9:30 A\.M\.|10:00 A\.M\.|same-day settlement|any Lending Office|London Lending Office|New York Lending Office)/g).map((part, i) => i % 2 ? <mark key={i} className="rounded bg-mark px-1">{part}</mark> : part)}</p>
        </div>
        {scanning && <div aria-hidden className="document-scan pointer-events-none absolute inset-x-0 h-16 border-b-2 border-accent bg-gradient-to-b from-transparent to-accent/15" />}
      </article>
      <div className="flex flex-col justify-center gap-3">
        <p className="text-xs font-semibold tracking-widest text-ink-faint uppercase">Document review</p>
        <div className="flex items-center gap-3 rounded-lg border border-rule bg-sheet p-4"><CheckCircle2 className="size-5 text-pass" /><div><strong className="text-sm">Clause selected</strong><p className="text-xs text-ink-soft">Exact agreement text supplied</p></div></div>
        <ArrowRight aria-hidden className="mx-auto size-5 rotate-90 text-ink-faint" />
        <div className="flex items-center gap-3 rounded-lg border border-accent bg-accent-soft p-4"><ScanLine className="size-5 text-accent" /><div><strong className="text-sm">{scanning ? 'Nemotron is reading' : 'Ready for Nemotron'}</strong><p className="text-xs text-ink-soft">Amount, timing and booking terms</p></div></div>
        <p className="text-xs text-ink-faint">Animated review of supplied clause text. No PDF or OCR scan.</p>
      </div>
    </div>
  )
}

export function DocumentComparison({ clause, graph, checks }: { clause: AgreementClause; graph: CapabilityGraph; checks: CheckResult[] }) {
  const conflicts = checks.filter(check => check.verdict !== 'PASS')
  return <div className="space-y-3">
    <p className="text-sm text-ink-soft">{conflicts.length ? 'These terms do not fit the selected operating route.' : 'Comparing contract terms with the selected operating route…'}</p>
    {conflicts.map((check, i) => {
      const cap = graph.capabilities.find(item => item.capability_id === check.capability_id)
      return <article key={`${check.field}-${i}`} className="overflow-hidden rounded-lg border border-rule bg-sheet">
        <div className="flex items-center justify-between border-b border-rule px-4 py-2"><strong className="text-sm">{humanize(check.field)}</strong><span className={check.verdict === 'FAIL' ? 'text-sm font-semibold text-fail' : 'text-sm font-semibold text-manual'}>{check.verdict === 'FAIL' ? 'Does not fit' : 'Needs review'}</span></div>
        <div className="grid sm:grid-cols-2">
          <div className="border-b border-rule p-4 sm:border-r sm:border-b-0"><p className="flex items-center gap-2 text-xs text-ink-faint"><FileText className="size-4" /> Agreement · §{clause.source_span.section}</p><p className="mt-3 font-serif text-xl"><mark className="rounded bg-fail-soft px-1 text-fail">{check.required}</mark></p></div>
          <div className="p-4"><p className="flex items-center gap-2 text-xs text-ink-faint"><FileText className="size-4" /> Bank capability record · v{graph.version}</p><p className="mt-3 font-serif text-xl"><mark className="rounded bg-pass-soft px-1 text-pass">{check.supported}</mark></p></div>
        </div>
        <p className="border-t border-rule bg-paper/50 px-4 py-2 text-sm">{check.reason}</p>
        <details className="px-4 py-2 text-xs text-ink-soft"><summary className="cursor-pointer">Source evidence</summary><p className="mt-2">{cap ? `${cap.evidence.source} · ${cap.evidence.section} · verified ${cap.evidence.last_verified} · ${cap.capability_id}` : check.capability_id}. Bank values are structured synthetic records, not quotations from an uploaded policy document.</p></details>
      </article>
    })}
  </div>
}
