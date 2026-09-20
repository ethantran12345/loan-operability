import { FlaskConical } from 'lucide-react'
import { Link, NavLink, Outlet, useMatch } from 'react-router-dom'
import { agreement, capabilityGraph } from '@/domain/fixtures'
import { cn } from '@/lib/cn'
import { useReviewSession } from '@/lib/session'

const STEP =
  'rounded-md px-2.5 py-1 text-xs font-semibold text-ink-soft transition-colors hover:text-ink aria-[current=page]:bg-ink aria-[current=page]:text-sheet'

export function Layout() {
  const { submission } = useReviewSession()
  // The workspace is an application shell: full width, fixed height, panes that
  // scroll on their own. Every other route is an ordinary scrolling page.
  const onWorkspace = useMatch('/') !== null
  const onRun = useMatch('/run/*') !== null
  const frame = onWorkspace ? 'max-w-none' : onRun ? 'max-w-[1400px]' : 'max-w-7xl'

  return (
    <div className={cn(onWorkspace ? 'flex h-dvh flex-col overflow-hidden' : 'min-h-dvh')}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sheet"
      >
        Skip to content
      </a>

      <header className="shrink-0 border-b border-rule bg-sheet">
        <div className={cn('mx-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-3 py-1.5 sm:px-4', frame)}>
          <Link to="/" className="flex items-baseline gap-2.5">
            <span className="text-[0.95rem] font-semibold tracking-tight">Dryrun</span>
            <span className="hidden text-xs text-ink-faint sm:inline">Dry-run the loan before you sign.</span>
          </Link>
          <nav aria-label="Views" className="flex items-center gap-1">
            <NavLink to="/" end className={STEP}>
              Document workspace
            </NavLink>
            <NavLink to="/review" className={STEP}>
              Clause review
            </NavLink>
            {submission ? (
              <NavLink to="/results" className={STEP}>
                Technical results
              </NavLink>
            ) : (
              <span className={cn(STEP, 'cursor-not-allowed opacity-50 hover:text-ink-soft')}>Technical results</span>
            )}
            <NavLink to="/run/credit-agreement-2.03-a" className={STEP}>
              Watch the run
            </NavLink>
          </nav>
        </div>
      </header>

      {/* Synthetic-data disclaimer. Lives in the layout so no route can drop it. */}
      <aside aria-label="Synthetic data notice" className="shrink-0 border-b border-manual-rule bg-manual-soft text-manual">
        <div className={cn('mx-auto flex items-center gap-2 px-3 py-1 text-xs sm:px-4', frame)}>
          <FlaskConical aria-hidden className="size-3.5 shrink-0" />
          <p className={cn(onWorkspace && 'truncate')}>
            <strong className="font-semibold">Synthetic data.</strong> {agreement.disclaimer}{' '}
            {capabilityGraph.disclaimer} Nothing here is legal or financial advice.
          </p>
        </div>
      </aside>

      <main
        id="main"
        className={cn(onWorkspace ? 'min-h-0 flex-1' : cn('mx-auto px-4 sm:px-6', frame, onRun ? 'pb-6' : 'py-6 sm:py-8'))}
      >
        <Outlet />
      </main>
    </div>
  )
}
