import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import Header from "@/components/Header";

export default function NotFound() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
      <Header />
      <div className="mx-auto max-w-[900px] px-4 py-20 text-center">
        <h1
          className="text-6xl font-bold mb-4"
          style={{ color: "var(--color-border)", fontFamily: "Manrope, sans-serif" }}
        >
          404
        </h1>
        <p className="text-lg font-medium mb-2" style={{ color: "var(--color-text-heading)" }}>
          Страница не найдена
        </p>
        <p className="text-sm mb-6" style={{ color: "var(--color-text-muted)" }}>
          Запрашиваемая страница не существует или была удалена
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:underline"
          style={{ color: "var(--color-accent)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Вернуться на главную
        </Link>
      </div>
    </div>
  );
}
