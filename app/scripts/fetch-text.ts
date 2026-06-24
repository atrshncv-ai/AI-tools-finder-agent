import * as cheerio from "cheerio";
async function main() {
  const res = await fetch("https://arxiv.org/abs/2606.19464", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, aside, iframe, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  console.log(text.substring(0, 4000));
}
main();
