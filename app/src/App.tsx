import { Routes, Route, Navigate } from 'react-router'
import { Loader2 } from 'lucide-react'
import { useAuth } from './hooks/useAuth'
import Home from './pages/Home'
import Science from './pages/Science'
import NewsDetail from './pages/NewsDetail'
import Favorites from './pages/Favorites'
import SearchResults from './pages/SearchResults'
import Login from "./pages/Login"
import NotFound from "./pages/NotFound"
import Admin from "./pages/Admin"
import Profile from "./pages/Profile"

/** Private service: every content route requires a valid session. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--color-bg)" }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--color-accent)" }} />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
      <Route path="/science" element={<RequireAuth><Science /></RequireAuth>} />
      <Route path="/news/:id" element={<RequireAuth><NewsDetail /></RequireAuth>} />
      <Route path="/favorites" element={<RequireAuth><Favorites /></RequireAuth>} />
      <Route path="/search" element={<RequireAuth><SearchResults /></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
      <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
