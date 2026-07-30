import { describe, expect, it } from "vitest";
import { extractArticleText } from "../../scripts/hermes/article-content";

describe("article content extraction", () => {
  it("prefers the Nature article body over navigation and references", () => {
    const html = `
      <html><head><meta name="description" content="Centromeres vary across human populations."></head>
      <body>
        <nav>Subscribe Sign in Subscribe Sign in</nav>
        <main>
          <h1>A global view of human centromere variation</h1>
          <div data-container-type="article-body">
            <p>Researchers assembled complete centromere sequences from diverse human genomes.</p>
            <p>The results reveal structural variation and evolutionary patterns across populations.</p>
          </div>
          <section class="c-article-references">References References References References</section>
        </main>
      </body></html>`;

    const text = extractArticleText(html, "https://www.nature.com/articles/example");
    expect(text).toContain("Researchers assembled complete centromere sequences");
    expect(text).toContain("evolutionary patterns across populations");
    expect(text).not.toContain("Subscribe");
    expect(text).not.toContain("References");
  });

  it("falls back to metadata for a Nature page without an accessible body", () => {
    const html = `<html><head>
      <meta name="description" content="A sufficiently detailed scientific abstract describing a new result in human genetics and its implications.">
    </head><body><main>Access options</main></body></html>`;

    expect(extractArticleText(html, "https://www.nature.com/articles/example")).toContain(
      "scientific abstract",
    );
  });
});
