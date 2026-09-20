import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { ReviewSessionProvider } from '@/lib/session'
import { Dryrun } from '@/routes/Dryrun'
import { Review } from '@/routes/Review'
import { Results } from '@/routes/Results'
import { Run } from '@/routes/Run'
import { Workspace } from '@/routes/Workspace'

export function App() {
  return (
    <ReviewSessionProvider>
      <Routes>
        {/* The product. It carries its own header and footer: five controls, no nav. */}
        <Route index element={<Dryrun />} />
        <Route element={<Layout />}>
          <Route path="workspace" element={<Workspace />} />
          <Route path="review" element={<Review />} />
          <Route path="results" element={<Results />} />
          {/* The staged process view: "Watch the run" in the Demo drawer and the nav. */}
          <Route path="run" element={<Run />} />
          <Route path="run/:clauseId" element={<Run />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ReviewSessionProvider>
  )
}
