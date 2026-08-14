import { useParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import Header from "@/components/Header";
import {
  ArrowLeft,
  ExternalLink,
  Calendar,
  Globe,
  BookOpen,
  Loader2,
  Share2,
  Building2,
  MapPin,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

export default function ToolDetail() {
  const { id } = useParams<{ id: string }>();
  const toolId = Number(id);

  const { data: tool, isLoading } = trpc.news.inventionToolById.useQuery(
    { id: toolId },
    { enabled: !isNaN(toolId) }
  );

  const formatDate = (date: Date | string | null) => {
    if (!date) return null;
    const d = new Date(date);
    return d.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Ссылка скопирована");
  };

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

  if (!tool) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
        <Header />
        <div className="mx-auto max-w-[900px] px-4 py-12 text-center">
          <p style={{ color: "var(--color-text-muted)" }}>Инструмент не найден</p>
          <Link
            to="/inventions"
            className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium"
            style={{ color: "var(--color-accent)" }}
          >
            <ArrowLeft className="w-4 h-4" />
            Вернуться к инструментам
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
          <Link to="/inventions" className="hover:underline" style={{ color: "var(--color-accent)" }}>
            Инструменты для изобретений
          </Link>
          <span>/</span>
          <span className="truncate max-w-[300px]">{tool.name}</span>
        </nav>

        {/* Tool card */}
        <article
          className="rounded-xl border p-6 md:p-8"
          style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
        >
          {/* Badges */}
          <div className="flex flex-wrap gap-1.5 mb-4">
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
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wider"
                style={{ backgroundColor: "var(--color-search-bg)", color: "var(--color-text-muted)" }}
              >
                {tool.accessStatus}
              </span>
            )}
            {tool.spheres.map((sphere: string) => (
              <span
                key={sphere}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                style={{ backgroundColor: "var(--color-search-bg)", color: "var(--color-text-muted)" }}
              >
                {sphere}
              </span>
            ))}
          </div>

          {/* Title */}
          <h1
            className="text-xl md:text-2xl font-bold leading-snug tracking-tight"
            style={{ color: "var(--color-text-heading)", fontFamily: "Manrope, sans-serif" }}
          >
            {tool.name}
          </h1>

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-3 mt-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {tool.organization && (
              <span className="flex items-center gap-1.5 font-medium" style={{ color: "var(--color-text-body)" }}>
                <Building2 className="w-3.5 h-3.5" />
                {tool.organization}
              </span>
            )}
            {tool.country && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {tool.country}
              </span>
            )}
            {formatDate(tool.lastVerifiedAt) && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                Проверено: {formatDate(tool.lastVerifiedAt)}
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 mt-5">
            <a
              href={tool.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 hover:opacity-90"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "#fff",
              }}
            >
              <Globe className="w-4 h-4" />
              Официальный сайт
            </a>
            {tool.docsUrl && (
              <a
                href={tool.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-150"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-body)",
                }}
              >
                <BookOpen className="w-4 h-4" />
                Документация
              </a>
            )}
            <button
              onClick={handleShare}
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

          {/* Description */}
          <div
            className="rounded-lg p-5"
            style={{ backgroundColor: "var(--color-search-bg)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-4 h-4" style={{ color: "var(--color-accent)" }} />
              <span
                className="text-sm font-semibold"
                style={{ color: "var(--color-text-heading)" }}
              >
                Описание
              </span>
            </div>
            <p className="leading-relaxed" style={{ color: "var(--color-text-body)" }}>
              {tool.description}
            </p>
          </div>
        </article>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6 pt-6 border-t" style={{ borderColor: "var(--color-border)" }}>
          <Link
            to="/inventions"
            className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:underline"
            style={{ color: "var(--color-accent)" }}
          >
            <ArrowLeft className="w-4 h-4" />
            Ко всем инструментам
          </Link>
          <a
            href={tool.officialUrl}
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
