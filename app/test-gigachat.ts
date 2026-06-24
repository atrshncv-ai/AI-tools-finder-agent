import GigaChat from "gigachat";
import { Agent } from "node:https";

const GIGACHAT_KEY = "REDACTED_GIGACHAT_KEY";

async function main() {
  const client = new GigaChat({
    timeout: 120,
    model: "GigaChat",
    credentials: GIGACHAT_KEY,
    httpsAgent: new Agent({ rejectUnauthorized: false }),
  });

  console.log("Testing new GigaChat key...");

  try {
    const resp = await client.chat({
      messages: [{ role: "user", content: "Привет! Напиши одно предложение на русском." }],
    });

    console.log("Response:", resp.choices[0]?.message?.content);
    console.log("\nKey works! Proceeding to integration...");
  } catch (error: unknown) {
    const err = error as { message?: string; response?: { data?: unknown } };
    console.error("Error:", err.message || String(error));
    if (err.response?.data) console.error("Data:", JSON.stringify(err.response.data));
  }
}

main().catch(console.error);
