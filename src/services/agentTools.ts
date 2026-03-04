import type { WebClient } from "@slack/web-api";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

// --- Tool definitions for OpenAI function calling ---

export const AGENT_TOOLS: ChatCompletionTool[] = [
  {
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
  },
  {
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
  },
];

// --- Types ---

export interface ToolContext {
  client: WebClient;
  channelId: string;
}

interface ToolResult {
  success: boolean;
  output: string;
}

// --- Tool execution ---

type ToolHandler = (ctx: ToolContext, args: Record<string, string>) => Promise<ToolResult>;

function validateArgs(args: Record<string, string>, required: string[]): string | undefined {
  for (const key of required) {
    if (typeof args[key] !== "string" || args[key].trim() === "") {
      return `Missing or empty required argument: ${key}`;
    }
  }
  return undefined;
}

const toolHandlers: Record<string, ToolHandler> = {
  reply_to_message: async (ctx, args) => {
    const error = validateArgs(args, ["thread_ts", "text"]);
    if (error) return { success: false, output: error };
    const result = await ctx.client.chat.postMessage({
      channel: ctx.channelId,
      thread_ts: args.thread_ts,
      text: args.text,
    });
    return {
      success: result.ok === true,
      output: result.ok ? `Replied in thread ${args.thread_ts}` : "Failed to reply",
    };
  },
  post_channel_message: async (ctx, args) => {
    const error = validateArgs(args, ["text"]);
    if (error) return { success: false, output: error };
    const result = await ctx.client.chat.postMessage({
      channel: ctx.channelId,
      text: args.text,
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
  args: Record<string, string>,
): Promise<ToolResult> {
  const handler = toolHandlers[toolName];
  if (!handler) {
    return { success: false, output: `Unknown tool: ${toolName}` };
  }
  return handler(ctx, args);
}
