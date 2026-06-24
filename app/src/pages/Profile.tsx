import { Navigate, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import Header from "@/components/Header";
import NewsCard from "@/components/NewsCard";
import { User, BookOpen, Star } from "lucide-react";

export default function Profile() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: readStatuses } = trpc.readStatus.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const { data: favCount } = trpc.favorite.count.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const { data: unreadData } = trpc.readStatus.unreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const { data: readHistory } = trpc.news.list.useQuery(
    { limit: 10 },
    { enabled: isAuthenticated }
  );

  const utils = trpc.useUtils();
  const markRead = trpc.readStatus.markRead.useMutation({
    onSuccess: () => utils.readStatus.list.invalidate(),
  });

  if (authLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const readCount = readStatuses?.filter((s) => s.read).length ?? 0;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
      <Header />

      <main className="mx-auto max-w-[900px] px-4 py-6">
        {/* Profile header */}
        <div className="flex items-center gap-4 mb-8">
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="w-16 h-16 rounded-full object-cover" />
          ) : (
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: "var(--color-tag-bg)" }}>
              <User className="w-8 h-8" style={{ color: "var(--color-accent)" }} />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--color-text-heading)", fontFamily: "Manrope, sans-serif" }}>
              {user?.name || "Пользователь"}
            </h1>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {user?.email}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="rounded-xl border p-4 text-center" style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}>
            <BookOpen className="w-6 h-6 mx-auto mb-2" style={{ color: "var(--color-accent)" }} />
            <p className="text-2xl font-bold" style={{ color: "var(--color-text-heading)" }}>{readCount}</p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Прочитано</p>
          </div>
          <div className="rounded-xl border p-4 text-center" style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}>
            <Star className="w-6 h-6 mx-auto mb-2" style={{ color: "var(--color-favorite)" }} />
            <p className="text-2xl font-bold" style={{ color: "var(--color-text-heading)" }}>{favCount?.count ?? 0}</p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>В избранном</p>
          </div>
          <div className="rounded-xl border p-4 text-center" style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}>
            <User className="w-6 h-6 mx-auto mb-2" style={{ color: "var(--color-text-muted)" }} />
            <p className="text-2xl font-bold" style={{ color: "var(--color-text-heading)" }}>{unreadData?.count ?? 0}</p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Непрочитанных</p>
          </div>
        </div>

        {/* Recent articles */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--color-text-heading)" }}>
            Последние статьи
          </h2>
          {readHistory?.items && readHistory.items.length > 0 ? (
            <div className="flex flex-col gap-3">
              {readHistory.items.map((article) => (
                <NewsCard
                  key={article.id}
                  article={article}
                  isRead={readStatuses?.some((s) => s.newsId === article.id && s.read) ?? false}
                  onMarkRead={(id) => markRead.mutate({ newsId: id })}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              Пока нет статей. <Link to="/" style={{ color: "var(--color-accent)" }}>Перейти к ленте</Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
