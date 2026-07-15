import { getDb } from "./connection";
import { sources } from "@db/schema";
import { eq } from "drizzle-orm";

// Каждое направление — ровно 20 источников
const ALL_SOURCES = [
  // ═══════════ 1. ОБЩИЕ ИИ-НОВОСТИ (20) ═══════════
  { name: "ArXiv cs.AI", url: "https://arxiv.org/list/cs.AI/recent", type: "rss", config: { feedUrl: "https://rss.arxiv.org/rss/cs.AI" }, enabled: true },
  { name: "ArXiv cs.CL (NLP)", url: "https://arxiv.org/list/cs.CL/recent", type: "rss", config: { feedUrl: "https://rss.arxiv.org/rss/cs.CL" }, enabled: true },
  { name: "ArXiv cs.LG (ML)", url: "https://arxiv.org/list/cs.LG/recent", type: "rss", config: { feedUrl: "https://rss.arxiv.org/rss/cs.LG" }, enabled: true },
  { name: "MIT Technology Review AI", url: "https://www.technologyreview.com/topic/artificial-intelligence", type: "rss", config: { feedUrl: "https://www.technologyreview.com/topic/artificial-intelligence/feed" }, enabled: true },
  { name: "MIT News AI", url: "https://news.mit.edu/topic/artificial-intelligence2", type: "rss", config: { feedUrl: "https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml" }, enabled: true },
  { name: "The Verge AI", url: "https://www.theverge.com/ai-artificial-intelligence", type: "html", config: { selector: "h2 a, h3 a, article a" }, enabled: true },
  { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/", type: "html", config: { selector: "h3 a" }, enabled: true },
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Ars Technica AI", url: "https://arstechnica.com/ai/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Wired AI", url: "https://www.wired.com/tag/artificial-intelligence/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Google DeepMind Blog", url: "https://deepmind.google/blog/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "OpenAI Blog", url: "https://openai.com/blog", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Anthropic News", url: "https://www.anthropic.com/news", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Towards Data Science", url: "https://towardsdatascience.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Papers With Code", url: "https://paperswithcode.com/", type: "html", config: { selector: "h2 a, h3 a, .paper-title a" }, enabled: true },
  { name: "MarkTechPost AI", url: "https://www.marktechpost.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Analytics India Magazine", url: "https://analyticsindiamag.com/ai-technology/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "AI News (Россия)", url: "https://ai-news.ru/", type: "html", config: { selector: "a[href$='.html']" }, enabled: true },
  { name: "Naked Science ИИ", url: "https://naked-science.ru/article", type: "html", config: { selector: "a[href*='/article/']" }, enabled: true },
  { name: "Google News AI", url: "https://news.google.com/search", type: "google_news", config: { feedUrl: "https://news.google.com/rss/search?q=artificial+intelligence&hl=en-US&gl=US&ceid=US:en" }, enabled: true },

  // ═══════════ 2. ХИМИЯ (20) ═══════════
  { name: "ArXiv chem-ph", url: "https://arxiv.org/list/chem-ph/recent", type: "rss", config: { feedUrl: "https://rss.arxiv.org/rss/chem-ph" }, enabled: true },
  { name: "C&EN", url: "https://cen.acs.org/", type: "html", config: { selector: "h2 a, h3 a, article a" }, enabled: true },
  { name: "Chemistry World", url: "https://www.chemistryworld.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "RSC News", url: "https://www.rsc.org/news", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Nature Chemistry", url: "https://www.nature.com/nchem/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "ChemRxiv", url: "https://chemrxiv.org/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "ACS Publications", url: "https://pubs.acs.org/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Angewandte Chemie", url: "https://onlinelibrary.wiley.com/journal/15213773", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Journal of Chemical Education", url: "https://pubs.acs.org/journal/jceda8", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Computational Chemistry", url: "https://www.sciencedirect.com/journal/journal-of-computational-chemistry", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Chemistry - A European Journal", url: "https://chemistry-europe.onlinelibrary.wiley.com/journal/15213773", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "ScienceDaily Chemistry", url: "https://www.sciencedaily.com/news/computers_math/artificial_intelligence/", type: "html", config: { selector: "h3 a, .story a" }, enabled: true },
  { name: "Phys.org Chemistry", url: "https://phys.org/tag/chemistry/", type: "html", config: { selector: "h3 a, .news-link a" }, enabled: true },
  { name: "Phys.org Chem-ph", url: "https://phys.org/tag/chem-ph/", type: "html", config: { selector: "h3 a, .news-link a" }, enabled: true },
  { name: "EurekAlert Chemistry", url: "https://www.eurekalert.org/news-releases/chemistry", type: "html", config: { selector: "h3 a, .news-release a" }, enabled: true },
  { name: "News-Medical Chemistry", url: "https://www.news-medical.net/chemistry.aspx", type: "html", config: { selector: "h3 a, .news-item a" }, enabled: true },
  { name: "Compound Interest", url: "https://www.compoundchem.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Chembites", url: "https://chembites.org/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "The Chemical Engineer", url: "https://www.thechemicalengineer.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Nanotechnology News", url: "https://www.nanowerk.com/nanotechnology-news.php", type: "html", config: { selector: "h3 a, .news-item a" }, enabled: true },

  // ═══════════ 3. МАТЕРИАЛОВЕДЕНИЕ (20) ═══════════
  { name: "ArXiv cond-mat.mtrl-sci", url: "https://arxiv.org/list/cond-mat.mtrl-sci/recent", type: "rss", config: { feedUrl: "https://rss.arxiv.org/rss/cond-mat.mtrl-sci" }, enabled: true },
  { name: "Nature Materials", url: "https://www.nature.com/nmat/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "Materials Today", url: "https://www.materialstoday.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "MIT News Materials", url: "https://news.mit.edu/topic/materials-science", type: "rss", config: { feedUrl: "https://news.mit.edu/topic/materials-science-rss.xml" }, enabled: true },
  { name: "Nanowerk", url: "https://www.nanowerk.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Advanced Materials", url: "https://onlinelibrary.wiley.com/journal/15214095", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Nature Nanotechnology", url: "https://www.nature.com/nnano/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "ACS Nano", url: "https://pubs.acs.org/journal/ancac3", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Nano Letters", url: "https://pubs.acs.org/journal/nalefd", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "ScienceDaily Materials", url: "https://www.sciencedaily.com/news/matter_energy/materials_science/", type: "html", config: { selector: "h3 a, .story a" }, enabled: true },
  { name: "Phys.org Materials", url: "https://phys.org/tag/materials-science/", type: "html", config: { selector: "h3 a, .news-link a" }, enabled: true },
  { name: "EurekAlert Materials", url: "https://www.eurekalert.org/news-releases/materials-science", type: "html", config: { selector: "h3 a, .news-release a" }, enabled: true },
  { name: "MRS Bulletin", url: "https://www.cambridge.org/core/journals/mrs-bulletin", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "New Scientist Materials", url: "https://www.newscientist.com/subject/physics/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "Frontiers in Materials", url: "https://www.frontiersin.org/journals/materials", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Acta Materialia", url: "https://www.sciencedirect.com/journal/acta-materialia", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Journal of Materials Science", url: "https://link.springer.com/journal/10853", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Materials Research Letters", url: "https://www.tandfonline.com/journals/mmrl20", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "ScienceDirect Materials", url: "https://www.sciencedirect.com/journal/materials-today", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Materials Science Engineering", url: "https://www.sciencedirect.com/journal/journal-of-the-mechanical-behavior-of-biomedical-materials", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },

  // ═══════════ 4. БИОЛОГИЯ (20) ═══════════
  { name: "ArXiv q-bio", url: "https://arxiv.org/list/q-bio/recent", type: "rss", config: { feedUrl: "https://rss.arxiv.org/rss/q-bio" }, enabled: true },
  { name: "Nature Biotechnology", url: "https://www.nature.com/nbt/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "Nature Methods", url: "https://www.nature.com/nmeth/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "STAT News Biotech", url: "https://www.statnews.com/category/biotech/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Cell.com News", url: "https://www.cell.com/cell-news", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Science.org Biology", url: "https://www.science.org/topic/category/life-sciences", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "PNAS News", url: "https://www.pnas.org/action/showFeed?type=etoc&feed=rss&jc=pnas", type: "rss", config: { feedUrl: "https://www.pnas.org/action/showFeed?type=etoc&feed=rss&jc=pnas" }, enabled: true },
  { name: "Biorxiv", url: "https://www.biorxiv.org/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "The Scientist", url: "https://www.the-scientist.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Genetic Engineering News", url: "https://www.genengnews.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "ScienceDaily Biology", url: "https://www.sciencedaily.com/news/plants_animals/", type: "html", config: { selector: "h3 a, .story a" }, enabled: true },
  { name: "Phys.org Biology", url: "https://phys.org/tag/biology/", type: "html", config: { selector: "h3 a, .news-link a" }, enabled: true },
  { name: "Phys.org Molecular Biology", url: "https://phys.org/tag/molecular-biology/", type: "html", config: { selector: "h3 a, .news-link a" }, enabled: true },
  { name: "EurekAlert Bio", url: "https://www.eurekalert.org/news-releases/biology", type: "html", config: { selector: "h3 a, .news-release a" }, enabled: true },
  { name: "Nature News Bio", url: "https://www.nature.com/subjects/biological-sciences", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "F1000Research", url: "https://f1000research.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Lab Roots Bio", url: "https://www.labroots.com/category/biology", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "News-Medical Life Sciences", url: "https://www.news-medical.net/life-sciences.aspx", type: "html", config: { selector: "h3 a, .news-item a" }, enabled: true },
  { name: "Bioinformatics.org", url: "https://www.bioinformatics.org/", type: "html", config: { selector: "h3 a, td a" }, enabled: true },
  { name: "ScienceDaily Bio", url: "https://www.sciencedaily.com/news/computers_math/artificial_intelligence/", type: "html", config: { selector: "h3 a, .story a" }, enabled: true },

  // ═══════════ 5. МЕДИЦИНА (20) ═══════════
  { name: "STAT News Medicine", url: "https://www.statnews.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "MedPage Today", url: "https://www.medpagetoday.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Nature Medicine", url: "https://www.nature.com/nm/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "Science Translational Medicine", url: "https://www.science.org/journal/stm", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "The Lancet News", url: "https://www.thelancet.com/press-releases", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "JAMA Network", url: "https://jamanetwork.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "New England Journal", url: "https://www.nejm.org/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Medical News Today", url: "https://www.medicalnewstoday.com/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "Medical Xpress", url: "https://medicalxpress.com/", type: "html", config: { selector: "h3 a, .news-link a" }, enabled: true },
  { name: "WebMD Health News", url: "https://www.webmd.com/news", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "HealthDay", url: "https://consumer.healthday.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Medscape", url: "https://www.medscape.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "BioPharma Dive", url: "https://www.biopharmadive.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Fierce Healthcare", url: "https://www.fiercehealthcare.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "NIH News", url: "https://www.nih.gov/news-events/news-releases", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "ScienceDaily Medicine", url: "https://www.sciencedaily.com/news/health_medicine/", type: "html", config: { selector: "h3 a, .story a" }, enabled: true },
  { name: "Phys.org Medicine", url: "https://phys.org/tag/medicine/", type: "html", config: { selector: "h3 a, .news-link a" }, enabled: true },
  { name: "EurekAlert Medicine", url: "https://www.eurekalert.org/news-releases/health_medicine", type: "html", config: { selector: "h3 a, .news-release a" }, enabled: true },
  { name: "News-Medical Health", url: "https://www.news-medical.net/health.aspx", type: "html", config: { selector: "h3 a, .news-item a" }, enabled: true },
  { name: "Medicine.io", url: "https://medicine.io/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },

  // ═══════════ 6. ФИЗИКА (20) ═══════════
  { name: "ArXiv physics", url: "https://arxiv.org/list/physics/recent", type: "rss", config: { feedUrl: "https://rss.arxiv.org/rss/physics" }, enabled: true },
  { name: "ArXiv physics.optics", url: "https://arxiv.org/list/physics.optics/recent", type: "rss", config: { feedUrl: "https://rss.arxiv.org/rss/physics.optics" }, enabled: true },
  { name: "ArXiv astro-ph", url: "https://arxiv.org/list/astro-ph/recent", type: "rss", config: { feedUrl: "https://rss.arxiv.org/rss/astro-ph" }, enabled: true },
  { name: "ArXiv nucl-th", url: "https://arxiv.org/list/nucl-th/recent", type: "rss", config: { feedUrl: "https://rss.arxiv.org/rss/nucl-th" }, enabled: true },
  { name: "Physics World", url: "https://www.physicsworld.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Symmetry Magazine", url: "https://symmetrymagazine.org/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Quanta Magazine", url: "https://www.quantamagazine.org/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "CERN Courier", url: "https://cerncourier.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Nature Physics", url: "https://www.nature.com/nphys/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "Physical Review Letters", url: "https://journals.aps.org/prl/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Science.org Physics", url: "https://www.science.org/topic/category/physics", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "Live Science", url: "https://www.livescience.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Space.com", url: "https://www.space.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Scientific American Physics", url: "https://www.scientificamerican.com/physics/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "New Scientist Physics", url: "https://www.newscientist.com/subject/physics/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "APS Physics", url: "https://physics.aps.org/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "ScienceDaily Physics", url: "https://www.sciencedaily.com/news/space_time/", type: "html", config: { selector: "h3 a, .story a" }, enabled: true },
  { name: "Phys.org Physics", url: "https://phys.org/", type: "html", config: { selector: "h3 a, .news-link a" }, enabled: true },
  { name: "Nature News Physics", url: "https://www.nature.com/subjects/physics", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "EurekAlert Physics", url: "https://www.eurekalert.org/news-releases/computers_math", type: "html", config: { selector: "h3 a, .news-release a" }, enabled: true },

  // ═══════════ 7. ИНЖЕНЕРИЯ (20) ═══════════
  { name: "ArXiv cs.RO (Robotics)", url: "https://arxiv.org/list/cs.RO/recent", type: "rss", config: { feedUrl: "https://rss.arxiv.org/rss/cs.RO" }, enabled: true },
  { name: "MIT News Manufacturing", url: "https://news.mit.edu/topic/manufacturing", type: "rss", config: { feedUrl: "https://news.mit.edu/topic/manufacturing-rss.xml" }, enabled: true },
  { name: "MIT News EECS", url: "https://news.mit.edu/topic/electrical-engineering-computer-science-eecs", type: "rss", config: { feedUrl: "https://news.mit.edu/topic/electrical-engineering-computer-science-eecs-rss.xml" }, enabled: true },
  { name: "IEEE Spectrum AI", url: "https://spectrum.ieee.org/topic/artificial-intelligence/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "IEEE Spectrum Robotics", url: "https://spectrum.ieee.org/topic/robotics/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "IEEE Spectrum Computing", url: "https://spectrum.ieee.org/topic/computing/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "IEEE Spectrum Nanotech", url: "https://spectrum.ieee.org/topic/nanotechnology/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "IEEE Spectrum Energy", url: "https://spectrum.ieee.org/topic/energy/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "IEEE Transactions", url: "https://ieeexplore.ieee.org/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "The Robot Report", url: "https://www.therobotreport.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Robotics Business Review", url: "https://roboticsbusinessreview.com/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "Science Robotics", url: "https://www.science.org/journal/scirobotics", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "Nature Electronics", url: "https://www.nature.com/nelectronics/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "Nature Reviews Electrical Engineering", url: "https://www.nature.com/s41928/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "ScienceDaily Engineering", url: "https://www.sciencedaily.com/news/computers_math/artificial_intelligence/", type: "html", config: { selector: "h3 a, .story a" }, enabled: true },
  { name: "Phys.org Engineering", url: "https://phys.org/tag/engineering/", type: "html", config: { selector: "h3 a, .news-link a" }, enabled: true },
  { name: "EurekAlert Engineering", url: "https://www.eurekalert.org/news-releases/computers_math", type: "html", config: { selector: "h3 a, .news-release a" }, enabled: true },
  { name: "New Scientist Technology", url: "https://www.newscientist.com/subject/technology/", type: "html", config: { selector: "h3 a, article a" }, enabled: true },
  { name: "Ars Technica Science", url: "https://arstechnica.com/science/", type: "html", config: { selector: "h2 a, h3 a" }, enabled: true },
  { name: "MIT Technology Review Engineering", url: "https://www.technologyreview.com/topic/engineering/feed", type: "rss", config: { feedUrl: "https://www.technologyreview.com/topic/engineering/feed" }, enabled: true },
];

export async function seedSources() {
  const db = getDb();
  const existing = await db.select().from(sources);
  if (existing.length > 0) return;
  for (const source of ALL_SOURCES) {
    await db.insert(sources).values(source);
  }
}

export async function findAllSources() {
  const db = getDb();
  return db.select().from(sources);
}

export async function findEnabledSources() {
  const db = getDb();
  return db.select().from(sources).where(eq(sources.enabled, true));
}

export async function findSourceById(id: number) {
  const db = getDb();
  return db.query.sources.findFirst({ where: eq(sources.id, id) });
}

export async function addSource(data: { name: string; url: string; type: string; config?: Record<string, unknown> }) {
  const db = getDb();
  const [source] = await db.insert(sources).values({ name: data.name, url: data.url, type: data.type, config: data.config || null, enabled: true }).returning();
  return source;
}

export async function removeSource(id: number) {
  const db = getDb();
  await db.delete(sources).where(eq(sources.id, id));
}

export async function toggleSource(id: number, enabled: boolean) {
  const db = getDb();
  await db.update(sources).set({ enabled }).where(eq(sources.id, id));
}
