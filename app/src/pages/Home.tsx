import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import Header from "@/components/Header";
import NewsCard from "@/components/NewsCard";
import { NewsListSkeleton } from "@/components/NewsCardSkeleton";
import CategoryFilter from "@/components/CategoryFilter";
import { Newspaper, Loader2 } from "lucide-react";
import { getSectionQuery } from "@/lib/sectionFilters";
import FreshnessFilter, { type FreshnessKey } from "@/components/FreshnessFilter";
import { useUnreadCounts } from "@/hooks/useUnreadCounts";

const PAGE_SIZE = 20;

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategories = (searchParams.get("categories") ?? "").split(",").filter(Boolean);
  const freshnessParam = searchParams.get("freshness") as FreshnessKey | null;
  const freshness: FreshnessKey = freshnessParam && ["all", "day", "3days", "week", "month"].includes(freshnessParam)
    ? freshnessParam
    : "all";
  const [offset, setOffset] = useState(0);
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const unreadCounts = useUnreadCounts();

  const { data: newsData, isLoading, isFetching } = trpc.news.list.useQuery(
    {
      ...getSectionQuery("ai-news"),
      categorySlug: activeCategories.length > 0 ? activeCategories : undefined,
      freshness: freshness === "all" ? undefined : freshness,
      limit: PAGE_SIZE,
      offset,
    }
  );

  const { data: categoriesData } = trpc.news.categories.useQuery({ type: "general" });

  const { data: readStatuses } = trpc.readStatus.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const markRead = trpc.readStatus.markRead.useMutation({
    onSuccess: () => {
      utils.readStatus.list.invalidate();
      utils.readStatus.unreadCountBySection.invalidate();
    },
  });

  const readSet = new Set(
    (readStatuses ?? []).filter((s) => s.read).map((s) => s.newsId)
  );

  const handleMarkRead = (newsId: number) => {
    if (isAuthenticated) {
      markRead.mutate({ newsId });
    }
  };

  const items = newsData?.items ?? [];
  const total = newsData?.total ?? 0;
  const hasMore = offset + PAGE_SIZE < total;

  const loadMore = useCallback(() => {
    if (hasMore && !isFetching) {
      setOffset((prev) => prev + PAGE_SIZE);
    }
  }, [hasMore, isFetching]);

  const sentinelRef = useInfiniteScroll(loadMore, hasMore, isFetching && offset > 0);

  const unreadCount = unreadCounts.aiNews;

  const handleCategoryChange = (slugs: string[]) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (slugs.length > 0) next.set("categories", slugs.join(","));
      else next.delete("categories");
      return next;
    });
    setOffset(0);
  };

  const handleFreshnessChange = (key: FreshnessKey) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (key === "all") next.delete("freshness");
      else next.set("freshness", key);
      return next;
    });
    setOffset(0);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
      <Header />

      <main className="mx-auto max-w-[900px] px-4 py-6">
        {/* Page header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="flex items-center gap-3">
              <h1
                className="text-2xl font-bold tracking-tight"
                style={{ color: "var(--color-text-heading)", fontFamily: "Manrope, sans-serif" }}
              >
                ИИ-новости
              </h1>
              {isAuthenticated && unreadCount > 0 && (
                <span
                className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: "var(--color-accent)" }}
              >
                {unreadCount}
              </span>
            )}
          </div>
          {!isAuthenticated && (
            <button
              onClick={() => navigate("/login")}
              className="text-sm font-medium transition-colors hover:underline"
              style={{ color: "var(--color-accent)" }}
            >
              Войдите, чтобы отслеживать непрочитанные
            </button>
          )}
          </div>
          {total > 0 && (
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {total} статей
            </span>
          )}
        </div>

        {/* Category filter */}
        {categoriesData && categoriesData.length > 0 && (
          <div className="mb-4">
            <CategoryFilter
              categories={categoriesData.map((c) => ({ slug: c.slug, name: c.name }))}
              active={activeCategories}
              onChange={handleCategoryChange}
            />
          </div>
        )}

        {/* Freshness filter */}
        <div className="mb-5">
          <FreshnessFilter active={freshness} onChange={handleFreshnessChange} />
        </div>

        {/* News list */}
        {isLoading ? (
          <NewsListSkeleton count={5} />
        ) : items.length > 0 ? (
          <>
            <div className="flex flex-col gap-3">
              {items.map((article) => (
                <NewsCard
                  key={article.id}
                  article={article}
                  isRead={readSet.has(article.id)}
                  onMarkRead={handleMarkRead}
                  returnQuery={searchParams.toString()}
                />
              ))}
            </div>

            {/* Infinite scroll sentinel */}
            {hasMore && (
              <div ref={sentinelRef} className="flex items-center justify-center py-8">
                {isFetching && (
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-accent)" }} />
                )}
              </div>
            )}

            {!hasMore && items.length > 0 && (
              <p className="text-center text-sm py-6" style={{ color: "var(--color-text-muted)" }}>
                Показано все {total} новостей
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Newspaper className="w-12 h-12 mb-4" style={{ color: "var(--color-border)" }} />
            <p className="text-base font-medium" style={{ color: "var(--color-text-muted)" }}>
              Новости появятся здесь утром
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
              Каждый день мы собираем свежие новости об ИИ со всего мира
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
