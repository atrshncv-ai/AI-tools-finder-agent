import "dotenv/config";
import { summarizeArticle } from "../api/ai/zenClient";
async function main() {
  const text = "OpenAI announced GPT-5 today. It is a large multimodal model with 2M context window. The model supports text, images and audio.";
  console.log("Testing summarizeArticle...");
  const result = await summarizeArticle("OpenAI выпустила GPT-5", text, "TechCrunch");
  console.log("Summary:", result.summary);
  console.log("Detailed:", result.detailedSummary);
}
main().catch((e) => { console.error(e); process.exit(1); });
