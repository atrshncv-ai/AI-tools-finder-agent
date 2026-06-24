import "dotenv/config";
import { chatCompletion } from "../api/ai/client";
async function main() {
  const text = "OpenAI announced GPT-5 today. It is a large multimodal model with 2M context window.";
  const messages = [
    { role: "system", content: "Научный редактор. Составь краткое саммари статьи на русском языке. 3-5 предложений. Сохрани ключевые факты, цифры и термины. Не добавляй оценок." },
    { role: "user", content: `Название: OpenAI выпустила GPT-5\nИсточник: TechCrunch\n\n${text}` },
  ];
  console.log("Sending request via chatCompletion...");
  const result = await chatCompletion(messages, { max_tokens: 1024, timeoutMs: 120000 });
  console.log("Result:", result);
}
main().catch((e) => { console.error(e); process.exit(1); });
