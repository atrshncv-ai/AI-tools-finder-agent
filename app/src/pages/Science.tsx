import { useState, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import Header from "@/components/Header";
import NewsCard from "@/components/NewsCard";
import { NewsListSkeleton } from "@/components/NewsCardSkeleton";
import CategoryFilter from "@/components/CategoryFilter";
import { FlaskConical, Loader2, Wrench, RefreshCw, XCircle, Trophy } from "lucide-react";

const CLASSIFICATION_TYPES = [
  { value: "all", name: "Все типы", icon: null },
  { value: "new_tool", name: "Новые инструменты", icon: Wrench },
  { value: "update", name: "Обновления", icon: RefreshCw },
  { value: "closure", name: "Закрытия", icon: XCircle },
  { value: "achievement", name: "Достижения", icon: Trophy },
];

const PAGE_SIZE = 20;

export default function Science() {
  const [activeFields, setActiveFields] = useState<string[]>([]);
  const [activeType, setActiveType] = useState("all");
  const [offset, setOffset] = useState(0);
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const { data: categoriesData } = trpc.news.categories.useQuery({ type: "science" });

  const scienceFields = [
    { slug: "all", name: "Все направления" },
    ...(categoriesData?.map((c) => ({ slug: c.slug, name: c.name })) ?? []),
  ];

  const { data: newsData, isLoading, isFetching } = trpc.news.list.useQuery(
    {
      isScience: true,
      categorySlug: activeFields.length > 0 ? activeFields : undefined,
      classificationType: activeType === "all" ? undefined : activeType as "new_tool" | "update" | "closure" | "achievement",
      limit: PAGE_SIZE,
      offset,
    }
  );

  const { data: readStatuses } = trpc.readStatus.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const markRead = trpc.readStatus.markRead.useMutation({
    onSuccess: () => {
      utils.readStatus.list.invalidate();
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

  const handleFieldChange = (slugs: string[]) => {
    setActiveFields(slugs);
    setOffset(0);
  };

  const handleTypeChange = (value: string) => {
    setActiveType(value);
    setOffset(0);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
      <Header />

      <main className="mx-auto max-w-[900px] px-4 py-6">
        {/* Page header */}
        <div className="mb-5">
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ color: "var(--color-text-heading)", fontFamily: "Manrope, sans-serif" }}
          >
            ИИ-инструменты для научной работы
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Новые платформы, открытия и достижения ИИ в научной сфере
          </p>
        </div>

        {/* Classification type filter */}
        <div className="flex flex-wrap gap-2 mb-4">
          {CLASSIFICATION_TYPES.map((type) => {
            const Icon = type.icon;
            return (
              <button
                key={type.value}
                onClick={() => handleTypeChange(type.value)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                style={{
                  backgroundColor: activeType === type.value ? "var(--color-tag-bg)" : "transparent",
                  color: activeType === type.value ? "var(--color-accent)" : "var(--color-text-muted)",
                  border: `1px solid ${activeType === type.value ? "var(--color-accent)" : "var(--color-border)"}`,
                }}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {type.name}
              </button>
            );
          })}
        </div>

        {/* Field filter */}
        <div className="mb-5">
          <CategoryFilter
            categories={scienceFields.filter((f) => f.slug !== "all")}
            active={activeFields}
            onChange={handleFieldChange}
          />
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
                />
              ))}
            </div>

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
            <FlaskConical className="w-12 h-12 mb-4" style={{ color: "var(--color-border)" }} />
            <p className="text-base font-medium" style={{ color: "var(--color-text-muted)" }}>
              Научные новости появятся здесь
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
              Мы отслеживаем ИИ-инструменты для химии, материаловедения, биологии и других направлений
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
