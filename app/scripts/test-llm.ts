import "dotenv/config";
import { summarizeArticle, translateArticle } from "../api/ai/zenClient";

async function main() {
  const title = "OpenAI выпустила GPT-5";
  const content = "OpenAI announced GPT-5 today. It is a large multimodal model with 2M context window. The model supports text, images and audio.";
  const source = "TechCrunch";

  console.log("Testing summarizeArticle...");
  const { summary, detailedSummary } = await summarizeArticle(title, content, source);
  console.log("Summary:", summary);
  console.log("Detailed:", detailedSummary);

  console.log("\nTesting translateArticle...");
  const translation = await translateArticle(title, content, source);
  console.log("Translation:", translation);
}

main().catch((e) => { console.error(e); process.exit(1); });
