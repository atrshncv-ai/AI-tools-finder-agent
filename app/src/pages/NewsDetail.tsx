import { useParams, Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import Header from "@/components/Header";
import {
  ArrowLeft,
  Star,
  ExternalLink,
  Calendar,
  Tag,
  Loader2,
  FileText,
  Share2,
  Sun,
  Moon,
  Maximize2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTheme } from "@/hooks/useTheme";

export default function NewsDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const newsId = Number(id);
  const { isAuthenticated } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [readingMode, setReadingMode] = useState(false);

  const { data: article, isLoading } = trpc.news.byId.useQuery(
    { id: newsId },
    { enabled: !isNaN(newsId) }
  );

  const { data: favCheck } = trpc.favorite.check.useQuery(
    { newsId },
    { enabled: isAuthenticated && !isNaN(newsId) }
  );

  const { data: readStatuses } = trpc.readStatus.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const utils = trpc.useUtils();

  const markRead = trpc.readStatus.markRead.useMutation({
    onSuccess: () => {
      utils.readStatus.list.invalidate();
      utils.readStatus.unreadCount.invalidate();
    },
  });

  const addFav = trpc.favorite.add.useMutation({
    onSuccess: () => {
      utils.favorite.check.invalidate({ newsId });
      utils.favorite.count.invalidate();
      utils.favorite.list.invalidate();
    },
  });

  const removeFav = trpc.favorite.remove.useMutation({
    onSuccess: () => {
      utils.favorite.check.invalidate({ newsId });
      utils.favorite.count.invalidate();
      utils.favorite.list.invalidate();
    },
  });

  // Auto-mark as read when viewing
  useEffect(() => {
    if (isAuthenticated && !isNaN(newsId)) {
      const status = readStatuses?.find((s) => s.newsId === newsId);
      if (!status?.read) {
        markRead.mutate({ newsId });
      }
    }
  }, [newsId, isAuthenticated, readStatuses, markRead]);

  const isFavorite = favCheck?.isFavorite ?? false;

  const handleFavorite = () => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    if (isFavorite) {
      removeFav.mutate({ newsId });
    } else {
      addFav.mutate({ newsId });
    }
  };

  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const tags = article?.tags?.split(",").filter(Boolean) ?? [];

  if (isLoading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
        <Header />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--color-accent)" }} />
        </div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
        <Header />
        <div className="mx-auto max-w-[900px] px-4 py-12 text-center">
          <p style={{ color: "var(--color-text-muted)" }}>Новость не найдена</p>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium"
            style={{ color: "var(--color-accent)" }}
          >
            <ArrowLeft className="w-4 h-4" />
            Вернуться к ленте
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
      <Header />

      <main className="mx-auto max-w-[900px] px-4 py-6">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-sm mb-5" style={{ color: "var(--color-text-muted)" }}>
          <Link to="/" className="hover:underline" style={{ color: "var(--color-accent)" }}>
            Лента
          </Link>
          <span>/</span>
          {article.isScience && (
            <>
              <Link to="/science" className="hover:underline" style={{ color: "var(--color-accent)" }}>
                ИИ для науки
              </Link>
              <span>/</span>
            </>
          )}
          <span className="truncate max-w-[300px]">{article.title}</span>
        </nav>

        {/* Article */}
        <article
          className="rounded-xl border p-6 md:p-8"
          style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
        >
          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {article.categorySlug && (
              <span
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wider"
                style={{ backgroundColor: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}
              >
                {article.categorySlug}
              </span>
            )}
            {article.scienceField && (
              <span
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wider"
                style={{ backgroundColor: "var(--color-search-bg)", color: "var(--color-text-muted)" }}
              >
                {article.scienceField}
              </span>
            )}
            {tags.map((tag: string) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                style={{ backgroundColor: "var(--color-search-bg)", color: "var(--color-text-muted)" }}
              >
                <Tag className="w-3 h-3 mr-1" />
                {tag.trim()}
              </span>
            ))}
          </div>

          {/* Title */}
          <h1
            className="text-xl md:text-2xl font-bold leading-snug tracking-tight"
            style={{ color: "var(--color-text-heading)", fontFamily: "Manrope, sans-serif" }}
          >
            {article.title}
          </h1>

          {/* Meta */}
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
            <div className="flex items-center gap-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
              <span className="font-medium" style={{ color: "var(--color-text-body)" }}>
                {article.source}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {formatDate(article.publishedAt)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: "var(--color-text-muted)" }}
                title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setReadingMode(!readingMode)}
                className="p-1.5 rounded-lg transition-colors"
                style={{
                  color: readingMode ? "var(--color-accent)" : "var(--color-text-muted)",
                  backgroundColor: readingMode ? "var(--color-tag-bg)" : "transparent",
                }}
                title={readingMode ? "Обычный режим" : "Режим чтения"}
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={handleFavorite}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-150"
            >
              <Star
                className="w-4 h-4"
                style={{ fill: isFavorite ? "var(--color-favorite)" : "none" }}
              />
              В избранное
            </button>
            <a
              href={article.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 hover:opacity-90"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "#fff",
              }}
            >
              <ExternalLink className="w-4 h-4" />
              Перейти к источнику
            </a>
            <button
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                toast.success("Ссылка скопирована");
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-150"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-text-muted)",
              }}
            >
              <Share2 className="w-4 h-4" />
              Поделиться
            </button>
          </div>

          {/* Divider */}
          <div className="my-6 h-px" style={{ backgroundColor: "var(--color-border)" }} />

          {/* Summary */}
          <div
            className="rounded-lg p-5 mb-6"
            style={{ backgroundColor: "var(--color-search-bg)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4" style={{ color: "var(--color-accent)" }} />
              <span
                className="text-sm font-semibold"
                style={{ color: "var(--color-text-heading)" }}
              >
                Краткое содержание
              </span>
            </div>
            <p className="leading-relaxed" style={{ color: "var(--color-text-body)", fontSize: readingMode ? "18px" : "14px", lineHeight: readingMode ? "1.8" : "1.6" }}>
              {article.summary}
            </p>
          </div>

          {/* Full content - detailed summary */}
          {article.content && (
            <div>
              <h2
                className="text-lg font-semibold mb-3"
                style={{ color: "var(--color-text-heading)", fontFamily: "Manrope, sans-serif" }}
              >
                Подробное описание
              </h2>
              <div
                className="prose prose-sm max-w-none leading-relaxed"
                style={{ color: "var(--color-text-body)", fontSize: readingMode ? "18px" : "15px", lineHeight: readingMode ? "1.8" : "1.7" }}
              >
                {article.content.split("\n").map((paragraph: string, i: number) => (
                  <p key={i} className="mb-3 text-[15px] leading-[1.7]">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Full translation section removed — pipeline now produces
              Russian title + summary in a single Zen call (no full translation). */}
        </article>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6 pt-6 border-t" style={{ borderColor: "var(--color-border)" }}>
          <Link
            to={article.isScience ? "/science" : "/"}
            className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:underline"
            style={{ color: "var(--color-accent)" }}
          >
            <ArrowLeft className="w-4 h-4" />
            К списку новостей
          </Link>
          <a
            href={article.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:underline"
            style={{ color: "var(--color-accent)" }}
          >
            Перейти к источнику
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </main>
    </div>
  );
}
