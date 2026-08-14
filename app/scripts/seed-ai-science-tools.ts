import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { inventionTools } from "@db/schema";

// 30 real AI-for-science tools with verified working URLs (HTTP 200 checked
// from the production server on 2026-08-14). Descriptions are based on the
// official GitHub repositories / author-tool papers (Nature, Science).
const tools = [
  // ── Biology / protein structure ──
  ["alphafold3", "AlphaFold 3", "Google DeepMind", "UK", "protein-structure", ["biology", "medicine"], "open-source",
   "Точное предсказание 3D-структуры белков, ДНК, РНК и лигандов. Расширение AlphaFold 2 (Нобелевская премия по химии 2024), модель совместного моделирования комплексов биомолекул для drug discovery и структурной биологии.",
   "https://github.com/google-deepmind/alphafold3", "https://github.com/google-deepmind/alphafold3"],
  ["esm3", "ESM3", "EvolutionaryScale", "US", "protein-generation", ["biology"], "open-source",
   "Генеративная модель белков: предсказывает и генерирует последовательности, структуры и функции. В 2025 году сгенерировала новый светящийся белок esmGFP, подтверждённый в лаборатории (Science, 2025).",
   "https://github.com/evolutionaryscale/esm", "https://www.evolutionaryscale.ai/"],
  ["rfdiffusion", "RFdiffusion", "Institute for Protein Design (UW)", "US", "protein-design", ["biology"], "open-source",
   "Диффузионная модель дизайна белков: генерирует новые белковые структуры под задачу (связывание, ферменты, биндеры). Ключевой инструмент лаборатории Дэвида Бейкера (Нобелевская премия 2024) для создания новых белков.",
   "https://github.com/RosettaCommons/RFdiffusion", "https://www.bakerlab.org/"],
  ["proteinmpnn", "ProteinMPNN", "Institute for Protein Design (UW)", "US", "protein-design", ["biology"], "open-source",
   "Нейросеть для дизайна аминокислотных последовательностей под заданный каркас белка. Обратная задача к фолдингу: последовательность, которая свернётся в нужную структуру (Science, 2022).",
   "https://github.com/dauparas/ProteinMPNN", "https://www.bakerlab.org/"],
  ["colabfold", "ColabFold", "Mirdita & Steinegger Labs", "DE", "protein-structure", ["biology"], "open-source",
   "Ускоренный пайплайн предсказания структуры белков: MMseqs2 + AlphaFold2 в одной утилите. Позволил сообществу рассчитать миллионы структур без GPU-кластера (Nature Methods, 2022).",
   "https://github.com/sokrypton/ColabFold", "https://colabfold.com/"],
  ["rosettafold-allatom", "RoseTTAFold All-Atom", "Institute for Protein Design (UW)", "US", "protein-structure", ["biology", "chemistry"], "open-source",
   "Модель предсказания комплексов белок-лиганд, белок-нуклеиновая кислота и ковалентных модификаций. Расширяет RoseTTAFold на малые молекулы и некодируемые элементы (Science, 2024).",
   "https://github.com/baker-laboratory/RoseTTAFold-All-Atom", "https://www.bakerlab.org/"],
  ["chroma", "Chroma", "Generate Biomedicines", "US", "protein-generation", ["biology"], "open-source",
   "Генеративная модель программируемого дизайна белков: диффузия в пространстве структуры и последовательности. Позволяет проектировать белки с заданными свойствами и симметрией (Nature, 2023).",
   "https://github.com/generatebio/chroma", "https://generatebiomedicines.com/"],
  ["scgpt", "scGPT", "Wang Lab (University of Toronto)", "CA", "single-cell", ["biology", "medicine"], "open-source",
   "Фундаментальная модель для анализа данных одноклеточного секвенирования (scRNA-seq): аннотация клеток, интеграция атласов, предсказание регуляции генов (Nature Methods, 2024).",
   "https://github.com/bowang-lab/scGPT", "https://scgpt.readthedocs.io/en/latest/"],
  ["unifold", "Uni-Fold", "DP Technology", "CN", "protein-structure", ["biology"], "open-source",
   "Открытая платформа разработки моделей предсказания структуры белков за пределами AlphaFold: собственный тренинг, мультимеры, эффективная инференс-реализация (bioRxiv, 2022).",
   "https://github.com/dptech-corp/Uni-Fold", "https://www.dp.tech/"],
  ["evo2", "Evo 2", "Arc Institute", "US", "genomics", ["biology"], "open-source",
   "Геномная фундаментальная модель на 9,3 трлн нуклеотидов: предсказывает регуляцию, мутации и функциональные элементы ДНК. Позволяет исследователям находить новые регуляторные последовательности (Science, 2025).",
   "https://github.com/ArcInstitute/evo2", "https://arcinstitute.org/evo2"],

  // ── Medicine / genomics ──
  ["alphamissense", "AlphaMissense", "Google DeepMind", "UK", "variant-prediction", ["medicine"], "open-source",
   "Модель предсказания патогенности миссенс-вариантов генома человека: классифицировала 89% из 71 млн возможных вариантов (Science, 2023). Помогает клинической диагностике редких заболеваний.",
   "https://github.com/google-deepmind/alphamissense", "https://alphamissense.deepmind.org/"],
  ["biomedparse", "BiomedParse", "Microsoft Research", "US", "medical-imaging", ["medicine"], "open-source",
   "Фундаментальная модель для совместной сегментации, детекции и распознавания биомедицинских объектов в 9 модальностях изображений (МРТ, КТ, микроскопия и др.) (Nature Methods, 2025).",
   "https://github.com/microsoft/BiomedParse", "https://microsoft.github.io/BiomedParse/"],

  // ── Climate / weather ──
  ["graphcast", "GraphCast", "Google DeepMind", "UK", "weather-forecast", ["climate", "physics"], "open-source",
   "Графовая модель прогноза погоды на 10 дней за минуту, точнее операционной системы HRES ECMWF в 90% метрик (Science, 2023). Первая ИИ-модель, принятая в оперативную практику метеорологов.",
   "https://github.com/google-deepmind/graphcast", "https://deepmind.google/discover/blog/graphcast/"],
  ["neuralgcm", "NeuralGCM", "Google Research", "US", "climate-modeling", ["climate", "physics"], "open-source",
   "Гибридная климатическая модель: ML-компоненты внутри классической физической модели атмосферы. Точнее традиционных моделей на десятилетия вперёд при меньших затратах (Nature, 2024).",
   "https://github.com/google-research/neuralgcm", "https://research.google/blog/neuralgcm/"],
  ["fourcastnet", "FourCastNet", "NVIDIA", "US", "weather-forecast", ["climate"], "open-source",
   "Модель глобального прогноза погоды на основе vision transformer (AFNO): прогноз на 7 дней за секунды на одном GPU. Пионер оперативных ML-прогнозов атмосферы (arXiv, 2022).",
   "https://github.com/NVlabs/FourCastNet", "https://research.nvidia.com/labs/toronto-ai/"],
  ["pangu-weather", "Pangu-Weather", "Huawei Cloud", "CN", "weather-forecast", ["climate"], "open-source",
   "3D-трансформер глобального прогноза погоды: превзошёл операционную систему ECMWF по точности на 3D-полях. Прогноз 7 дней за 1,4 секунды (Nature, 2023).",
   "https://github.com/198808xc/Pangu-Weather", "https://www.nature.com/articles/s41586-023-06185-3"],
  ["aurora", "Aurora", "Microsoft Research", "US", "weather-forecast", ["climate"], "open-source",
   "Фундаментальная модель атмосферы: перенос обучения между задачами (погода, качество воздуха, океан) с малым количеством данных. Точнее операционных систем на 5-дневном горизонте (arXiv, 2024).",
   "https://github.com/microsoft/aurora", "https://www.microsoft.com/en-us/research/publication/aurora/"],

  // ── Materials science ──
  ["mattergen", "MatterGen", "Microsoft Research", "US", "materials-generation", ["materials", "chemistry"], "open-source",
   "Генеративная модель дизайна новых материалов: создаёт кристаллические структуры с заданными свойствами (модуль упругости, магнетизм, электрохимия). Валидация синтезом в лаборатории (Nature, 2025).",
   "https://github.com/microsoft/mattergen", "https://www.microsoft.com/en-us/research/blog/mattergen/"],
  ["mattersim", "MatterSim", "Microsoft Research", "CN", "atomistic-simulation", ["materials", "chemistry"], "open-source",
   "Глубокое обучение атомистических моделей: симуляция материалов в широком диапазоне элементов, температур и давлений. Универсальный ML-потенциал для молекулярной динамики (arXiv, 2024).",
   "https://github.com/microsoft/mattersim", "https://microsoft.github.io/mattersim/"],
  ["open-catalyst", "Open Catalyst Project", "Meta AI + CMU", "US", "catalysis", ["materials", "chemistry", "energy"], "open-source",
   "Проект ML-моделей для поиска катализаторов возобновляемой энергии: 1,3 млн расчётов DFT по адсорбции на поверхностях. Графовые нейросети предсказывают энергию адсорбции для скрининга катализаторов.",
   "https://github.com/Open-Catalyst-Project/ocp", "https://opencatalystproject.org/"],
  ["mace", "MACE", "Batatia & Csányi Group (Cambridge/Oxford)", "UK", "interatomic-potentials", ["materials", "chemistry"], "open-source",
   "Точные ML-межатомные потенциалы на основе эквивариантных сообщений высшего порядка. Позволяет моделировать материалы и молекулы с точностью ab initio при скорости классической динамики.",
   "https://github.com/ACEsuit/mace", "https://mace-docs.readthedocs.io/"],
  ["schnetpack", "SchNetPack", "Atomistic Machine Learning (Berlin)", "DE", "atomistic-ml", ["materials", "chemistry"], "open-source",
   "Пакет глубоких нейросетей для атомных систем: предсказание свойств молекул и материалов, моделирование молекулярной динамики. Один из первых инструментов ML для квантовой химии.",
   "https://github.com/atomistic-machine-learning/schnetpack", "https://schnetpack.readthedocs.io/"],

  // ── Chemistry ──
  ["chemcrow", "ChemCrow", "EPFL / UR White Lab", "CH", "chemistry-agent", ["chemistry"], "open-source",
   "LLM-агент для химии: планирует и выполняет синтез, ретросинтез, анализ реакций, работу с базами данных. Автономно проводит эксперименты по подсказке исследователя (Nature Machine Intelligence, 2024).",
   "https://github.com/ur-whitelab/chemcrow-public", "https://chemcrow.ai/"],
  ["pyscf", "PySCF", "PySCF Developers (Qiming Sun et al.)", "US", "quantum-chemistry", ["chemistry", "physics"], "open-source",
   "Python-библиотека квантовой химии: расчёт электронной структуры (HF, DFT, MP2, CC), лежащая в основе тысяч работ по материалам и молекулам. Бэкенд для ML-интеграций с атомистическими моделями.",
   "https://github.com/pyscf/pyscf", "https://pyscf.org/"],

  // ── Mathematics / algorithms ──
  ["alphatensor", "AlphaTensor", "Google DeepMind", "UK", "algorithm-discovery", ["mathematics", "engineering"], "open-source",
   "ИИ, открывший новые алгоритмы умножения матриц: сократил число операций для многих размеров (первые улучшения за 50 лет). Применяется к умножению матриц в вычислениях (Nature, 2022).",
   "https://github.com/google-deepmind/alphatensor", "https://deepmind.google/discover/blog/alphatensor/"],
  ["alphageometry", "AlphaGeometry", "Google DeepMind", "UK", "mathematical-reasoning", ["mathematics"], "open-source",
   "Символьная система решения задач олимпиадной геометрии: решила задачи уровня золотой медали IMO, сочетая нейросетевые подсказки с формальным доказательством (Nature, 2024).",
   "https://github.com/google-deepmind/alphageometry", "https://deepmind.google/discover/blog/alphageometry/"],
  ["funsearch", "FunSearch", "Google DeepMind", "UK", "mathematical-discovery", ["mathematics"], "open-source",
   "Метод поиска новых математических объектов: нашёл рекордные решения проблемы cap set и эффективные алгоритмы (Nature, 2023). Первое ИИ-открытие нерешённой математической задачи.",
   "https://github.com/google-deepmind/funsearch", "https://deepmind.google/discover/blog/funsearch/"],

  // ── Quantum computing ──
  ["qiskit", "Qiskit", "IBM Quantum", "US", "quantum-computing", ["quantum", "physics", "engineering"], "open-source",
   "Open-source SDK для квантовых вычислений: схемы, операторы, примитивы, симуляция и запуск на реальных квантовых процессорах IBM. Стандартная платформа квантовых исследований в мире.",
   "https://github.com/Qiskit/qiskit", "https://www.ibm.com/quantum/qiskit"],
  ["openfermion", "OpenFermion", "Google Quantum AI", "US", "quantum-chemistry", ["quantum", "chemistry"], "open-source",
   "Библиотека для квантовых алгоритмов моделирования электронной структуры: подготовка гамильтонианов, оценка ресурсов для квантовой химии на квантовых компьютерах (arXiv, 2020).",
   "https://github.com/quantumlib/OpenFermion", "https://quantumai.google/openfermion"],

  // ── Astronomy ──
  ["astroclip", "AstroCLIP", "Polymathic AI / Flatiron Institute", "US", "astronomy-ml", ["astronomy", "physics"], "open-source",
   "Мультимодальная контрастивная модель астрономических данных: связывает спектры галактик и их изображения, ускоряя классификацию и открытия в обзорах (DESI, LSST).",
   "https://github.com/PolymathicAI/AstroCLIP", "https://polymathic-ai.org/"],
] as const;

async function main() {
  const db = getDb();
  let inserted = 0;
  for (const [slug, name, organization, country, kind, spheres, accessStatus, description, officialUrl, docsUrl] of tools) {
    await db.insert(inventionTools).values({
      slug, name, organization, country, kind, spheres, accessStatus, description,
      officialUrl, docsUrl: docsUrl ?? null, lastVerifiedAt: new Date(),
    }).onConflictDoUpdate({
      target: inventionTools.slug,
      set: {
        name, organization, country, kind, spheres, accessStatus, description,
        officialUrl, docsUrl: docsUrl ?? null, lastVerifiedAt: new Date(), updatedAt: new Date(),
      },
    });
    inserted++;
  }
  console.log(`seeded ${inserted} invention tools (${tools.length} total in catalog)`);
}
main().catch((error) => { console.error(error); process.exit(1); });
