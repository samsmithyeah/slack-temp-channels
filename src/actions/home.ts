import type { App } from "@slack/bolt";
import type { ActionsBlock, KnownBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import {
  APP_HOME_DESCRIPTION,
  APP_HOME_HEADING,
  CHANNEL_PREFIX,
  CREATOR_MSG_TEXT,
  ERR_ARCHIVE_PERMISSION,
  LABEL_CREATE,
} from "../constants";
import { createChannelModal } from "../modals/create";
import { getSlackErrorCode } from "../utils";

const CACHE_TTL_MS = 30_000;
const dashChannelCache = new Map<
  string,
  { data: { created: DashChannel[]; memberOf: DashChannel[] }; timestamp: number }
>();

let cachedBotUserId: string | undefined;

const CREATOR_REGEX = new RegExp(`<@(\\w+)> ${CREATOR_MSG_TEXT}`);

interface DashChannel {
  id: string;
  name: string;
}

interface PinItem {
  message?: { text?: string; user?: string };
}

interface Logger {
  error(...args: unknown[]): void;
}

async function getBotUserId(client: WebClient): Promise<string> {
  if (cachedBotUserId) return cachedBotUserId;
  const result = await client.auth.test();
  cachedBotUserId = result.user_id as string;
  return cachedBotUserId;
}

function extractCreatorFromPins(
  items: PinItem[] | undefined,
  botUserId: string,
): string | undefined {
  if (!items) return undefined;
  for (const item of items) {
    if (item.message?.user !== botUserId) continue;
    const match = item.message?.text?.match(CREATOR_REGEX);
    if (match) return match[1];
  }
  return undefined;
}

async function fetchDashChannels(
  client: WebClient,
  userId: string,
): Promise<{ created: DashChannel[]; memberOf: DashChannel[] }> {
  const botUserId = await getBotUserId(client);

  // Get dash channels the user is a member of directly
  const userDashChannels: DashChannel[] = [];
  let cursor: string | undefined;
  do {
    const result = await client.users.conversations({
      user: userId,
      types: "public_channel",
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    for (const ch of result.channels ?? []) {
      if (ch.id && ch.name?.startsWith(CHANNEL_PREFIX)) {
        userDashChannels.push({ id: ch.id, name: ch.name });
      }
    }
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  if (userDashChannels.length === 0) return { created: [], memberOf: [] };

  // Get pinned messages to identify creator in parallel
  const pinChecks = await Promise.allSettled(
    userDashChannels.map((ch) => client.pins.list({ channel: ch.id })),
  );

  const created: DashChannel[] = [];
  const memberOf: DashChannel[] = [];

  for (let i = 0; i < userDashChannels.length; i++) {
    const ch = userDashChannels[i];
    const pinResult = pinChecks[i];
    let isCreator = false;
    if (pinResult.status === "fulfilled") {
      const creatorId = extractCreatorFromPins(pinResult.value.items as PinItem[], botUserId);
      isCreator = creatorId === userId;
    }

    if (isCreator) {
      created.push(ch);
    } else {
      memberOf.push(ch);
    }
  }

  return { created, memberOf };
}

function channelSectionBlocks(
  title: string,
  channels: DashChannel[],
  emptyText: string,
  showClose: boolean,
): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: title },
    },
  ];

  if (channels.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: emptyText },
    });
    return blocks;
  }

  for (const ch of channels) {
    const elements: ActionsBlock["elements"] = [
      {
        type: "button",
        text: { type: "plain_text", text: "Jump to" },
        url: `https://slack.com/app_redirect?channel=${ch.id}`,
        action_id: `home_jump_${ch.id}`,
      },
    ];

    if (showClose) {
      elements.push({
        type: "button",
        text: { type: "plain_text", text: "Close" },
        style: "danger",
        action_id: `home_close_${ch.id}`,
        value: ch.id,
        confirm: {
          title: { type: "plain_text", text: "Close this channel?" },
          text: {
            type: "mrkdwn",
            text: "This will archive the channel. This action cannot be undone.",
          },
          confirm: { type: "plain_text", text: "Close it" },
          deny: { type: "plain_text", text: "Cancel" },
        },
      });
    }

    blocks.push(
      {
        type: "section",
        text: { type: "mrkdwn", text: `<#${ch.id}>` },
      },
      {
        type: "actions",
        elements,
      },
    );
  }

  return blocks;
}

async function publishHomeView(client: WebClient, userId: string, logger: Logger): Promise<void> {
  let created: DashChannel[] = [];
  let memberOf: DashChannel[] = [];

  try {
    const cached = dashChannelCache.get(userId);
    const now = Date.now();
    let data: { created: DashChannel[]; memberOf: DashChannel[] };
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      data = cached.data;
    } else {
      data = await fetchDashChannels(client, userId);
      dashChannelCache.set(userId, { data, timestamp: now });
    }
    created = data.created;
    memberOf = data.memberOf;
  } catch (error) {
    logger.error("Failed to fetch dash channels for home view:", error);
  }

  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: APP_HOME_HEADING },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: APP_HOME_DESCRIPTION },
    },
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: LABEL_CREATE },
          style: "primary",
          action_id: "home_create_dash",
        },
      ],
    },
    { type: "divider" },
    ...channelSectionBlocks(
      "Channels you created",
      created,
      "_You haven't created any dash channels yet._",
      true,
    ),
    { type: "divider" },
    ...channelSectionBlocks(
      "Your dash channels",
      memberOf,
      "_You're not a member of any other dash channels._",
      false,
    ),
  ];

  await client.views.publish({
    user_id: userId,
    view: { type: "home", blocks },
  });
}

/** @internal Exposed for tests only */
export function _clearCacheForTesting(): void {
  dashChannelCache.clear();
  cachedBotUserId = undefined;
}

export function registerHomeHandlers(app: App): void {
  app.event("app_home_opened", async ({ event, client, logger }) => {
    try {
      await publishHomeView(client, event.user, logger);
    } catch (error) {
      logger.error("Failed to publish app home:", error);
    }
  });

  app.action("home_create_dash", async ({ ack, body, client, logger }) => {
    await ack();

    try {
      await client.views.open({
        trigger_id: (body as unknown as { trigger_id: string }).trigger_id,
        view: createChannelModal([body.user.id]),
      });
    } catch (error) {
      logger.error("Failed to open modal from home:", error);
    }
  });

  app.action(/^home_jump_/, async ({ ack }) => {
    await ack();
  });

  app.action(/^home_close_/, async ({ ack, body, client, logger }) => {
    await ack();

    const action = (body as unknown as { actions: Array<{ type: string; value?: string }> })
      .actions[0];
    if (action.type !== "button" || !action.value) return;
    const channelId = action.value;
    const userId = body.user.id;

    // Verify the user is the channel creator before allowing close
    try {
      const [botUserId, pinsResult] = await Promise.all([
        getBotUserId(client),
        client.pins.list({ channel: channelId }),
      ]);
      const creatorId = extractCreatorFromPins(pinsResult.items as PinItem[], botUserId);
      if (creatorId !== userId) {
        logger.error("Unauthorized close attempt by", userId, "on channel", channelId);
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: "Only the channel creator can close this channel.",
        });
        return;
      }
    } catch (error) {
      logger.error("Failed to verify channel creator:", error);
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "Unable to verify channel creator. Please try again.",
      });
      return;
    }

    try {
      await client.chat.postMessage({
        channel: channelId,
        text: `This channel was closed by <@${userId}>`,
      });
    } catch (error) {
      logger.error("Failed to post close message:", error);
    }

    try {
      await client.conversations.archive({ channel: channelId });
    } catch (error: unknown) {
      logger.error("Failed to archive channel:", error);
      const code = getSlackErrorCode(error);
      if (code === "not_authorized" || code === "restricted_action") {
        try {
          await client.chat.postMessage({
            channel: channelId,
            text: ERR_ARCHIVE_PERMISSION,
          });
        } catch {
          // Channel might already be archived
        }
      }
    }

    // Refresh the home view to remove the closed channel
    dashChannelCache.delete(userId);
    try {
      await publishHomeView(client, userId, logger);
    } catch (error) {
      logger.error("Failed to refresh home view after close:", error);
    }
  });
}
