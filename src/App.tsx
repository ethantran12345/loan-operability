import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { ReviewSessionProvider } from '@/lib/session'
import { Review } from '@/routes/Review'
import { Results } from '@/routes/Results'
import { Run } from '@/routes/Run'
import { Workspace } from '@/routes/Workspace'

export function App() {
  return (
    <ReviewSessionProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Workspace />} />
          <Route path="review" element={<Review />} />
          <Route path="results" element={<Results />} />
          {/* The earlier staged process view. Reached by URL only; the workspace replaces it. */}
          <Route path="run" element={<Run />} />
          <Route path="run/:clauseId" element={<Run />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ReviewSessionProvider>
  )
}
