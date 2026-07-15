import { Link, Navigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import Header from "@/components/Header";
import NewsCard from "@/components/NewsCard";
import { Star, Loader2 } from "lucide-react";

export default function Favorites() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: favorites, isLoading } = trpc.favorite.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const { data: readStatuses } = trpc.readStatus.list.useQuery();

  const utils = trpc.useUtils();
  const markRead = trpc.readStatus.markRead.useMutation({
    onSuccess: () => utils.readStatus.list.invalidate(),
  });

  const readSet = new Set(
    (readStatuses ?? []).filter((s) => s.read).map((s) => s.newsId)
  );

  const handleMarkRead = (newsId: number) => {
    markRead.mutate({ newsId });
  };

  if (authLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
      <Header />

      <main className="mx-auto max-w-[900px] px-4 py-6">
        {/* Page header */}
        <div className="flex items-center gap-3 mb-5">
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ color: "var(--color-text-heading)", fontFamily: "Manrope, sans-serif" }}
          >
            Избранное
          </h1>
          {favorites && favorites.length > 0 && (
            <span
              className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: "var(--color-favorite)" }}
            >
              {favorites.length}
            </span>
          )}
        </div>

        {/* Favorites list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--color-accent)" }} />
          </div>
        ) : favorites && favorites.length > 0 ? (
          <div className="flex flex-col gap-3">
            {favorites.map((fav) => (
              <NewsCard
                key={fav.id}
                // Pass the article's REAL timestamps — never substitute the
                // favorite-stamp (fav.createdAt), or cards display the
                // "added to favorites" time instead of the publication date.
                article={fav.news}
                isRead={readSet.has(fav.newsId)}
                onMarkRead={handleMarkRead}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Star className="w-12 h-12 mb-4" style={{ color: "var(--color-border)" }} />
            <p className="text-base font-medium" style={{ color: "var(--color-text-muted)" }}>
              У вас пока нет сохранённых статей
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
              Нажмите на звёздочку рядом с новостью, чтобы сохранить её
            </p>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium transition-colors hover:underline"
              style={{ color: "var(--color-accent)" }}
            >
              Перейти к ленте
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
