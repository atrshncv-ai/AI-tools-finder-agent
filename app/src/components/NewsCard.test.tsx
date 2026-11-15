// @vitest-environment jsdom
/**
 * NewsCard.test.tsx — what the dashboard card shows under the summary.
 *
 * Why: the card used to print the source's release date (`publishedAt`) and
 * silently fell back to `updatedAt`. The client wants the date the card itself
 * was published — `platformPublishedAt` — with the time, in Moscow time, and
 * no date at all while the card is unpublished.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ComponentProps } from "react";

vi.mock("@/providers/trpc", () => {
  const invalidate = vi.fn();
  const utils = {
    favorite: {
      check: { invalidate },
      count: { invalidate },
      list: { invalidate },
    },
  };
  return {
    trpc: {
      useUtils: () => utils,
      favorite: {
        check: { useQuery: () => ({ data: { isFavorite: false } }) },
        add: { useMutation: () => ({ mutate: vi.fn() }) },
        remove: { useMutation: () => ({ mutate: vi.fn() }) },
      },
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));

import NewsCard from "./NewsCard";

/** A summary of the new length: dense, well above the old 300–450 signs. */
const SUMMARY =
  "Китайские исследователи показали модель, которая предсказывает укладку белков " +
  "в клетке точнее прежних методов. Сеть обучена на массиве экспериментальных " +
  "структур и учитывает взаимодействия между удалёнными участками молекулы, " +
  "поэтому ей не нужен ручной подбор признаков. Точность выросла на несколько " +
  "процентных пунктов, а поиск структуры занимает минуты вместо недель, что " +
  "ускоряет разработку лекарств и ферментов для промышленности.";

/** Published on this platform at 14:42 UTC — 17:42 in Moscow. */
const PLATFORM_PUBLISHED_AT = new Date("2026-11-15T14:42:00Z");
/** The source's own release date: kept in the database, never shown. */
const SOURCE_PUBLISHED_AT = new Date("2026-11-01T08:00:00Z");

const ARTICLE = {
  id: 42,
  title: "Новая ИИ-модель предсказывает структуру белков",
  summary: SUMMARY,
  content: null,
  tags: "ИИ, биология",
  categoryName: null,
  categorySlug: "ai-news",
  source: "Nature",
  originalUrl: "https://www.nature.com/articles/example",
  publishedAt: SOURCE_PUBLISHED_AT,
  platformPublishedAt: PLATFORM_PUBLISHED_AT,
  updatedAt: new Date("2026-11-16T00:00:00Z"),
} as unknown as ComponentProps<typeof NewsCard>["article"];

function renderCard(overrides: Partial<ComponentProps<typeof NewsCard>["article"]> = {}) {
  return render(
    <MemoryRouter>
      <NewsCard article={{ ...ARTICLE, ...overrides }} />
    </MemoryRouter>,
  );
}

describe("NewsCard: no meaningless reading time", () => {
  it("does not print «мин чтения» anywhere in the card", () => {
    const { container } = renderCard();
    expect(container.textContent).not.toContain("мин чтения");
  });
});

describe("NewsCard: the full summary is shown", () => {
  it("renders the whole summary text", () => {
    renderCard();
    expect(screen.getByText(SUMMARY)).toBeTruthy();
  });

  it("does not clamp the summary to a few lines", () => {
    renderCard();
    const paragraph = screen.getByText(SUMMARY);
    expect(paragraph.className).not.toContain("line-clamp");
  });
});

describe("NewsCard: source and card publication date under the summary", () => {
  it("shows the source", () => {
    renderCard();
    expect(screen.getByText("Nature")).toBeTruthy();
  });

  it("shows when the card was published, in Moscow time", () => {
    renderCard();
    expect(screen.getByText("15 ноября, 17:42")).toBeTruthy();
  });

  it("shows the publication date exactly once", () => {
    const { container } = renderCard();
    const date = "15 ноября, 17:42";
    expect(container.textContent?.split(date)).toHaveLength(2);
    expect(screen.getAllByText(date)).toHaveLength(1);
  });

  it("converts the publication instant to Moscow time across midnight", () => {
    renderCard({ platformPublishedAt: new Date("2026-11-15T22:30:00Z") });
    expect(screen.getByText("16 ноября, 01:30")).toBeTruthy();
  });

  it("puts the source and the date after the summary, not above it", () => {
    renderCard();
    const summary = screen.getByText(SUMMARY);
    const source = screen.getByText("Nature");
    expect(summary.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("NewsCard: no date for an unpublished card, no source date ever", () => {
  it("shows no date when platformPublishedAt is empty", () => {
    const { container } = renderCard({ platformPublishedAt: null });
    expect(container.textContent).not.toContain("ноября");
    expect(container.textContent).not.toMatch(/\d{1,2}\.\d{2}\.\d{4}/);
    expect(container.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it("never falls back to the source publication date or to updatedAt", () => {
    const { container } = renderCard({ platformPublishedAt: null });
    expect(container.textContent).not.toContain("01.11.2026");
    expect(container.textContent).not.toContain("1 ноября");
    expect(container.textContent).not.toContain("16.11.2026");
  });

  it("does not print the source publication date when the card has its own", () => {
    const { container } = renderCard();
    expect(container.textContent).not.toContain("01.11.2026");
    expect(container.textContent).not.toContain("1 ноября");
  });
});
