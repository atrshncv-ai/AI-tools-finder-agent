export interface AgentState {
  id: string;
  status: "idle" | "running" | "error" | "paused";
  lastRun: Date | null;
  lastError: string | null;
  runCount: number;
  successCount: number;
  failCount: number;
}

export interface SourceHealth {
  sourceId: number;
  sourceName: string;
  status: "healthy" | "degraded" | "failed" | "unknown";
  lastCheck: Date | null;
  lastSuccess: Date | null;
  lastError: string | null;
  consecutiveFails: number;
  successRate: number;
  avgResponseTime: number;
  selectorWorks: boolean;
  runCount: number;
  successCount: number;
}

export interface ParseDecision {
  sourceId: number;
  sourceName: string;
  reason: string;
  priority: "high" | "medium" | "low";
  maxArticles: number;
}

export interface ParseResult {
  sourceId: number;
  sourceName: string;
  articlesFound: number;
  articlesNew: number;
  duration: number;
  success: boolean;
  error?: string;
}

export interface SummarizeDecision {
  articleId: number;
  title: string;
  reason: string;
  priority: "high" | "medium" | "low";
}

export interface AgentMetrics {
  totalParsed: number;
  totalSummarized: number;
  totalErrors: number;
  avgParseTime: number;
  avgSummarizeTime: number;
  sourcesHealth: SourceHealth[];
}
