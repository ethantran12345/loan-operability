import { Navigate, Route, Routes } from 'react-router-dom'
import { Dryrun } from '@/routes/Dryrun'

export function App() {
  return (
    <Routes>
      {/* The product, and the only screen. It carries its own header and footer: five controls, no nav. */}
      <Route index element={<Dryrun />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
