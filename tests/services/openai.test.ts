import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenAIClient,
  formatMessagesForPrompt,
  generateSummary,
} from "../../src/services/openai";

describe("formatMessagesForPrompt", () => {
  it("returns messages with user and text", () => {
    const result = formatMessagesForPrompt([
      { user: "U1", text: "hello" },
      { user: "U2", text: "world" },
    ]);
    expect(result).toEqual([
      { user: "U1", text: "hello" },
      { user: "U2", text: "world" },
    ]);
  });

  it("filters out messages without user", () => {
    const result = formatMessagesForPrompt([{ text: "no user" }, { user: "U1", text: "has user" }]);
    expect(result).toEqual([{ user: "U1", text: "has user" }]);
  });

  it("filters out messages without text", () => {
    const result = formatMessagesForPrompt([{ user: "U1" }, { user: "U2", text: "has text" }]);
    expect(result).toEqual([{ user: "U2", text: "has text" }]);
  });

  it("filters out messages with a subtype", () => {
    const result = formatMessagesForPrompt([
      { user: "U1", text: "joined", subtype: "channel_join" },
      { user: "U2", text: "real message" },
    ]);
    expect(result).toEqual([{ user: "U2", text: "real message" }]);
  });

  it("truncates messages longer than 500 characters", () => {
    const longText = "a".repeat(600);
    const result = formatMessagesForPrompt([{ user: "U1", text: longText }]);
    expect(result[0].text).toHaveLength(500);
  });

  it("limits to 100 messages, keeping the most recent", () => {
    const messages = Array.from({ length: 150 }, (_, i) => ({
      user: "U1",
      text: `message ${i}`,
    }));
    const result = formatMessagesForPrompt(messages);
    expect(result).toHaveLength(100);
    expect(result[0].text).toBe("message 50");
    expect(result[99].text).toBe("message 149");
  });
});

describe("createOpenAIClient", () => {
  const originalEnv = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalEnv) {
      process.env.OPENAI_API_KEY = originalEnv;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("throws when OPENAI_API_KEY is not set", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => createOpenAIClient()).toThrow("OPENAI_API_KEY environment variable is not set");
  });

  it("returns a client when key is set", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const client = createOpenAIClient();
    expect(client).toBeDefined();
  });
});

describe("generateSummary", () => {
  it("returns trimmed content from OpenAI response", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "  - Decision one\n- Decision two  " } }],
          }),
        },
      },
    };

    const result = await generateSummary(
      mockClient as unknown as Parameters<typeof generateSummary>[0],
      [{ user: "U1", text: "hello" }],
    );

    expect(result).toBe("- Decision one\n- Decision two");
  });

  it("throws when response has no content", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: null } }],
          }),
        },
      },
    };

    await expect(
      generateSummary(mockClient as unknown as Parameters<typeof generateSummary>[0], [
        { user: "U1", text: "hello" },
      ]),
    ).rejects.toThrow("OpenAI returned an empty response");
  });

  it("throws when response has no choices", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({ choices: [] }),
        },
      },
    };

    await expect(
      generateSummary(mockClient as unknown as Parameters<typeof generateSummary>[0], [
        { user: "U1", text: "hello" },
      ]),
    ).rejects.toThrow("OpenAI returned an empty response");
  });

  it("passes correct model and temperature", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "summary" } }],
    });
    const mockClient = { chat: { completions: { create: mockCreate } } };

    await generateSummary(mockClient as unknown as Parameters<typeof generateSummary>[0], [
      { user: "U1", text: "hello" },
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        temperature: 0.3,
      }),
    );
  });
});
