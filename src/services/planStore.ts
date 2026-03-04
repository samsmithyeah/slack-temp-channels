import type { AgentPlan } from "./agentPlanner";

export interface PlanData {
  id: string;
  userId: string;
  channelId: string;
  taskDescription: string;
  plan: AgentPlan;
  dmChannelId: string;
  dmMessageTs: string;
  createdAt: number;
}

const PLAN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const plans = new Map<string, PlanData>();

let nextId = 1;

export function createPlanId(): string {
  return `plan_${Date.now()}_${nextId++}`;
}

export function storePlan(data: PlanData): void {
  plans.set(data.id, data);
}

export function getPlan(planId: string): PlanData | undefined {
  const plan = plans.get(planId);
  if (!plan) return undefined;
  if (Date.now() - plan.createdAt > PLAN_TTL_MS) {
    plans.delete(planId);
    return undefined;
  }
  return plan;
}

export function deletePlan(planId: string): void {
  plans.delete(planId);
}
