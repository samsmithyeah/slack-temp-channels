import type { WebClient } from "@slack/web-api";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { resolveUserNames } from "./channelHistory";

// --- Constants ---

const MAX_READ_OUTPUT_CHARS = 15_000;
const DEFAULT_READ_LIMIT = 100;
const MAX_READ_LIMIT = 200;

// --- Read tool definitions ---

const readChannelHistoryTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "read_channel_history",
    description:
      "Read recent message history from the channel. Returns messages in chronological order with timestamps, authors, and text. Each message notes if it has thread replies.",
    parameters: {
      type: "object",
      properties: {
        oldest: {
          type: "string",
          description: "Only messages after this Unix timestamp (optional)",
        },
        latest: {
          type: "string",
          description: "Only messages before this Unix timestamp (optional)",
        },
        limit: {
          type: "number",
          description: `Maximum number of messages to return (default ${DEFAULT_READ_LIMIT}, max ${MAX_READ_LIMIT})`,
        },
      },
      required: [],
    },
  },
};

const readThreadTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "read_thread",
    description: `Read replies in a specific message thread. Returns the parent message and up to ${MAX_READ_LIMIT} replies with timestamps, authors, and text.`,
    parameters: {
      type: "object",
      properties: {
        thread_ts: {
          type: "string",
          description: "The timestamp of the parent message whose thread to read",
        },
      },
      required: ["thread_ts"],
    },
  },
};

// --- Write tool definitions ---

const replyToMessageTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "reply_to_message",
    description: "Reply in a thread to a specific message in the channel",
    parameters: {
      type: "object",
      properties: {
        thread_ts: {
          type: "string",
          description: "The timestamp of the parent message to reply to",
        },
        text: {
          type: "string",
          description: "The reply text (supports Slack mrkdwn formatting)",
        },
      },
      required: ["thread_ts", "text"],
    },
  },
};

const postChannelMessageTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "post_channel_message",
    description: "Post a new top-level message to the channel",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The message text (supports Slack mrkdwn formatting)",
        },
      },
      required: ["text"],
    },
  },
};

// --- submit_plan tool definition (used during planning only) ---

const SUBMIT_PLAN_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "submit_plan",
    description:
      "Submit your final plan after reading the conversation. Call this exactly once when you are ready.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "A 1-2 sentence description of what you will do",
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: {
                type: "string",
                description: "What this step does (human-readable)",
              },
              toolName: {
                type: "string",
                enum: ["reply_to_message", "post_channel_message"],
                description: "Which tool to use",
              },
              reasoning: {
                type: "string",
                description: "Why this step is needed",
              },
            },
            required: ["description", "toolName", "reasoning"],
          },
        },
      },
      required: ["summary", "steps"],
    },
  },
};

// --- Tool sets ---

const READ_TOOLS: ChatCompletionTool[] = [readChannelHistoryTool, readThreadTool];
const WRITE_TOOLS: ChatCompletionTool[] = [replyToMessageTool, postChannelMessageTool];
export const PLAN_TOOLS: ChatCompletionTool[] = [...READ_TOOLS, SUBMIT_PLAN_TOOL];
export const ALL_TOOLS: ChatCompletionTool[] = [...READ_TOOLS, ...WRITE_TOOLS];

// --- Types ---

export interface ToolContext {
  client: WebClient;
  channelId: string;
  userId?: string;
}

interface ToolResult {
  success: boolean;
  output: string;
}

// --- Tool execution ---

type ToolHandler = (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;

function validateStringArgs(args: Record<string, unknown>, required: string[]): string | undefined {
  for (const key of required) {
    if (typeof args[key] !== "string" || (args[key] as string).trim() === "") {
      return `Missing or empty required argument: ${key}`;
    }
  }
  return undefined;
}

/** Format a single message line for tool output. */
function formatLine(
  ts: string | undefined,
  user: string | undefined,
  text: string | undefined,
  userNames: Map<string, string>,
  replyCount?: number,
): string {
  const name = user ? (userNames.get(user) ?? user) : "Unknown";
  const sanitized = (text ?? "").replace(/\n/g, " ");
  const threadNote = replyCount && replyCount > 0 ? ` [${replyCount} replies]` : "";
  return `[ts:${ts ?? "unknown"}] ${name}: ${sanitized}${threadNote}`;
}

/** Truncate output text to MAX_READ_OUTPUT_CHARS, dropping oldest lines first. */
function truncateOutput(text: string): string {
  if (text.length <= MAX_READ_OUTPUT_CHARS) return text;
  const truncated = text.slice(-MAX_READ_OUTPUT_CHARS);
  const firstNewline = truncated.indexOf("\n");
  if (firstNewline > 0) return truncated.slice(firstNewline + 1);
  return truncated;
}

interface SlackMessage {
  user?: string;
  text?: string;
  ts?: string;
  subtype?: string;
  reply_count?: number;
}

function messageBlocksWithAttribution(text: string, userId: string) {
  return [
    { type: "section", text: { type: "mrkdwn", text } },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `AI agent task triggered by <@${userId}>` }],
    },
  ];
}

const toolHandlers: Record<string, ToolHandler> = {
  // --- Read tools ---

  read_channel_history: async (ctx, args) => {
    const limit = Math.min(
      Math.max(1, typeof args.limit === "number" ? args.limit : DEFAULT_READ_LIMIT),
      MAX_READ_LIMIT,
    );

    const historyArgs: Record<string, unknown> = {
      channel: ctx.channelId,
      limit,
    };
    if (typeof args.oldest === "string" && args.oldest) historyArgs.oldest = args.oldest;
    if (typeof args.latest === "string" && args.latest) historyArgs.latest = args.latest;

    const result = await ctx.client.conversations.history(
      historyArgs as unknown as Parameters<typeof ctx.client.conversations.history>[0],
    );
    const messages = (result.messages ?? []) as SlackMessage[];

    // Reverse to chronological order (API returns newest-first)
    messages.reverse();

    // Filter out join/leave system messages
    const userMessages = messages.filter(
      (m) => m.subtype !== "channel_join" && m.subtype !== "channel_leave",
    );

    if (userMessages.length === 0) {
      return { success: true, output: "No messages found in channel." };
    }

    // Resolve user names
    const userIds = [...new Set(userMessages.map((m) => m.user).filter(Boolean) as string[])];
    const userNames = await resolveUserNames(ctx.client, userIds);

    const lines = userMessages.map((m) =>
      formatLine(m.ts, m.user, m.text, userNames, m.reply_count),
    );

    const output = truncateOutput(lines.join("\n"));
    return { success: true, output: `${userMessages.length} messages:\n${output}` };
  },

  read_thread: async (ctx, args) => {
    const error = validateStringArgs(args, ["thread_ts"]);
    if (error) return { success: false, output: error };
    const threadTs = args.thread_ts as string;

    const result = await ctx.client.conversations.replies({
      channel: ctx.channelId,
      ts: threadTs,
      limit: MAX_READ_LIMIT,
    });
    const messages = (result.messages ?? []) as SlackMessage[];

    if (messages.length === 0) {
      return { success: true, output: "No messages found in thread." };
    }

    // Resolve user names
    const userIds = [...new Set(messages.map((m) => m.user).filter(Boolean) as string[])];
    const userNames = await resolveUserNames(ctx.client, userIds);

    const lines = messages.map((m, i) => {
      const prefix = i === 0 ? "" : "  ↳ ";
      return `${prefix}${formatLine(m.ts, m.user, m.text, userNames)}`;
    });

    const output = truncateOutput(lines.join("\n"));
    return { success: true, output: `${messages.length} messages in thread:\n${output}` };
  },

  // --- Write tools ---

  reply_to_message: async (ctx, args) => {
    const error = validateStringArgs(args, ["thread_ts", "text"]);
    if (error) return { success: false, output: error };
    const result = await ctx.client.chat.postMessage({
      channel: ctx.channelId,
      thread_ts: args.thread_ts as string,
      text: args.text as string,
      ...(ctx.userId && { blocks: messageBlocksWithAttribution(args.text as string, ctx.userId) }),
    });
    return {
      success: result.ok === true,
      output: result.ok ? `Replied in thread ${args.thread_ts}` : "Failed to reply",
    };
  },

  post_channel_message: async (ctx, args) => {
    const error = validateStringArgs(args, ["text"]);
    if (error) return { success: false, output: error };
    const result = await ctx.client.chat.postMessage({
      channel: ctx.channelId,
      text: args.text as string,
      ...(ctx.userId && { blocks: messageBlocksWithAttribution(args.text as string, ctx.userId) }),
    });
    return {
      success: result.ok === true,
      output: result.ok ? "Message posted" : "Failed to post message",
    };
  },
};

export async function executeTool(
  toolName: string,
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const handler = toolHandlers[toolName];
  if (!handler) {
    return { success: false, output: `Unknown tool: ${toolName}` };
  }
  return handler(ctx, args);
}
