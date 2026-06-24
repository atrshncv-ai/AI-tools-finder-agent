import { useSearchParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import Header from "@/components/Header";
import NewsCard from "@/components/NewsCard";
import { Search, Loader2, ArrowLeft } from "lucide-react";

export default function SearchResults() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const { isAuthenticated } = useAuth();

  const { data: searchData, isLoading } = trpc.news.list.useQuery(
    { search: query || undefined },
    { enabled: query.length > 0 }
  );

  const { data: readStatuses } = trpc.readStatus.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

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

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
      <Header />

      <main className="mx-auto max-w-[900px] px-4 py-6">
        {/* Search header */}
        <div className="mb-5">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium mb-4 transition-colors hover:underline"
            style={{ color: "var(--color-accent)" }}
          >
            <ArrowLeft className="w-4 h-4" />
            Назад
          </Link>

          <div className="flex items-center gap-3 mb-2">
            <Search className="w-5 h-5" style={{ color: "var(--color-text-muted)" }} />
            <h1
              className="text-xl font-bold tracking-tight"
              style={{ color: "var(--color-text-heading)", fontFamily: "Manrope, sans-serif" }}
            >
              Результаты поиска
            </h1>
          </div>

          {query && (
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              По запросу «<span className="font-medium" style={{ color: "var(--color-text-body)" }}>{query}</span>»{" "}
              {searchData ? `найдено ${searchData.total}` : "..."}
            </p>
          )}
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--color-accent)" }} />
          </div>
        ) : searchData?.items && searchData.items.length > 0 ? (
          <div className="flex flex-col gap-3">
            {searchData.items.map((article) => (
              <NewsCard
                key={article.id}
                article={article}
                isRead={readSet.has(article.id)}
                onMarkRead={handleMarkRead}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Search className="w-12 h-12 mb-4" style={{ color: "var(--color-border)" }} />
            {query ? (
              <>
                <p className="text-base font-medium" style={{ color: "var(--color-text-muted)" }}>
                  По запросу «{query}» ничего не найдено
                </p>
                <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
                  Попробуйте другие ключевые слова
                </p>
              </>
            ) : (
              <p className="text-base font-medium" style={{ color: "var(--color-text-muted)" }}>
                Введите поисковый запрос
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
