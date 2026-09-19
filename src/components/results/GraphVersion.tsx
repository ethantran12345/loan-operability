import { capabilityGraphs } from '@/domain/fixtures'
import { cn } from '@/lib/cn'
import type { CapabilityGraph } from '@/domain/types'

export const GRAPH_VERSIONS = Object.keys(capabilityGraphs)
  .map(Number)
  .sort((a, b) => a - b)

/**
 * The graph's own note for one version, split into its "v7 (2026-09-09)" label
 * and the sentence after it. The changelog lives in the fixture, not in the
 * CapabilityGraph type, so it is read defensively.
 */
export function changelogEntry(graph: CapabilityGraph): { label: string; text: string } {
  const entries = (graph as CapabilityGraph & { changelog?: string[] }).changelog ?? []
  const entry = entries.find((e) => e.startsWith(`v${graph.version} `))
  const split = entry?.indexOf(':') ?? -1
  if (!entry || split < 0) return { label: `v${graph.version}`, text: '' }
  return { label: entry.slice(0, split), text: entry.slice(split + 1).trim() }
}

/** Which version of the bank the clause is tested against. Switching never re-extracts. */
export function GraphVersionSelector({
  version,
  onChange,
}: {
  version: number
  onChange: (version: number) => void
}) {
  const selected = capabilityGraphs[version]
  return (
    <div className="mt-6 rounded-lg border border-rule bg-sheet px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span id="graph-version-label" className="text-sm font-semibold">
          Capability graph
        </span>
        <div
          role="radiogroup"
          aria-labelledby="graph-version-label"
          className="inline-flex rounded-md border border-rule bg-rule-soft p-0.5"
        >
          {GRAPH_VERSIONS.map((v) => {
            const active = v === version
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(v)}
                className={cn(
                  'min-h-9 rounded px-3 text-sm font-semibold transition-colors',
                  active ? 'bg-sheet text-ink shadow-sm' : 'text-ink-soft hover:text-ink',
                )}
              >
                {changelogEntry(capabilityGraphs[v]!).label}
              </button>
            )
          })}
        </div>
      </div>
      {selected && (
        <p aria-live="polite" className="mt-2 text-sm text-ink-soft">
          <span className="font-medium text-ink">What changed in the bank:</span>{' '}
          {changelogEntry(selected).text}
        </p>
      )}
      <p className="mt-1 text-xs text-ink-faint">
        Switching re-runs the evaluator on the same extracted clause. Nothing is re-extracted and
        no model is called.
      </p>
    </div>
  )
}
