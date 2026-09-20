import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { ReviewSessionProvider } from '@/lib/session'
import { Review } from '@/routes/Review'
import { Results } from '@/routes/Results'
import { Run } from '@/routes/Run'

export function App() {
  return (
    <ReviewSessionProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Review />} />
          <Route path="results" element={<Results />} />
          {/* The process view. Reached by URL; not in the step nav. */}
          <Route path="run" element={<Run />} />
          <Route path="run/:clauseId" element={<Run />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ReviewSessionProvider>
  )
}
