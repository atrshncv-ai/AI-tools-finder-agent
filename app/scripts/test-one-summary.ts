import "dotenv/config";
import { chatCompletion } from "../api/ai/zenClient";
async function main() {
  const text = "Computer Science > Artificial Intelligence arXiv:2606.19464 (cs) [Submitted on 17 Jun 2026] Title:Deontic Policies for Runtime Governance of Agentic AI Systems Authors:Anupam Joshi, Tim Finin, Karuna Pande Joshi, Lalana Kagal Abstract:Autonomous agentic AI systems driven by Large Language Models (LLMs) introduce a new class of security, privacy and governance challenges.";
  const messages = [
    { role: "system", content: "Научный редактор. Составь краткое саммари статьи на русском языке. 3-5 предложений." },
    { role: "user", content: `Название: Deontic Policies for Runtime Governance of Agentic AI Systems\nИсточник: ArXiv cs.AI\n\n${text}` },
  ];
  console.log("Sending...");
  const result = await chatCompletion(messages, { max_tokens: 512, timeoutMs: 120000 });
  console.log("Result:", result);
}
main().catch((e) => { console.error(e); process.exit(1); });
