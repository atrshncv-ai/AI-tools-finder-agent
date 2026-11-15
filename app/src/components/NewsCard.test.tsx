// @vitest-environment jsdom
/**
 * NewsCard.test.tsx — what the dashboard card shows under the summary.
 *
 * Why: the card printed "N мин чтения", computed as summary length / 1000, so
 * every card claimed one minute and the label carried no information. The card
 * now shows the source and the publication date instead — and the summary is
 * longer (400–500 characters), so it must not be clipped to three lines.
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

const PUBLISHED_AT = new Date("2026-11-15T09:00:00Z");

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
  platformPublishedAt: PUBLISHED_AT,
  updatedAt: new Date("2026-11-16T00:00:00Z"),
} as unknown as ComponentProps<typeof NewsCard>["article"];

function renderCard() {
  return render(
    <MemoryRouter>
      <NewsCard article={ARTICLE} />
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

describe("NewsCard: source and publication date under the summary", () => {
  it("shows the source", () => {
    renderCard();
    expect(screen.getByText("Nature")).toBeTruthy();
  });

  it("shows the publication date exactly once", () => {
    const { container } = renderCard();
    const date = PUBLISHED_AT.toLocaleDateString("ru-RU");
    const occurrences = container.textContent?.split(date).length === 2;
    expect(occurrences).toBe(true);
    expect(screen.getAllByText(date)).toHaveLength(1);
  });

  it("puts the source and the date after the summary, not above it", () => {
    renderCard();
    const summary = screen.getByText(SUMMARY);
    const source = screen.getByText("Nature");
    expect(summary.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
