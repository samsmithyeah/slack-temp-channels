import OpenAI from "openai";

const OPENAI_MODEL = "gpt-5-mini";
const MAX_PROMPT_MESSAGES = 300;
const MAX_CHARS_PER_MESSAGE = 500;

interface ChannelMessage {
  user: string;
  text: string;
}

const SYSTEM_PROMPT = `You are a helpful assistant that summarises Slack channel conversations.
Given a series of messages from a temporary Slack channel, produce a concise narrative summary of what was discussed, decided, and actioned.

Style guidelines:
- Write in flowing prose paragraphs, not bullet points
- Attribute contributions to people by name where relevant — the reader should know who raised an issue, who suggested a solution, and who took action
- Tell the story of the conversation chronologically: what was the problem or topic, what was discussed, what was decided, and what happened next
- Include specific details that matter (e.g. tool names, ticket numbers, technical specifics) but skip small talk and noise
- Use the past tense as a neutral observer
- Use plain text without markdown formatting
- Keep it concise — a short conversation might only need 2-3 sentences, a longer one a few short paragraphs
- Do not mention the channel itself (its creation, purpose, or metadata)
- End with the resolution or current status if one exists`;

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
  return `Here are the messages from the channel:\n\n${formatted}\n\nPlease summarise this conversation as a concise narrative.`;
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
    max_completion_tokens: 1500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }
  return content.trim();
}
