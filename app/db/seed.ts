import "dotenv/config";
import { seedCategories, seedNews } from "../api/queries/news";
import { seedSources } from "../api/queries/sources";

async function seed() {
  console.log("Seeding database...");
  await seedCategories();
  await seedSources();
  await seedNews();
  console.log("Done. Categories, sources, and news seeded.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
