import type { ConversationsHistoryArguments, WebClient } from "@slack/web-api";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { textSectionBlocks } from "../agentBlocks";
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

const editMessageTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "edit_message",
    description: "Edit a message that was previously posted by the bot in the channel",
    parameters: {
      type: "object",
      properties: {
        message_ts: {
          type: "string",
          description: "The timestamp of the message to edit (must be a message posted by the bot)",
        },
        text: {
          type: "string",
          description: "The new message text (supports Slack mrkdwn formatting)",
        },
      },
      required: ["message_ts", "text"],
    },
  },
};

/** Write tool names used in submit_plan enum and execution step counting. */
export const WRITE_TOOL_NAMES = [replyToMessageTool, postChannelMessageTool, editMessageTool].map(
  (t) => t.function.name,
);

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
                enum: WRITE_TOOL_NAMES,
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
const WRITE_TOOLS: ChatCompletionTool[] = [
  replyToMessageTool,
  postChannelMessageTool,
  editMessageTool,
];
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
  const displayName = user ? (userNames.get(user) ?? user) : "Unknown";
  const nameLabel = user ? `${displayName} (<@${user}>)` : "Unknown";
  const sanitized = (text ?? "").replace(/\n/g, " ");
  const threadNote = replyCount && replyCount > 0 ? ` [${replyCount} replies]` : "";
  return `[ts:${ts ?? "unknown"}] ${nameLabel}: ${sanitized}${threadNote}`;
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

/** Strip broadcast mentions and deceptive link labels from LLM-generated text. */
export function sanitizeSlackOutput(text: string): string {
  return (
    text
      // Strip special mentions: <!here>, <!channel>, <!everyone>, <!subteam^...>
      .replace(/<!(?:here|channel|everyone|subteam\^[A-Z0-9]+)(?:\|[^>]*)?>/g, "")
      // Remove display-text overrides from links to prevent phishing: <url|fake label> → <url>
      .replace(/<(https?:\/\/[^|>]+)\|[^>]+>/g, "<$1>")
  );
}

function messageBlocksWithAttribution(text: string, userId: string) {
  return [
    ...textSectionBlocks(text),
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

    const historyArgs: ConversationsHistoryArguments = {
      channel: ctx.channelId,
      limit,
    };
    if (typeof args.oldest === "string" && args.oldest) historyArgs.oldest = args.oldest;
    if (typeof args.latest === "string" && args.latest) historyArgs.latest = args.latest;

    const result = await ctx.client.conversations.history(historyArgs);
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
    const safeText = sanitizeSlackOutput(args.text as string);
    const result = await ctx.client.chat.postMessage({
      channel: ctx.channelId,
      thread_ts: args.thread_ts as string,
      text: safeText,
      ...(ctx.userId && { blocks: messageBlocksWithAttribution(safeText, ctx.userId) }),
    });
    return {
      success: result.ok === true,
      output: result.ok ? `Replied in thread ${args.thread_ts}` : "Failed to reply",
    };
  },

  edit_message: async (ctx, args) => {
    const error = validateStringArgs(args, ["message_ts", "text"]);
    if (error) return { success: false, output: error };
    const safeText = sanitizeSlackOutput(args.text as string);
    try {
      const result = await ctx.client.chat.update({
        channel: ctx.channelId,
        ts: args.message_ts as string,
        text: safeText,
        ...(ctx.userId && { blocks: messageBlocksWithAttribution(safeText, ctx.userId) }),
      });
      return {
        success: result.ok === true,
        output: result.ok ? `Message ${args.message_ts} updated` : "Failed to update message",
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("cant_update_message")) {
        return { success: false, output: "Cannot edit: the bot can only edit its own messages" };
      }
      if (msg.includes("msg_too_long")) {
        return {
          success: false,
          output:
            "Cannot edit: the updated message is too long. Try shortening the content or splitting it across multiple messages.",
        };
      }
      if (msg.includes("message_not_found")) {
        return { success: false, output: "Cannot edit: message not found. Check the timestamp." };
      }
      throw e;
    }
  },

  post_channel_message: async (ctx, args) => {
    const error = validateStringArgs(args, ["text"]);
    if (error) return { success: false, output: error };
    const safeText = sanitizeSlackOutput(args.text as string);
    const result = await ctx.client.chat.postMessage({
      channel: ctx.channelId,
      text: safeText,
      ...(ctx.userId && { blocks: messageBlocksWithAttribution(safeText, ctx.userId) }),
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
