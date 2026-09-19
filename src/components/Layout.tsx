import { FlaskConical } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { agreement, capabilityGraph } from '@/domain/fixtures'
import { cn } from '@/lib/cn'
import { useReviewSession } from '@/lib/session'

const STEP =
  'rounded-md px-3 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-ink aria-[current=page]:bg-ink aria-[current=page]:text-sheet'

export function Layout() {
  const { submission } = useReviewSession()

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sheet"
      >
        Skip to content
      </a>

      <header className="border-b border-rule bg-sheet">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
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
        <div className="mx-auto flex max-w-7xl gap-3 px-4 py-2.5 text-sm sm:px-6">
          <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong className="font-semibold">Synthetic data.</strong> {agreement.disclaimer}{' '}
            {capabilityGraph.disclaimer} Nothing here is legal or financial advice.
          </p>
        </div>
      </aside>

      <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  )
}
