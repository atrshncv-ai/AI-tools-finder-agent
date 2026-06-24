import { translate } from "@vitalets/google-translate-api";

async function main() {
  const { text } = await translate("Artificial intelligence is transforming modern science.", { to: "ru" });
  console.log("Translation:", text);
}

main().catch(console.error);
