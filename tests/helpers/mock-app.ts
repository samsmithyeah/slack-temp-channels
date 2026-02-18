import { vi } from "vitest";

export function createMockClient() {
  return {
    views: {
      open: vi.fn().mockResolvedValue({}),
      publish: vi.fn().mockResolvedValue({}),
    },
    conversations: {
      create: vi.fn().mockResolvedValue({ channel: { id: "C_NEW" } }),
      invite: vi.fn().mockResolvedValue({}),
      setPurpose: vi.fn().mockResolvedValue({}),
      setTopic: vi.fn().mockResolvedValue({}),
      archive: vi.fn().mockResolvedValue({}),
      join: vi.fn().mockResolvedValue({}),
      info: vi.fn().mockResolvedValue({ channel: { name: "general" } }),
    },
    chat: {
      postMessage: vi.fn().mockResolvedValue({}),
    },
  };
}

export function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

type Handler = (...args: unknown[]) => Promise<void>;

export function createMockApp() {
  const handlers: Record<string, Handler> = {};

  return {
    handlers,
    command(name: string, handler: Handler) {
      handlers[`command:${name}`] = handler;
    },
    action(nameOrPattern: string | RegExp, handler: Handler) {
      const key = typeof nameOrPattern === "string" ? nameOrPattern : nameOrPattern.toString();
      handlers[`action:${key}`] = handler;
    },
    view(name: string, handler: Handler) {
      handlers[`view:${name}`] = handler;
    },
    event(name: string, handler: Handler) {
      handlers[`event:${name}`] = handler;
    },
  };
}
