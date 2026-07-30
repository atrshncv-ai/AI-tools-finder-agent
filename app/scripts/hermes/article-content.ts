import * as cheerio from "cheerio";

const NOISE_SELECTORS = [
  "script", "style", "nav", "header", "footer", "aside", "iframe",
  "noscript", "svg", "canvas", "form", "button", "input", "textarea",
  "select", "label", "[hidden]",
  "#labstabs", ".labstabs", "#arxivlabs", ".arxivlabs",
  ".ltx_page_footer", ".ltx_page_header", ".ltx_notes",
  ".footer", "#footer", ".page-footer", ".site-footer",
  ".sidebar", "#sidebar", ".nav", ".navbar", ".navigation",
  ".menu", ".mobile-menu", ".comments", "#comments",
  ".advert", ".ads", ".ad", ".cookie-banner", ".cookies",
  ".social", ".share", "#disqus_thread", ".noprint", ".hidden",
  "#mw-navigation", ".printfooter",
  ".c-article-references", ".c-article-metrics-bar", ".c-article-author-list",
  "[data-test='article-header']", "[data-track-component='related articles']",
];

const NATURE_CONTENT_SELECTORS = [
  "[data-container-type='article-body']",
  ".c-article-body",
  "#Abs1-content",
  ".c-article-section__content",
];

const CONTENT_SELECTORS = [
  "article", "main", '[role="main"]',
  "#content-inner", ".content-inner", "#content", "#main",
  ".content", ".post", ".entry", ".abstract",
  ".ltx_document",
];

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cleanText(text: string): string {
  return normalizeSpace(
    text
      .replace(/arXivLabs: experimental projects with community collaborators/gi, " ")
      .replace(/\bDownload PDF\b/gi, " ")
      .replace(/\bHTML \(experimental\)\b/gi, " "),
  );
}

export function extractArticleText(html: string, url: string): string {
  const $ = cheerio.load(html);
  $(NOISE_SELECTORS.join(", ")).remove();

  const isNature = new URL(url).hostname.endsWith("nature.com");
  const selectors = isNature
    ? [...NATURE_CONTENT_SELECTORS, ...CONTENT_SELECTORS]
    : CONTENT_SELECTORS;

  for (const selector of selectors) {
    const candidates = $(selector)
      .toArray()
      .map((element) => cleanText($(element).text()))
      .filter((text) => text.length >= 100);
    if (candidates.length > 0) {
      return candidates.sort((a, b) => b.length - a.length)[0];
    }
  }

  if (isNature) {
    const description = cleanText(
      $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        "",
    );
    if (description.length >= 80) return description;
  }

  return cleanText($("body").text());
}
