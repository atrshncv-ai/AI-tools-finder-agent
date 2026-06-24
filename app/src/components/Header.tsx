import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Search, Star, Sun, Moon, LogIn, LogOut, User, Menu, X, CheckCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";

export default function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: favCount } = trpc.favorite.count.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const { data: unreadData } = trpc.readStatus.unreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const markAllRead = trpc.readStatus.markAllRead.useMutation({
    onSuccess: () => {
      utils.readStatus.unreadCount.invalidate();
      utils.readStatus.list.invalidate();
    },
  });

  const utils = trpc.useUtils();

  const unreadCount = unreadData?.count ?? 0;

  const isHome = location.pathname === "/";
  const isScience = location.pathname === "/science";
  const isFavorites = location.pathname === "/favorites";

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setMobileMenuOpen(false);
    }
  };

  const navLinkClass = () =>
    `px-3 py-1.5 text-sm font-medium transition-colors rounded-md`;

  return (
    <header className="sticky top-0 z-50 border-b" style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}>
      <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between px-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <span className="text-lg font-bold tracking-tight" style={{ color: "var(--color-text-heading)", fontFamily: "Manrope, sans-serif" }}>
            ИИ-Агент
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          <Link to="/" className={navLinkClass()} style={{ color: isHome ? "var(--color-accent)" : "var(--color-text-muted)", backgroundColor: isHome ? "var(--color-tag-bg)" : "transparent" }}>
            <span className="flex items-center gap-1.5">
              Лента
              {isAuthenticated && unreadCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: "var(--color-accent)" }}>
                  {unreadCount}
                </span>
              )}
            </span>
          </Link>
          {isAuthenticated && unreadCount > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors"
              style={{ color: "var(--color-text-muted)" }}
              title="Отметить все как прочитанные"
            >
              <CheckCheck className="w-3.5 h-3.5" />
            </button>
          )}
          <Link to="/science" className={navLinkClass()} style={{ color: isScience ? "var(--color-accent)" : "var(--color-text-muted)", backgroundColor: isScience ? "var(--color-tag-bg)" : "transparent" }}>
            ИИ для науки
          </Link>
          {isAuthenticated && (
            <Link to="/favorites" className={navLinkClass()} style={{ color: isFavorites ? "var(--color-accent)" : "var(--color-text-muted)", backgroundColor: isFavorites ? "var(--color-tag-bg)" : "transparent" }}>
              <span className="flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5" />
                Избранное
                {favCount && favCount.count > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: "var(--color-favorite)" }}>
                    {favCount.count}
                  </span>
                )}
              </span>
            </Link>
          )}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Search - desktop */}
          <form onSubmit={handleSearch} className="hidden sm:block">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--color-text-muted)" }} />
              <input
                type="text"
                placeholder="Поиск..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-[180px] lg:w-[240px] rounded-lg border pl-9 pr-3 text-sm outline-none transition-colors focus:border-[var(--color-accent)]"
                style={{ backgroundColor: "var(--color-search-bg)", borderColor: "transparent", color: "var(--color-text-body)" }}
              />
            </div>
          </form>

          {/* Theme toggle */}
          <button onClick={toggleTheme} className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-[var(--color-search-bg)]" style={{ color: "var(--color-text-muted)" }}>
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Auth - desktop */}
          <div className="hidden md:flex items-center gap-2">
            {isAuthenticated ? (
              <>
                <Link to="/profile">
                  {user?.avatar ? (
                    <img src={user.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: "var(--color-tag-bg)" }}>
                      <User className="w-4 h-4" style={{ color: "var(--color-accent)" }} />
                    </div>
                  )}
                </Link>
                <button onClick={logout} className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-[var(--color-search-bg)]" style={{ color: "var(--color-text-muted)" }} title="Выйти">
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <Link to="/login">
                <Button variant="ghost" size="sm" className="gap-1.5" style={{ color: "var(--color-accent)" }}>
                  <LogIn className="w-4 h-4" />
                  <span>Войти</span>
                </Button>
              </Link>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-[var(--color-search-bg)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t" style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}>
          <div className="px-4 py-3 space-y-1">
            {/* Search - mobile */}
            <form onSubmit={handleSearch} className="mb-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--color-text-muted)" }} />
                <input
                  type="text"
                  placeholder="Поиск по новостям..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 rounded-lg border pl-9 pr-3 text-sm outline-none"
                  style={{ backgroundColor: "var(--color-search-bg)", borderColor: "var(--color-border)", color: "var(--color-text-body)" }}
                />
              </div>
            </form>

            <Link to="/" onClick={() => setMobileMenuOpen(false)} className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors" style={{ color: isHome ? "var(--color-accent)" : "var(--color-text-body)", backgroundColor: isHome ? "var(--color-tag-bg)" : "transparent" }}>
              <span>Лента</span>
              {isAuthenticated && unreadCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: "var(--color-accent)" }}>
                  {unreadCount}
                </span>
              )}
            </Link>

            <Link to="/science" onClick={() => setMobileMenuOpen(false)} className="flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors" style={{ color: isScience ? "var(--color-accent)" : "var(--color-text-body)", backgroundColor: isScience ? "var(--color-tag-bg)" : "transparent" }}>
              ИИ для науки
            </Link>

            {isAuthenticated && (
              <Link to="/favorites" onClick={() => setMobileMenuOpen(false)} className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors" style={{ color: isFavorites ? "var(--color-accent)" : "var(--color-text-body)", backgroundColor: isFavorites ? "var(--color-tag-bg)" : "transparent" }}>
                <span className="flex items-center gap-2">
                  <Star className="w-4 h-4" />
                  Избранное
                </span>
                {favCount && favCount.count > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: "var(--color-favorite)" }}>
                    {favCount.count}
                  </span>
                )}
              </Link>
            )}

            <div className="border-t pt-2 mt-2" style={{ borderColor: "var(--color-border)" }}>
              {isAuthenticated ? (
                <button onClick={() => { logout(); setMobileMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg text-sm font-medium" style={{ color: "var(--color-text-body)" }}>
                  <LogOut className="w-4 h-4" />
                  Выйти
                </button>
              ) : (
                <Link to="/login" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium" style={{ color: "var(--color-accent)" }}>
                  <LogIn className="w-4 h-4" />
                  Войти
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
