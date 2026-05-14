import type { WebClient } from "@slack/web-api";
import type { AgentPlan, ExecutionResult } from "./agentPlanner";

const MAX_AUTO_YOLO_STEPS = 2;

export function shouldYolo(isYolo: boolean, plan: AgentPlan): boolean {
  return isYolo || (!plan.requiresApproval && plan.steps.length <= MAX_AUTO_YOLO_STEPS);
}

export function getOutcomeReaction(result: ExecutionResult): string {
  if (result.stepsFailed === 0) return "white_check_mark";
  if (result.stepsCompleted > 0) return "warning";
  return "x";
}

export async function addReaction(
  client: WebClient,
  channel: string,
  timestamp: string,
  name: string,
): Promise<void> {
  try {
    await client.reactions.add({ channel, timestamp, name });
  } catch {
    // best-effort
  }
}

export async function removeReaction(
  client: WebClient,
  channel: string,
  timestamp: string,
  name: string,
): Promise<void> {
  try {
    await client.reactions.remove({ channel, timestamp, name });
  } catch {
    // best-effort
  }
}
