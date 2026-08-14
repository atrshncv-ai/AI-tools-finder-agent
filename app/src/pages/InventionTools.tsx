import Header from "@/components/Header";
import { trpc } from "@/providers/trpc";
import { getSectionQuery } from "@/lib/sectionFilters";

export default function InventionTools() {
  const { data: tools, isLoading } = trpc.news.inventionTools.useQuery({});
  const { data: newsData } = trpc.news.list.useQuery({ ...getSectionQuery("invention-tools"), limit: 1, offset: 0 });
  const total = newsData?.total ?? 0;
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
      <Header />
      <main className="mx-auto max-w-[900px] px-4 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--color-text-heading)", fontFamily: "Manrope, sans-serif" }}>Инструменты для изобретений <span className="text-sm font-normal" style={{ color: "var(--color-text-muted)" }}>— {total} статей</span></h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>ИИ для создания материалов, молекул и научных открытий</p>
        </div>
        {isLoading ? <div className="py-16 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>Загрузка…</div> : <div className="flex flex-col gap-3">{(tools ?? []).map((tool) => <article key={tool.id} className="rounded-xl border p-5 transition-colors" style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold" style={{ color: "var(--color-text-heading)" }}>{tool.name}</h2><p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>{tool.organization} · {tool.country}</p></div><span className="shrink-0 rounded-full px-2.5 py-1 text-xs" style={{ backgroundColor: "var(--color-tag-bg)", color: "var(--color-accent)" }}>{tool.accessStatus}</span></div><p className="mt-3 text-sm leading-6" style={{ color: "var(--color-text-body)" }}>{tool.description}</p><div className="mt-3 flex flex-wrap gap-1.5">{tool.spheres.map((sphere) => <span key={sphere} className="rounded-md px-2 py-1 text-xs" style={{ backgroundColor: "var(--color-tag-bg)", color: "var(--color-text-muted)" }}>{sphere}</span>)}</div><a className="mt-4 inline-block text-sm font-medium hover:underline" href={tool.officialUrl} target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)" }}>Официальный сайт →</a></article>)}</div>}
      </main>
    </div>
  );
}
