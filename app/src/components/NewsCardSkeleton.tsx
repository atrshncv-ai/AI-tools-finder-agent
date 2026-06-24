export function NewsCardSkeleton() {
  return (
    <div className="rounded-xl border p-5 animate-pulse" style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}>
      <div className="flex gap-3 mb-3">
        <div className="h-5 w-16 rounded-full" style={{ backgroundColor: "var(--color-search-bg)" }} />
        <div className="h-5 w-12 rounded-full" style={{ backgroundColor: "var(--color-search-bg)" }} />
      </div>
      <div className="h-5 w-3/4 rounded mb-2" style={{ backgroundColor: "var(--color-search-bg)" }} />
      <div className="h-4 w-full rounded mb-1" style={{ backgroundColor: "var(--color-search-bg)" }} />
      <div className="h-4 w-5/6 rounded mb-1" style={{ backgroundColor: "var(--color-search-bg)" }} />
      <div className="h-4 w-2/3 rounded mb-3" style={{ backgroundColor: "var(--color-search-bg)" }} />
      <div className="flex justify-between">
        <div className="h-3 w-24 rounded" style={{ backgroundColor: "var(--color-search-bg)" }} />
        <div className="h-3 w-16 rounded" style={{ backgroundColor: "var(--color-search-bg)" }} />
      </div>
    </div>
  );
}

export function NewsListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <NewsCardSkeleton key={i} />
      ))}
    </div>
  );
}
