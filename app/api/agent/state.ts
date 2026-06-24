import type { AgentState, SourceHealth } from "./types";
import { loadAgentState, saveAgentState } from "../queries/agentState";
import { loadAllSourceHealth, saveSourceHealth } from "../queries/sourceHealth";

const agentStates = new Map<string, AgentState>();
const sourceHealthMap = new Map<number, SourceHealth>();

export async function initAgentState(agentIds: string[]): Promise<void> {
  for (const id of agentIds) {
    const persisted = await loadAgentState(id);
    if (persisted) {
      agentStates.set(id, persisted);
    } else {
      agentStates.set(id, {
        id,
        status: "idle",
        lastRun: null,
        lastError: null,
        runCount: 0,
        successCount: 0,
        failCount: 0,
      });
    }
  }
}

export async function initSourceHealthState(): Promise<void> {
  const all = await loadAllSourceHealth();
  for (const health of all) {
    sourceHealthMap.set(health.sourceId, health);
  }
}

export function getAgentState(id: string): AgentState {
  if (!agentStates.has(id)) {
    agentStates.set(id, {
      id,
      status: "idle",
      lastRun: null,
      lastError: null,
      runCount: 0,
      successCount: 0,
      failCount: 0,
    });
  }
  return agentStates.get(id)!;
}

export function updateAgentState(id: string, update: Partial<AgentState>) {
  const state = getAgentState(id);
  Object.assign(state, update);
  saveAgentState(state).catch((err) => {
    console.error("Failed to persist agent state", { agentId: id, error: err });
  });
}

export function getSourceHealth(sourceId: number): SourceHealth {
  if (!sourceHealthMap.has(sourceId)) {
    sourceHealthMap.set(sourceId, {
      sourceId,
      sourceName: "",
      status: "unknown",
      lastCheck: new Date(0),
      lastSuccess: null,
      lastError: null,
      consecutiveFails: 0,
      successRate: 1.0,
      avgResponseTime: 0,
      selectorWorks: true,
      runCount: 0,
      successCount: 0,
    });
  }
  return sourceHealthMap.get(sourceId)!;
}

export function updateSourceHealth(sourceId: number, update: Partial<SourceHealth>) {
  const health = getSourceHealth(sourceId);
  Object.assign(health, update);
  saveSourceHealth(health).catch((err) => {
    console.error("Failed to persist source health", { sourceId, error: err });
  });
}

export function getAllSourceHealth(): SourceHealth[] {
  return Array.from(sourceHealthMap.values());
}

export function shouldSkipSource(sourceId: number): boolean {
  const health = getSourceHealth(sourceId);
  if (health.consecutiveFails >= 5) return true;
  if (health.successRate < 0.2 && health.consecutiveFails >= 3) return true;
  return false;
}

export function getSourcePriority(sourceId: number): "high" | "medium" | "low" {
  const health = getSourceHealth(sourceId);
  if (health.status === "failed") return "low";
  if (health.consecutiveFails >= 3) return "low";
  if (health.consecutiveFails >= 1) return "medium";
  return "high";
}
