import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Science from './pages/Science'
import NewsDetail from './pages/NewsDetail'
import Favorites from './pages/Favorites'
import SearchResults from './pages/SearchResults'
import Login from "./pages/Login"
import NotFound from "./pages/NotFound"
import Admin from "./pages/Admin"
import Profile from "./pages/Profile"

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/science" element={<Science />} />
      <Route path="/news/:id" element={<NewsDetail />} />
      <Route path="/favorites" element={<Favorites />} />
      <Route path="/search" element={<SearchResults />} />
      <Route path="/login" element={<Login />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
