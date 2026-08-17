import { useState } from "react";
import { Link } from "react-router";
import Header from "@/components/Header";
import { trpc } from "@/providers/trpc";
import { Wrench, ArrowRight, Globe } from "lucide-react";
import CategoryFilter from "@/components/CategoryFilter";
import FreshnessFilter, { type FreshnessKey } from "@/components/FreshnessFilter";

export default function InventionTools() {
  const [activeSpheres, setActiveSpheres] = useState<string[]>([]);
  const [freshness, setFreshness] = useState<FreshnessKey>("all");

  const { data: spheresData } = trpc.news.inventionToolSpheres.useQuery();
  const { data: tools, isLoading } = trpc.news.inventionTools.useQuery({
    spheres: activeSpheres.length > 0 ? activeSpheres : undefined,
    limit: 300,
  });

  // Also fetch news articles classified as invention-tools
  const { data: newsData } = trpc.news.list.useQuery({
    section: "invention-tools",
    limit: 300,
  });

  // Merge catalog tools + news articles, deduplicate by title
  const newsItems = (newsData?.items ?? []).map((n) => ({
    id: n.id,
    name: n.title,
    organization: n.source ?? "",
    country: "",
    kind: "news",
    spheres: n.sphereTags ?? [],
    accessStatus: "published",
    description: n.summary ?? "",
    officialUrl: n.originalUrl ?? "",
    docsUrl: "",
    lastVerifiedAt: n.updatedAt,
    updatedAt: n.updatedAt,
    createdAt: n.createdAt,
    _source: "news" as const,
  }));

  const catalogItems = (tools ?? []).map((t) => ({
    ...t,
    _source: "catalog" as const,
  }));

  const allItems = [...catalogItems, ...newsItems];
  const seen = new Set<string>();
  const merged = allItems.filter((item) => {
    const key = item.name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const sphereOptions = (spheresData ?? []).map((s) => ({ slug: s, name: s }));
  const visible = freshness === "all"
    ? merged
    : merged.filter((tool) => {
        const ageMs = Date.now() - new Date(tool.updatedAt).getTime();
        const hours = freshness === "day" ? 24 : freshness === "3days" ? 72 : freshness === "week" ? 168 : 720;
        return ageMs <= hours * 3600_000;
      });
  const total = visible.length;

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
          {total > 0 && (
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {total} инструментов
            </span>
          )}
        </div>

        {/* Sphere filter (like categories in other sections) */}
        {sphereOptions.length > 0 && (
          <div className="mb-4">
            <CategoryFilter
              categories={sphereOptions}
              active={activeSpheres}
              onChange={setActiveSpheres}
            />
          </div>
        )}

        {/* Freshness filter */}
        <div className="mb-5">
          <FreshnessFilter active={freshness} onChange={setFreshness} />
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
            Загрузка…
          </div>
        ) : visible.length > 0 ? (
          <div className="flex flex-col gap-3">
            {visible.map((tool) => (
              <Link
                key={tool.id}
                to={`/tools/${tool.id}`}
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
                      {tool.accessStatus && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{ backgroundColor: "var(--color-search-bg)", color: "var(--color-text-muted)" }}
                        >
                          {tool.accessStatus}
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
                        <span>{new Date(tool.updatedAt).toLocaleDateString("ru-RU")}</span>
                        {tool.organization && (
                          <>
                            <span>·</span>
                            <span className="font-medium" style={{ color: "var(--color-text-body)" }}>{tool.organization}</span>
                          </>
                        )}
                        {tool.country && (
                          <>
                            <span>·</span>
                            <span>{tool.country}</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Only open http(s) URLs — never javascript:/data: etc.
                            if (!/^https?:\/\//i.test(tool.officialUrl)) return;
                            window.open(tool.officialUrl, "_blank", "noopener,noreferrer");
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[13px] font-medium transition-colors hover:underline"
                          style={{
                            color: "var(--color-accent)",
                            backgroundColor: "var(--color-tag-bg)",
                          }}
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
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Wrench className="w-12 h-12 mb-4" style={{ color: "var(--color-border)" }} />
            <p className="text-base font-medium" style={{ color: "var(--color-text-muted)" }}>
              Инструменты появятся здесь позже
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
              Каталог ИИ-инструментов для научных изобретений
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
