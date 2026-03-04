interface ExecutionData {
  id: string;
  userId: string;
  channelId: string;
  summary: string;
  createdAt: number;
}

const EXECUTION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const executions = new Map<string, ExecutionData>();

let nextId = 1;

export function createExecutionId(): string {
  return `exec_${Date.now()}_${nextId++}`;
}

export function storeExecution(data: ExecutionData): void {
  executions.set(data.id, data);
}

export function getExecution(executionId: string): ExecutionData | undefined {
  const exec = executions.get(executionId);
  if (!exec) return undefined;
  if (Date.now() - exec.createdAt > EXECUTION_TTL_MS) {
    executions.delete(executionId);
    return undefined;
  }
  return exec;
}

export function deleteExecution(executionId: string): void {
  executions.delete(executionId);
}

// Proactively sweep expired entries every 10 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [id, data] of executions) {
      if (now - data.createdAt > EXECUTION_TTL_MS) executions.delete(id);
    }
  },
  10 * 60 * 1000,
).unref();
