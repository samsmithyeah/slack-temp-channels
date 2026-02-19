import OpenAI from "openai";

const OPENAI_MODEL = "gpt-5-mini";
const MAX_PROMPT_MESSAGES = 100;
const MAX_CHARS_PER_MESSAGE = 500;

interface ChannelMessage {
  user: string;
  text: string;
}

const SYSTEM_PROMPT = `You are a helpful assistant that summarises Slack channel conversations.
Given a series of messages from a temporary Slack channel, produce a concise summary (3-8 bullet points) of:
- Key decisions made
- Action items agreed upon
- Important outcomes or conclusions

Use plain text without markdown formatting. Each bullet point should start with "- ".
Be factual and concise. Do not invent information that is not present in the messages.`;

function buildUserPrompt(messages: ChannelMessage[]): string {
  const formatted = messages.map((m) => `<@${m.user}>: ${m.text}`).join("\n");
  return `Here are the messages from the channel:\n\n${formatted}\n\nPlease summarise the key outcomes and decisions from this conversation.`;
}

export function createOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
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
      text: m.text.slice(0, MAX_CHARS_PER_MESSAGE),
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
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }
  return content.trim();
}
