import { useState } from "react";
import { trpc } from "@/providers/trpc";
import Header from "@/components/Header";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { toast } from "sonner";
import {
  Settings,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Play,
  Bot,
  Plus,
  Trash2,
  Globe,
  Rss,
  Users,
  Shield,
  ShieldOff,
} from "lucide-react";

export default function Admin() {
  const { isAdmin, isLoading } = useAdminGuard();
  const [isParsing, setIsParsing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newSourceType, setNewSourceType] = useState<"rss" | "html" | "api" | "google_news">("html");

  const { data: sources, refetch: refetchSources } = trpc.parser.sources.useQuery();
  const { data: logs, refetch: refetchLogs } = trpc.parser.logs.useQuery();
  const { data: status } = trpc.parser.status.useQuery();
  const { data: users, refetch: refetchUsers } = trpc.parser.users.useQuery();

  const parseMutation = trpc.parser.parse.useMutation({
    onSuccess: (data) => {
      refetchSources();
      refetchLogs();
      if (data.errors.length > 0) {
        toast.warning(`Парсинг завершён с ошибками: ${data.errors[0]}`);
      } else {
        toast.success(`Парсинг завершён. Найдено: ${data.totalFound}, новых: ${data.totalNew}`);
      }
    },
    onError: () => {
      toast.error("Ошибка запуска парсинга");
    },
  });

  const summarizeMutation = trpc.parser.summarize.useMutation({
    onSuccess: (data) => {
      refetchLogs();
      toast.success(`Суммаризация завершена. Обработано: ${data.summarized}`);
    },
    onError: () => {
      toast.error("Ошибка суммаризации. Проверьте LM Studio.");
    },
  });

  const addSourceMutation = trpc.parser.addSource.useMutation({
    onSuccess: () => {
      refetchSources();
      setNewSourceName("");
      setNewSourceUrl("");
      toast.success("Источник добавлен");
    },
    onError: (err) => {
      toast.error(`Ошибка: ${err.message}`);
    },
  });

  const removeSourceMutation = trpc.parser.removeSource.useMutation({
    onSuccess: () => {
      refetchSources();
      toast.success("Источник удалён");
    },
  });

  const toggleSourceMutation = trpc.parser.toggleSource.useMutation({
    onSuccess: () => {
      refetchSources();
    },
  });

  const setUserRoleMutation = trpc.parser.setUserRole.useMutation({
    onSuccess: () => {
      refetchUsers();
      toast.success("Роль пользователя обновлена");
    },
    onError: (err) => {
      toast.error(`Ошибка: ${err.message}`);
    },
  });

  const handleParse = async () => {
    setIsParsing(true);
    try {
      await parseMutation.mutateAsync();
    } finally {
      setIsParsing(false);
    }
  };

  const handleSummarize = async () => {
    setIsSummarizing(true);
    try {
      await summarizeMutation.mutateAsync();
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleAddSource = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName.trim() || !newSourceUrl.trim()) return;
    addSourceMutation.mutate({
      name: newSourceName.trim(),
      url: newSourceUrl.trim(),
      type: newSourceType,
    });
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
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

  if (!isAdmin) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
        <Header />
        <div className="flex items-center justify-center py-20">
          <p style={{ color: "var(--color-text-muted)" }}>Доступ запрещён</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
      <Header />
      <main className="mx-auto max-w-[1000px] px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-6 h-6" style={{ color: "var(--color-accent)" }} />
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ color: "var(--color-text-heading)", fontFamily: "Manrope, sans-serif" }}
          >
            Панель управления
          </h1>
        </div>

        {/* Agent Status */}
        <div
          className="rounded-xl border p-4 mb-6"
          style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
        >
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--color-text-heading)" }}>
            <Bot className="w-4 h-4" />
            Агентная система
          </h2>
          <div className="grid grid-cols-1 gap-4">
            <div className="flex items-center gap-2">
              {status?.zen ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
              <span className="text-sm" style={{ color: "var(--color-text-body)" }}>
                Zen API {status?.zen ? "подключён" : "недоступен"}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div
          className="rounded-xl border p-4 mb-6"
          style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
        >
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-text-heading)" }}>
            Действия
          </h2>
          <div className="flex gap-3">
            <button
              onClick={handleParse}
              disabled={isParsing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
                opacity: isParsing ? 0.6 : 1,
              }}
            >
              {isParsing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Запустить парсинг
            </button>
            <button
              onClick={handleSummarize}
              disabled={isSummarizing || !status?.zen}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-text-body)",
                opacity: isSummarizing || !status?.zen ? 0.6 : 1,
              }}
            >
              {isSummarizing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Суммаризовать
            </button>
          </div>
        </div>

        {/* Add Source Form */}
        <div
          className="rounded-xl border p-4 mb-6"
          style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
        >
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--color-text-heading)" }}>
            <Plus className="w-4 h-4" />
            Добавить источник
          </h2>
          <form onSubmit={handleAddSource} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Название (например: Habr AI)"
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
              className="flex-1 h-10 px-3 rounded-lg border text-sm outline-none"
              style={{
                backgroundColor: "var(--color-search-bg)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-body)",
              }}
            />
            <input
              type="url"
              placeholder="URL источника"
              value={newSourceUrl}
              onChange={(e) => setNewSourceUrl(e.target.value)}
              className="flex-1 h-10 px-3 rounded-lg border text-sm outline-none"
              style={{
                backgroundColor: "var(--color-search-bg)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-body)",
              }}
            />
            <select
              value={newSourceType}
              onChange={(e) => setNewSourceType(e.target.value as "rss" | "html" | "api" | "google_news")}
              className="h-10 px-3 rounded-lg border text-sm outline-none"
              style={{
                backgroundColor: "var(--color-search-bg)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-body)",
              }}
            >
              <option value="html">HTML</option>
              <option value="rss">RSS</option>
              <option value="google_news">Google News</option>
              <option value="api">API</option>
            </select>
            <button
              type="submit"
              disabled={addSourceMutation.isPending || !newSourceName.trim() || !newSourceUrl.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
                opacity: addSourceMutation.isPending ? 0.6 : 1,
              }}
            >
              {addSourceMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Добавить
            </button>
          </form>
        </div>

        {/* Sources */}
        <div
          className="rounded-xl border p-4 mb-6"
          style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
        >
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-text-heading)" }}>
            Источники ({sources?.length ?? 0})
          </h2>
          <div className="space-y-2">
            {sources?.map((source: { id: number; name: string; type: string; url: string; enabled: boolean }) => {
              const health = status?.sourcesHealth?.find((h: { sourceId: number }) => h.sourceId === source.id);
              return (
                <div
                  key={source.id}
                  className="flex items-center justify-between p-3 rounded-lg"
                  style={{ backgroundColor: "var(--color-search-bg)" }}
                >
                  <div className="flex items-center gap-3">
                    {source.type === "rss" ? (
                      <Rss className="w-4 h-4" style={{ color: "var(--color-accent)" }} />
                    ) : (
                      <Globe className="w-4 h-4" style={{ color: "var(--color-accent)" }} />
                    )}
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--color-text-heading)" }}>
                        {source.name}
                      </p>
                      <p className="text-xs truncate max-w-[300px]" style={{ color: "var(--color-text-muted)" }}>
                        {source.type.toUpperCase()} — {source.url}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {health && (
                      <span className="text-xs" style={{
                        color: health.status === "healthy" ? "rgb(34, 197, 94)" :
                               health.status === "degraded" ? "rgb(234, 179, 8)" :
                               health.status === "failed" ? "rgb(239, 68, 68)" : "var(--color-text-muted)"
                      }}>
                        {health.status === "healthy" ? "✓" :
                         health.status === "degraded" ? "⚠" :
                         health.status === "failed" ? "✗" : "?"}
                      </span>
                    )}
                    <button
                      onClick={() => toggleSourceMutation.mutate({ id: source.id, enabled: !source.enabled })}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: source.enabled ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
                        color: source.enabled ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)",
                      }}
                    >
                      {source.enabled ? "Активен" : "Отключён"}
                    </button>
                    <button
                      onClick={() => removeSourceMutation.mutate({ id: source.id })}
                      className="p-1 rounded-md transition-colors hover:bg-red-100"
                      style={{ color: "rgb(239, 68, 68)" }}
                      title="Удалить источник"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Users */}
        <div
          className="rounded-xl border p-4 mb-6"
          style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
        >
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--color-text-heading)" }}>
            <Users className="w-4 h-4" />
            Пользователи ({users?.length ?? 0})
          </h2>
          <div className="space-y-2">
            {users?.length === 0 && (
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                Пользователей пока нет
              </p>
            )}
            {users?.map((user: { id: number; name: string | null; email: string | null; role: string; createdAt: Date }) => (
              <div
                key={user.id}
                className="flex items-center justify-between p-3 rounded-lg"
                style={{ backgroundColor: "var(--color-search-bg)" }}
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-text-heading)" }}>
                    {user.name || "Без имени"}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {user.email || "—"} · {user.role}
                  </p>
                </div>
                <button
                  onClick={() =>
                    setUserRoleMutation.mutate({
                      userId: user.id,
                      role: user.role === "admin" ? "user" : "admin",
                    })
                  }
                  disabled={setUserRoleMutation.isPending}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: user.role === "admin" ? "rgba(239, 68, 68, 0.1)" : "rgba(34, 197, 94, 0.1)",
                    color: user.role === "admin" ? "rgb(239, 68, 68)" : "rgb(34, 197, 94)",
                  }}
                >
                  {user.role === "admin" ? (
                    <>
                      <ShieldOff className="w-3 h-3" /> Снять админа
                    </>
                  ) : (
                    <>
                      <Shield className="w-3 h-3" /> Сделать админом
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Logs */}
        <div
          className="rounded-xl border p-4"
          style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
        >
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-text-heading)" }}>
            Последние логи парсинга
          </h2>
          <div className="space-y-2">
            {logs?.length === 0 && (
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                Логов пока нет
              </p>
            )}
            {logs?.map((log: { id: number; sourceId: number; status: string; articlesFound: number | null; articlesNew: number | null; errorMessage: string | null; createdAt: Date }) => (
              <div
                key={log.id}
                className="flex items-center justify-between p-3 rounded-lg text-sm"
                style={{ backgroundColor: "var(--color-search-bg)" }}
              >
                <div className="flex items-center gap-3">
                  {log.status === "completed" ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : log.status === "failed" ? (
                    <XCircle className="w-4 h-4 text-red-500" />
                  ) : (
                    <Clock className="w-4 h-4 text-yellow-500" />
                  )}
                  <div>
                    <p style={{ color: "var(--color-text-heading)" }}>
                      Источник #{log.sourceId} - {log.status}
                    </p>
                    <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                      Найдено: {log.articlesFound}, Новых: {log.articlesNew}
                      {log.errorMessage && ` - ${log.errorMessage}`}
                    </p>
                  </div>
                </div>
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {formatDate(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
