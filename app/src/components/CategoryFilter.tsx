interface CategoryFilterProps {
  categories: { slug: string; name: string }[];
  active: string[];
  onChange: (slugs: string[]) => void;
}

export default function CategoryFilter({ categories, active, onChange }: CategoryFilterProps) {
  const allActive = active.length === 0;

  const toggle = (slug: string) => {
    onChange(active.includes(slug) ? active.filter((s) => s !== slug) : [...active, slug]);
  };

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
      <button
        onClick={() => onChange([])}
        className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150"
        style={{
          backgroundColor: allActive ? "var(--color-accent)" : "var(--color-card)",
          color: allActive ? "#fff" : "var(--color-text-muted)",
          border: `1px solid ${allActive ? "var(--color-accent)" : "var(--color-border)"}`,
        }}
      >
        Все
      </button>
      {categories.map((cat) => {
        const isActive = active.includes(cat.slug);
        return (
          <button
            key={cat.slug}
            onClick={() => toggle(cat.slug)}
            className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150"
            style={{
              backgroundColor: isActive ? "var(--color-accent)" : "var(--color-card)",
              color: isActive ? "#fff" : "var(--color-text-muted)",
              border: `1px solid ${isActive ? "var(--color-accent)" : "var(--color-border)"}`,
            }}
          >
            {cat.name}
          </button>
        );
      })}
    </div>
  );
}
