import { eq } from "drizzle-orm";
import { getDb } from "./connection";
import { agentState } from "@db/schema";
import type { AgentState } from "../agent/types";

export async function loadAgentState(agentId: string): Promise<AgentState | null> {
  const db = getDb();
  const row = await db.query.agentState.findFirst({
    where: eq(agentState.agentId, agentId),
  });
  if (!row) return null;
  return {
    id: row.agentId,
    status: row.status as AgentState["status"],
    lastRun: row.lastRun,
    lastError: row.lastError,
    runCount: row.runCount,
    successCount: row.successCount,
    failCount: row.failCount,
  };
}

export async function saveAgentState(state: AgentState): Promise<void> {
  const db = getDb();
  await db
    .insert(agentState)
    .values({
      agentId: state.id,
      status: state.status,
      lastRun: state.lastRun,
      lastError: state.lastError,
      runCount: state.runCount,
      successCount: state.successCount,
      failCount: state.failCount,
    })
    .onConflictDoUpdate({
      target: agentState.agentId,
      set: {
        status: state.status,
        lastRun: state.lastRun,
        lastError: state.lastError,
        runCount: state.runCount,
        successCount: state.successCount,
        failCount: state.failCount,
        updatedAt: new Date(),
      },
    });
}
