import { Link } from "react-router";
import { Star, ArrowRight, Clock, ExternalLink } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import type { News } from "@db/schema";

interface NewsCardProps {
  article: News;
  isRead?: boolean;
  onMarkRead?: (newsId: number) => void;
  showFavorite?: boolean;
}

export default function NewsCard({ article, isRead = false, onMarkRead, showFavorite = true }: NewsCardProps) {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const { data: favCheck } = trpc.favorite.check.useQuery(
    { newsId: article.id },
    { enabled: isAuthenticated }
  );

  const addFav = trpc.favorite.add.useMutation({
    onSuccess: () => {
      utils.favorite.check.invalidate({ newsId: article.id });
      utils.favorite.count.invalidate();
      utils.favorite.list.invalidate();
    },
  });

  const removeFav = trpc.favorite.remove.useMutation({
    onSuccess: () => {
      utils.favorite.check.invalidate({ newsId: article.id });
      utils.favorite.count.invalidate();
      utils.favorite.list.invalidate();
    },
  });

  const isFavorite = favCheck?.isFavorite ?? false;

  const handleFavorite = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) return;
    if (isFavorite) {
      removeFav.mutate({ newsId: article.id });
    } else {
      addFav.mutate({ newsId: article.id });
    }
  };

  const handleClick = () => {
    if (!isRead && onMarkRead) {
      onMarkRead(article.id);
    }
  };

  const tags = article.tags?.split(",").filter(Boolean) ?? [];

  return (
    <Link
      to={`/news/${article.id}`}
      onClick={handleClick}
      className="group block rounded-xl border transition-all duration-200 hover:-translate-y-px"
      style={{
        backgroundColor: "var(--color-card)",
        borderColor: "var(--color-border)",
        boxShadow: "none",
      }}
    >
      <div className="flex">
        <div
          className="w-[3px] rounded-l-xl shrink-0 transition-opacity duration-300"
          style={{
            backgroundColor: isRead ? "transparent" : "var(--color-accent)",
            opacity: isRead ? 0 : 1,
          }}
        />
        <div className="flex-1 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {((article as any).categoryName || article.categorySlug) && (
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wider"
                  style={{
                    backgroundColor: "var(--color-tag-bg)",
                    color: "var(--color-tag-text)",
                  }}
                >
                  {(article as any).categoryName || article.categorySlug}
                </span>
              )}
              {tags.slice(0, 2).map((tag) => {
                const isTestTag = tag.trim() === "ТестГемма1поток";
                return (
                  <span
                    key={tag}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                    style={{
                      backgroundColor: isTestTag ? "rgba(34, 197, 94, 0.15)" : "var(--color-search-bg)",
                      color: isTestTag ? "#16a34a" : "var(--color-text-muted)",
                    }}
                  >
                    {tag.trim()}
                  </span>
                );
              })}
            </div>
            {showFavorite && isAuthenticated && (
              <button
                onClick={handleFavorite}
                className="shrink-0 p-1 rounded-md transition-all duration-150 hover:scale-110"
                title={isFavorite ? "Удалить из избранного" : "В избранное"}
              >
                <Star
                  className="w-5 h-5 transition-colors"
                  style={{
                    color: isFavorite ? "var(--color-favorite)" : "var(--color-border)",
                    fill: isFavorite ? "var(--color-favorite)" : "none",
                  }}
                />
              </button>
            )}
          </div>

          <span className="mt-3 text-base leading-snug transition-colors block">
            {article.title}
          </span>

          <p
            className="mt-2 text-sm leading-relaxed line-clamp-3"
            style={{ color: "var(--color-text-body)" }}
          >
            {article.summary}
          </p>

          <div className="flex items-center justify-between mt-4 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
            <div className="flex items-center gap-2">
              <span>{new Date(article.publishedAt).toLocaleDateString("ru-RU")}</span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {Math.max(1, Math.ceil((article.summary?.length || 0) / 1000))} мин чтения
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // Only open http(s) URLs — never javascript:/data: etc.
                  if (!/^https?:\/\//i.test(article.originalUrl)) return;
                  window.open(article.originalUrl, "_blank", "noopener,noreferrer");
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[13px] font-medium transition-colors hover:underline"
                style={{
                  color: "var(--color-accent)",
                  backgroundColor: "var(--color-tag-bg)",
                }}
                title="Открыть оригинальную статью в новой вкладке"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Перейти к источнику
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
  );
}
