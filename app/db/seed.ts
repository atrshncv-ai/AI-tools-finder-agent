import "dotenv/config";
import { seedCategories } from "../api/queries/news";
import { seedSources } from "../api/queries/sources";

async function seed() {
  console.log("Seeding database...");
  await seedCategories();
  await seedSources();
  console.log("Done. Categories and sources seeded.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
