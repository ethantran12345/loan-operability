import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { ReviewSessionProvider } from '@/lib/session'
import { Review } from '@/routes/Review'
import { Results } from '@/routes/Results'

export function App() {
  return (
    <ReviewSessionProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Review />} />
          <Route path="results" element={<Results />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ReviewSessionProvider>
  )
}
