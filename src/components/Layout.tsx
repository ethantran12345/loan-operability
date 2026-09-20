import { FlaskConical } from 'lucide-react'
import { Link, NavLink, Outlet, useMatch } from 'react-router-dom'
import { agreement, capabilityGraph } from '@/domain/fixtures'
import { cn } from '@/lib/cn'
import { useReviewSession } from '@/lib/session'

const STEP =
  'rounded-md px-3 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-ink aria-[current=page]:bg-ink aria-[current=page]:text-sheet'

export function Layout() {
  const { submission } = useReviewSession()
  // The process view is recorded at 16:9: a wider frame, and the notice as one line.
  const onRun = useMatch('/run/*') !== null
  const frame = onRun ? 'max-w-[1400px]' : 'max-w-7xl'

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sheet"
      >
        Skip to content
      </a>

      <header className="border-b border-rule bg-sheet">
        <div className={cn('mx-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 sm:px-6', frame, onRun ? 'py-2' : 'py-3')}>
          <Link to="/" className="flex items-baseline gap-3">
            <span className="font-serif text-xl font-semibold tracking-tight">Loan Operability</span>
            <span className="hidden text-sm text-ink-faint sm:inline">
              Pre-signing compatibility test
            </span>
          </Link>
          <nav aria-label="Steps" className="flex items-center gap-1">
            <NavLink to="/" end className={STEP}>
              1. Review clause
            </NavLink>
            {submission ? (
              <NavLink to="/results" className={STEP}>
                2. Operability result
              </NavLink>
            ) : (
              <span className={cn(STEP, 'cursor-not-allowed opacity-50 hover:text-ink-soft')}>
                2. Operability result
              </span>
            )}
          </nav>
        </div>
      </header>

      {/* Synthetic-data disclaimer. Lives in the layout so no route can drop it. */}
      <aside
        aria-label="Synthetic data notice"
        className="border-b border-manual-rule bg-manual-soft text-manual"
      >
        <div className={cn('mx-auto flex gap-3 px-4 sm:px-6', frame, onRun ? 'items-center py-1 text-xs' : 'py-2.5 text-sm')}>
          <FlaskConical aria-hidden className={cn('size-4 shrink-0', !onRun && 'mt-0.5')} />
          <p className={cn(onRun && 'truncate')}>
            <strong className="font-semibold">Synthetic data.</strong> {agreement.disclaimer}{' '}
            {capabilityGraph.disclaimer} Nothing here is legal or financial advice.
          </p>
        </div>
      </aside>

      <main id="main" className={cn('mx-auto px-4 sm:px-6', frame, onRun ? 'pb-6' : 'py-6 sm:py-8')}>
        <Outlet />
      </main>
    </div>
  )
}
