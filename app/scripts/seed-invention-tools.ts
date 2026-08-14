import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { inventionTools } from "@db/schema";
import { sql } from "drizzle-orm";

const tools = [
  ["gnome", "GNoME", "Google DeepMind", "US", "materials-discovery", ["materials"], "research", "Модель для поиска стабильных кристаллических структур и новых материалов.", "https://deepmind.google/discover/blog/millions-of-new-materials-discovered-with-deep-learning/"],
  ["orbital-materials", "Orbital Materials", "Orbital Materials", "UK", "materials-design", ["materials", "chemistry"], "commercial", "Платформа дизайна материалов с заданными физическими свойствами.", "https://www.orbitalmaterials.com/"],
  ["a-lab", "A-Lab", "Berkeley Lab", "US", "autonomous-lab", ["materials", "chemistry", "engineering"], "research", "Автономная лаборатория: ИИ предлагает рецепты, роботы синтезируют и анализируют материалы.", "https://als.lbl.gov/a-lab/"],
  ["schrodinger-materials", "Schrödinger Materials Science Platform", "Schrödinger", "US", "materials-platform", ["materials", "chemistry"], "paid", "Коммерческая платформа проектирования материалов и планирования синтеза.", "https://www.schrodinger.com/platform/materials-science/"],
  ["ibm-rxn", "IBM RXN for Chemistry", "IBM Research", "US", "retrosynthesis", ["chemistry"], "demo-paid", "Модель прогнозирования реакций и ретросинтетического планирования.", "https://rxn.res.ibm.com/"],
  ["askcos", "ASKCOS", "MIT", "US", "retrosynthesis", ["chemistry"], "open-source", "Open-source комплекс для планирования химического синтеза.", "https://askcos.mit.edu/"],
  ["citrine", "Citrine Platform", "Citrine Informatics", "US", "materials-platform", ["materials", "engineering"], "paid", "Машинное обучение для поиска формул и производственных маршрутов материалов.", "https://citrine.io/"],
  ["synple-chem", "Synple Chem", "Synple Chem", "US", "automated-synthesis", ["chemistry", "engineering"], "paid", "Автоматизированная система планирования и выполнения синтеза.", "https://synplechem.com/"],
  ["deep-molecular", "Deep-Molecular", "DeepPotential / DP Technology", "China", "molecular-design", ["chemistry", "materials"], "paid", "Молекулярная динамика и ИИ для дизайна материалов и рецептов.", "https://deepmodeling.com/"],
  ["paddlehelix", "Baidu PaddleHelix", "Baidu", "China", "biochemistry", ["chemistry", "biology", "medicine"], "open-source-enterprise", "Платформа предсказания свойств молекул и путей синтеза.", "https:// PaddleHelix.baidu.com/".replace(" ", "")],
  ["chemai", "ChemAI", "Shanghai Institute of Organic Chemistry", "China", "retrosynthesis", ["chemistry"], "academic-commercial", "База реакций и модели для ретросинтетических задач.", "https://www.sioc.ac.cn/"],
  ["galactica-chemistry-forks", "Galactica (chemistry forks)", "Research community", "China", "language-model", ["chemistry", "materials"], "open-source", "Open-source форки Galactica, адаптированные для химических и материаловедческих задач.", "https://github.com/paperswithcode/galactica"],
] as const;

async function main() {
  const db = getDb();
  for (const [slug, name, organization, country, kind, spheres, accessStatus, description, officialUrl] of tools) {
    await db.insert(inventionTools).values({ slug, name, organization, country, kind, spheres, accessStatus, description, officialUrl, lastVerifiedAt: new Date() }).onConflictDoUpdate({ target: inventionTools.slug, set: { name, organization, country, kind, spheres, accessStatus, description, officialUrl, lastVerifiedAt: new Date(), updatedAt: new Date() } });
  }
  console.log(`seeded ${tools.length} invention tools`);
}
main().catch((error) => { console.error(error); process.exit(1); });
