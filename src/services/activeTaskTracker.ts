const activeTasks = new Set<string>();

export function isUserActive(userId: string): boolean {
  return activeTasks.has(userId);
}

export function markActive(userId: string): void {
  activeTasks.add(userId);
}

export function markInactive(userId: string): void {
  activeTasks.delete(userId);
}
