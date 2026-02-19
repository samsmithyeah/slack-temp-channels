import OpenAI from "openai";

const OPENAI_MODEL = "gpt-5-mini";
const MAX_PROMPT_MESSAGES = 100;
const MAX_CHARS_PER_MESSAGE = 500;

interface ChannelMessage {
  user: string;
  text: string;
}

const SYSTEM_PROMPT = `You are a helpful assistant that summarises Slack channel conversations.
Given a series of messages from a temporary Slack channel, produce a concise summary of what was discussed and decided. Use as few bullet points as necessary — often just 1-2 is enough.

Focus exclusively on:
- Outcomes, decisions, and conclusions reached
- Action items agreed upon

Do NOT include:
- Any mention of the channel itself (creation, purpose, or metadata)
- Direct quotes from messages
- Play-by-play accounts of who said what
- Attribution to specific users unless essential to understanding the outcome
- Filler bullet points like "no further decisions were made" or "nothing else was discussed"

Write in the past tense as a neutral observer. Use plain text without markdown formatting. Each bullet point should start with "- ".
Every bullet point must convey meaningful information. If the conversation only had one outcome, use a single bullet point.`;

const USER_MENTION_REGEX = /<@([A-Z0-9]+)>/g;

export function extractUserIds(messages: ChannelMessage[]): string[] {
  const ids = new Set<string>();
  for (const m of messages) {
    ids.add(m.user);
    for (const match of m.text.matchAll(USER_MENTION_REGEX)) {
      ids.add(match[1]);
    }
  }
  return [...ids];
}

export function resolveNamesInMessages(
  messages: ChannelMessage[],
  userNames: Map<string, string>,
): ChannelMessage[] {
  return messages.map((m) => ({
    user: userNames.get(m.user) ?? m.user,
    text: m.text.replace(USER_MENTION_REGEX, (_, id) => userNames.get(id) ?? id),
  }));
}

export function restoreUserMentions(text: string, userNames: Map<string, string>): string {
  // Build a reverse map: display name -> <@USER_ID>
  // Sort by name length descending to match longer names first
  const replacements = [...userNames.entries()]
    .map(([id, name]) => ({ name, mention: `<@${id}>` }))
    .sort((a, b) => b.name.length - a.name.length);

  let result = text;
  for (const { name, mention } of replacements) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\b${escaped}\\b`, "g"), mention);
  }
  return result;
}

function buildUserPrompt(messages: ChannelMessage[]): string {
  const formatted = messages.map((m) => `${m.user}: ${m.text}`).join("\n");
  return `Here are the messages from the channel:\n\n${formatted}\n\nPlease summarise the key outcomes and decisions from this conversation.`;
}

export class ApiKeyMissingError extends Error {
  constructor() {
    super("OPENAI_API_KEY environment variable is not set");
    this.name = "ApiKeyMissingError";
  }
}

export function createOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ApiKeyMissingError();
  }
  return new OpenAI({ apiKey });
}

export function formatMessagesForPrompt(
  rawMessages: Array<{ user?: string; text?: string; subtype?: string }>,
): ChannelMessage[] {
  return rawMessages
    .filter(
      (m): m is { user: string; text: string; subtype?: string } =>
        !!m.user && !!m.text && !m.subtype,
    )
    .map((m) => ({
      user: m.user,
      text:
        m.text.length > MAX_CHARS_PER_MESSAGE
          ? `${m.text.slice(0, MAX_CHARS_PER_MESSAGE - 3)}...`
          : m.text,
    }))
    .slice(-MAX_PROMPT_MESSAGES);
}

export async function generateSummary(client: OpenAI, messages: ChannelMessage[]): Promise<string> {
  const response = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(messages) },
    ],
    max_completion_tokens: 1024,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }
  return content.trim();
}
