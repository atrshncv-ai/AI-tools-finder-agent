import { describe, expect, it } from "vitest";
import { extractVersionedEntities, matchTitle, normalizeTitle, similarity } from "./dedup";

describe("extractVersionedEntities", () => {
  it("extracts versioned model names (letters + digits in one token)", () => {
    expect(extractVersionedEntities("OpenAI выпустила GPT-5.6 для всех")).toEqual(
      new Set(["gpt-5.6"]),
    );
    // «4» без букв — не сущность; «3.7» без букв — тоже.
    expect(extractVersionedEntities("Claude 4 и Gemini 3.7 вышли одновременно")).toEqual(new Set());
  });

  it("excludes bare numbers and bare brands", () => {
    expect(extractVersionedEntities("Долгожители старше 110 лет")).toEqual(new Set());
    expect(extractVersionedEntities("OpenAI нанимает инженеров")).toEqual(new Set());
  });
});

describe("matchTitle (combined dedup rule)", () => {
  const THRESHOLD = 0.85;

  it("merges one story phrased differently when a versioned entity is shared", () => {
    const a = "OpenAI выпустила GPT-5.6 для всех пользователей";
    const b = "GPT-5.6 от OpenAI стала доступна всем пользователям";
    const r = matchTitle(a, normalizeTitle(a), b, THRESHOLD);
    expect(r).not.toBeNull();
    expect(r!.reason).toBe("versioned-entity");
  });

  it("does not merge different stories about the same brand", () => {
    const a = "OpenAI нанимает тысячу инженеров в Токио";
    const b = "OpenAI закрыла доступ к сервису в Италии";
    expect(matchTitle(a, normalizeTitle(a), b, THRESHOLD)).toBeNull();
  });

  it("does not merge stories sharing only a bare number", () => {
    const a = "Долгожители старше 110 лет удивили ученых";
    const b = "Ученые изучают 110 геномов долгожителей";
    expect(matchTitle(a, normalizeTitle(a), b, THRESHOLD)).toBeNull();
  });

  it("still merges near-identical titles via plain similarity", () => {
    const a = "OpenAI выпустила новую модель GPT-5.6";
    const b = "OpenAI выпустила новую модель GPT-5.6!";
    const r = matchTitle(a, normalizeTitle(a), b, THRESHOLD);
    expect(r).not.toBeNull();
    expect(r!.reason).toBe("title-similarity");
  });

  it("skips pairs whose normalized lengths diverge too much", () => {
    const a = "Короткая новость";
    const b = "Совершенно иной, очень длинный заголовок статьи про события далёкого дня";
    expect(matchTitle(a, normalizeTitle(a), b, THRESHOLD)).toBeNull();
  });

  it("similarity helper stays consistent", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("", "")).toBe(1);
    expect(similarity("abc", "xyz")).toBeLessThan(0.5);
  });
});
