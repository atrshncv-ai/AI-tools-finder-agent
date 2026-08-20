import { useSearchParams } from "react-router";
import { Link } from "react-router";
import { useState, useCallback } from "react";
import Header from "@/components/Header";
import NewsCard from "@/components/NewsCard";
import { trpc } from "@/providers/trpc";
import { Wrench, ArrowRight, Globe, Newspaper, Loader2 } from "lucide-react";
import CategoryFilter from "@/components/CategoryFilter";
import { SPHERE_NAMES } from "@/lib/sphereNames";
import FreshnessFilter, { type FreshnessKey } from "@/components/FreshnessFilter";
import {
  inventionToolFreshnessDate,
  sortInventionTools,
} from "@/lib/inventionTools";
import { withSearchParams } from "@/lib/detailNavigation";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";

const PAGE_SIZE = 20;

/**
 * Inventions section = news with section "invention-tools" (the same rows
 * shown in the digest), followed by the verified tool catalog. The freshness
 * filter and counters reflect the REAL number of news items in the selected
 * period — the catalog below is a stable reference list, not part of the
 * daily counters.
 */
export default function InventionTools() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSpheres = (searchParams.get("spheres") ?? "").split(",").filter(Boolean);
  const freshnessParam = searchParams.get("freshness") as FreshnessKey | null;
  const freshness: FreshnessKey = freshnessParam && ["all", "day", "3days", "week", "month"].includes(freshnessParam)
    ? freshnessParam
    : "all";
  const [offset, setOffset] = useState(0);

  // News rows of the invention-tools section (same source as the digest).
  const { data: newsData, isLoading: newsLoading, isFetching } = trpc.news.list.useQuery({
    section: "invention-tools",
    categorySlug: activeSpheres.length > 0 ? activeSpheres : undefined,
    freshness: freshness === "all" ? undefined : freshness,
    limit: PAGE_SIZE,
    offset,
  });

  const newsItems = newsData?.items ?? [];
  const newsTotal = newsData?.total ?? 0;
  const hasMore = offset + PAGE_SIZE < newsTotal;

  const loadMore = useCallback(() => {
    if (hasMore && !isFetching) setOffset((prev) => prev + PAGE_SIZE);
  }, [hasMore, isFetching]);

  const sentinelRef = useInfiniteScroll(loadMore, hasMore, isFetching && offset > 0);

  // Verified tool catalog — below the news feed, always complete.
  const { data: spheresData } = trpc.news.inventionToolSpheres.useQuery();
  const { data: tools, isLoading: toolsLoading } = trpc.news.inventionTools.useQuery({
    spheres: activeSpheres.length > 0 ? activeSpheres : undefined,
    limit: 300,
  });

  const catalogItems = sortInventionTools(tools ?? []);
  const sphereOptions = (spheresData ?? []).map((s) => ({ slug: s, name: SPHERE_NAMES[s] || s }));
  const catalogVisible = activeSpheres.length > 0 ? catalogItems : catalogItems;
  const catalogCount = catalogVisible.length;

  const updateFilter = (key: "spheres" | "freshness", value: string | string[]) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const serialized = Array.isArray(value) ? value.join(",") : value;
      if (!serialized || serialized === "all") next.delete(key);
      else next.set(key, serialized);
      return next;
    });
    setOffset(0);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
      <Header />
      <main className="mx-auto max-w-[900px] px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--color-text-heading)", fontFamily: "Manrope, sans-serif" }}>
              Инструменты для изобретений
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
              ИИ для создания материалов, молекул и научных открытий
            </p>
          </div>
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {newsTotal} {pluralNews(newsTotal)}
          </span>
        </div>

        {/* Sphere filter (like categories in other sections) */}
        {sphereOptions.length > 0 && (
          <div className="mb-4">
            <CategoryFilter
              categories={sphereOptions}
              active={activeSpheres}
              onChange={(slugs) => updateFilter("spheres", slugs)}
            />
          </div>
        )}

        {/* Freshness filter */}
        <div className="mb-5">
          <FreshnessFilter active={freshness} onChange={(key) => updateFilter("freshness", key)} />
        </div>

        {/* News feed of the invention-tools section */}
        {newsLoading ? (
          <div className="py-16 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
            Загрузка…
          </div>
        ) : newsItems.length > 0 ? (
          <div className="flex flex-col gap-3">
            {newsItems.map((article) => (
              <NewsCard
                key={article.id}
                article={article}
                returnQuery={searchParams.toString()}
              />
            ))}
            {hasMore && (
              <div ref={sentinelRef} className="flex items-center justify-center py-8">
                {isFetching && <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-accent)" }} />}
              </div>
            )}
            {!hasMore && newsItems.length > 0 && (
              <p className="text-center text-sm py-6" style={{ color: "var(--color-text-muted)" }}>
                Показано все {newsTotal} новостей
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <Newspaper className="w-12 h-12 mb-4" style={{ color: "var(--color-border)" }} />
            <p className="text-base font-medium" style={{ color: "var(--color-text-muted)" }}>
              Новости этой секции появятся здесь
            </p>
          </div>
        )}

        {/* Verified tool catalog — stable reference list below the feed */}
        {toolsLoading ? (
          <div className="py-10 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
            Загрузка каталога…
          </div>
        ) : catalogItems.length > 0 ? (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold" style={{ color: "var(--color-text-heading)" }}>
                Каталог проверенных инструментов
              </h2>
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                {catalogCount} инструментов
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {catalogItems.map((tool) => (
                <Link
                  key={tool.id}
                  to={withSearchParams(`/tools/${tool.id}`, searchParams.toString())}
                  className="group block rounded-xl border transition-all duration-200 hover:-translate-y-px"
                  style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
                >
                  <div className="flex">
                    <div
                      className="w-[3px] rounded-l-xl shrink-0 transition-opacity duration-300"
                      style={{ backgroundColor: "var(--color-accent)" }}
                    />
                    <div className="flex-1 p-5">
                      <div className="flex flex-wrap gap-1.5">
                        {tool.kind && (
                          <span
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wider"
                            style={{ backgroundColor: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}
                          >
                            <Wrench className="w-3 h-3 mr-1" />
                            {tool.kind}
                          </span>
                        )}
                        {tool.spheres.slice(0, 2).map((sphere: string) => (
                          <span
                            key={sphere}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                            style={{ backgroundColor: "var(--color-search-bg)", color: "var(--color-text-muted)" }}
                          >
                            {sphere}
                          </span>
                        ))}
                      </div>

                      <span className="mt-3 text-base leading-snug transition-colors block">
                        {tool.name}
                      </span>

                      <p
                        className="mt-2 text-sm leading-relaxed line-clamp-3"
                        style={{ color: "var(--color-text-body)" }}
                      >
                        {tool.description}
                      </p>

                      <div className="flex items-center justify-between mt-4 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                        <div className="flex items-center gap-2">
                          <span>
                            {inventionToolFreshnessDate(tool).toLocaleDateString("ru-RU")}
                          </span>
                          {tool.organization && (
                            <>
                              <span>·</span>
                              <span className="font-medium" style={{ color: "var(--color-text-body)" }}>{tool.organization}</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!/^https?:\/\//i.test(tool.officialUrl)) return;
                              window.open(tool.officialUrl, "_blank", "noopener,noreferrer");
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[13px] font-medium transition-colors hover:underline"
                            style={{ color: "var(--color-accent)", backgroundColor: "var(--color-tag-bg)" }}
                            title="Открыть официальный сайт в новой вкладке"
                          >
                            <Globe className="w-3.5 h-3.5" />
                            Сайт
                          </button>
                          <span
                            className="flex items-center gap-1 text-[13px] font-medium transition-colors group-hover:underline"
                            style={{ color: "var(--color-accent)" }}
                          >
                            Подробнее
                            <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function pluralNews(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "новость";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "новости";
  return "новостей";
}