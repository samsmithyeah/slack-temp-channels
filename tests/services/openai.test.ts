import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiKeyMissingError,
  createOpenAIClient,
  extractUserIds,
  formatMessagesForPrompt,
  generateSummary,
  resolveNamesInMessages,
  restoreUserMentions,
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

  it("truncates messages longer than 500 characters with ellipsis", () => {
    const longText = "a".repeat(600);
    const result = formatMessagesForPrompt([{ user: "U1", text: longText }]);
    expect(result[0].text).toHaveLength(500);
    expect(result[0].text).toMatch(/\.\.\.$/);
  });

  it("does not truncate messages at or under 500 characters", () => {
    const text = "a".repeat(500);
    const result = formatMessagesForPrompt([{ user: "U1", text }]);
    expect(result[0].text).toBe(text);
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

describe("extractUserIds", () => {
  it("extracts user IDs from the user field", () => {
    const result = extractUserIds([
      { user: "U1", text: "hello" },
      { user: "U2", text: "world" },
    ]);
    expect(result).toEqual(expect.arrayContaining(["U1", "U2"]));
    expect(result).toHaveLength(2);
  });

  it("extracts user IDs from mentions in text", () => {
    const result = extractUserIds([{ user: "U1", text: "hey <@U2JHSBDLN> what do you think?" }]);
    expect(result).toEqual(expect.arrayContaining(["U1", "U2JHSBDLN"]));
    expect(result).toHaveLength(2);
  });

  it("deduplicates user IDs", () => {
    const result = extractUserIds([
      { user: "U1", text: "hey <@U1> and <@U2>" },
      { user: "U2", text: "hi" },
    ]);
    expect(result).toEqual(expect.arrayContaining(["U1", "U2"]));
    expect(result).toHaveLength(2);
  });
});

describe("resolveNamesInMessages", () => {
  it("replaces user field with display name", () => {
    const names = new Map([["U1", "sam.smith"]]);
    const result = resolveNamesInMessages([{ user: "U1", text: "hello" }], names);
    expect(result).toEqual([{ user: "sam.smith", text: "hello" }]);
  });

  it("replaces mentions in text with display names", () => {
    const names = new Map([
      ["U1", "sam.smith"],
      ["U2", "jane.doe"],
    ]);
    const result = resolveNamesInMessages(
      [{ user: "U1", text: "hey <@U2> what do you think?" }],
      names,
    );
    expect(result).toEqual([{ user: "sam.smith", text: "hey jane.doe what do you think?" }]);
  });

  it("keeps original ID when no name mapping exists", () => {
    const names = new Map<string, string>();
    const result = resolveNamesInMessages([{ user: "U1", text: "hey <@U2>" }], names);
    expect(result).toEqual([{ user: "U1", text: "hey U2" }]);
  });
});

describe("restoreUserMentions", () => {
  it("replaces display names with Slack mentions", () => {
    const names = new Map([["U1", "sam.smith"]]);
    const result = restoreUserMentions("sam.smith was assigned to cook dinner.", names);
    expect(result).toBe("<@U1> was assigned to cook dinner.");
  });

  it("replaces multiple different names", () => {
    const names = new Map([
      ["U1", "sam.smith"],
      ["U2", "jane.doe"],
    ]);
    const result = restoreUserMentions("sam.smith and jane.doe discussed the plan.", names);
    expect(result).toBe("<@U1> and <@U2> discussed the plan.");
  });

  it("replaces all occurrences of the same name", () => {
    const names = new Map([["U1", "sam.smith"]]);
    const result = restoreUserMentions("sam.smith assigned the task to sam.smith.", names);
    expect(result).toBe("<@U1> assigned the task to <@U1>.");
  });

  it("returns text unchanged when no names match", () => {
    const names = new Map([["U1", "sam.smith"]]);
    const result = restoreUserMentions("Dinner was decided.", names);
    expect(result).toBe("Dinner was decided.");
  });

  it("matches longer names first to avoid partial replacements", () => {
    const names = new Map([
      ["U1", "sam"],
      ["U2", "sam.smith"],
    ]);
    const result = restoreUserMentions("sam.smith decided.", names);
    expect(result).toBe("<@U2> decided.");
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

  it("throws ApiKeyMissingError when OPENAI_API_KEY is not set", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => createOpenAIClient()).toThrow(ApiKeyMissingError);
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
        model: "gpt-5-mini",
      }),
    );
  });
});
