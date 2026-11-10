import { FRESHNESS_OPTIONS, type FreshnessKey } from "./freshness";

export type { FreshnessKey } from "./freshness";

interface FreshnessFilterProps {
  active: FreshnessKey;
  onChange: (key: FreshnessKey) => void;
}

export default function FreshnessFilter({ active, onChange }: FreshnessFilterProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
      {FRESHNESS_OPTIONS.map((opt) => {
        const isActive = active === opt.key;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150"
            style={{
              backgroundColor: isActive ? "var(--color-accent)" : "var(--color-card)",
              color: isActive ? "#fff" : "var(--color-text-muted)",
              border: `1px solid ${isActive ? "var(--color-accent)" : "var(--color-border)"}`,
            }}
          >
            {opt.name}
          </button>
        );
      })}
    </div>
  );
}
