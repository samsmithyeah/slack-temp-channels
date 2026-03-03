import type { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import {
  APP_HOME_DESCRIPTION,
  APP_HOME_HEADING,
  CHANNEL_PREFIX,
  CREATOR_MSG_TEXT,
  ERR_ARCHIVE_PERMISSION,
  LABEL_BROADCAST_CLOSE,
  LABEL_CREATE,
  LABEL_EXPORT,
  LABEL_TAB_CLOSED,
  LABEL_TAB_OPEN,
} from "../constants";
import { broadcastModal } from "../modals/broadcast";
import { createChannelModal } from "../modals/create";
import type { ActionBody } from "../types";
import { getSlackErrorCode } from "../utils";

const CACHE_TTL_MS = 30_000;

interface DashChannel {
  id: string;
  name: string;
  isArchived: boolean;
}

interface PartitionedChannels {
  open: { created: DashChannel[]; memberOf: DashChannel[] };
  closed: { created: DashChannel[]; memberOf: DashChannel[] };
}

const dashChannelCache = new Map<
  string,
  {
    data: PartitionedChannels;
    timestamp: number;
  }
>();

const viewTabState = new Map<string, "open" | "closed">();

const botUserIdCache = new Map<string, Promise<string>>();

// Matches both current and legacy pin text formats:
//   current: "<@U123> created this temporary channel"
//   legacy:  "Temporary channel created by <@U123>"
const CREATOR_REGEX_CURRENT = new RegExp(String.raw`<@(\w+)> ${CREATOR_MSG_TEXT}`);
const CREATOR_REGEX_LEGACY = /Temporary channel created by <@(\w+)>/;

interface PinItem {
  message?: { text?: string; user?: string };
}

interface Logger {
  error(...args: unknown[]): void;
}

function getBotUserId(client: WebClient, teamId: string): Promise<string> {
  const existing = botUserIdCache.get(teamId);
  if (existing) return existing;
  const promise = client.auth.test().then((r) => r.user_id as string);
  botUserIdCache.set(teamId, promise);
  return promise;
}

function extractCreatorFromPins(
  items: PinItem[] | undefined,
  botUserId: string,
): string | undefined {
  if (!items) return undefined;
  for (const item of items) {
    if (item.message?.user !== botUserId) continue;
    const text = item.message?.text;
    const match = text?.match(CREATOR_REGEX_CURRENT) ?? text?.match(CREATOR_REGEX_LEGACY);
    if (match) return match[1];
  }
  return undefined;
}

async function fetchDashChannels(
  client: WebClient,
  userId: string,
  teamId: string,
): Promise<PartitionedChannels> {
  const botUserId = await getBotUserId(client, teamId);

  // Get dash channels the user is a member of directly (including archived)
  const userDashChannels: DashChannel[] = [];
  let cursor: string | undefined;
  do {
    const result = await client.users.conversations({
      user: userId,
      types: "public_channel",
      exclude_archived: false,
      limit: 200,
      cursor,
    });
    for (const ch of result.channels ?? []) {
      if (ch.id && ch.name?.startsWith(CHANNEL_PREFIX)) {
        userDashChannels.push({
          id: ch.id,
          name: ch.name,
          isArchived: !!(ch as Record<string, unknown>).is_archived,
        });
      }
    }
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  if (userDashChannels.length === 0) {
    return {
      open: { created: [], memberOf: [] },
      closed: { created: [], memberOf: [] },
    };
  }

  // Get pinned messages to identify creator in parallel
  const pinChecks = await Promise.allSettled(
    userDashChannels.map((ch) => client.pins.list({ channel: ch.id })),
  );

  const result: PartitionedChannels = {
    open: { created: [], memberOf: [] },
    closed: { created: [], memberOf: [] },
  };

  for (let i = 0; i < userDashChannels.length; i++) {
    const ch = userDashChannels[i];
    const pinResult = pinChecks[i];
    let isCreator = false;
    if (pinResult.status === "fulfilled") {
      const creatorId = extractCreatorFromPins(pinResult.value.items as PinItem[], botUserId);
      isCreator = creatorId === userId;
    }

    const bucket = ch.isArchived ? result.closed : result.open;
    if (isCreator) {
      bucket.created.push(ch);
    } else {
      bucket.memberOf.push(ch);
    }
  }

  return result;
}

function channelSectionBlocks(
  title: string,
  channels: DashChannel[],
  emptyText: string,
  showClose: boolean,
  showExport: boolean,
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
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `<#${ch.id}>` },
    });

    const elements: KnownBlock[] = [];

    if (showExport) {
      elements.push({
        type: "button",
        text: { type: "plain_text", text: LABEL_EXPORT },
        action_id: `home_export_${ch.id}`,
        value: `${ch.id}:${ch.name}`,
      } as unknown as KnownBlock);
    }

    if (showClose) {
      elements.push(
        {
          type: "button",
          text: { type: "plain_text", text: LABEL_BROADCAST_CLOSE },
          action_id: `home_broadcast_close_${ch.id}`,
          value: ch.id,
        } as unknown as KnownBlock,
        {
          type: "button",
          text: { type: "plain_text", text: "Close channel" },
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
        } as unknown as KnownBlock,
      );
    }

    if (elements.length > 0) {
      blocks.push({
        type: "actions",
        elements,
      } as unknown as KnownBlock);
    }
  }

  return blocks;
}

function tabToggleBlocks(activeTab: "open" | "closed"): KnownBlock[] {
  return [
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: LABEL_TAB_OPEN },
          action_id: "home_tab_open",
          ...(activeTab === "open" ? { style: "primary" } : {}),
        },
        {
          type: "button",
          text: { type: "plain_text", text: LABEL_TAB_CLOSED },
          action_id: "home_tab_closed",
          ...(activeTab === "closed" ? { style: "primary" } : {}),
        },
      ],
    } as unknown as KnownBlock,
  ];
}

async function publishHomeView(
  client: WebClient,
  userId: string,
  teamId: string,
  logger: Logger,
): Promise<void> {
  let channelData: PartitionedChannels = {
    open: { created: [], memberOf: [] },
    closed: { created: [], memberOf: [] },
  };

  try {
    const cacheKey = `${teamId}:${userId}`;
    const cached = dashChannelCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      channelData = cached.data;
    } else {
      channelData = await fetchDashChannels(client, userId, teamId);
      dashChannelCache.set(cacheKey, { data: channelData, timestamp: now });
    }
  } catch (error) {
    logger.error("Failed to fetch dash channels for home view:", error);
  }

  const tabKey = `${teamId}:${userId}`;
  const activeTab = viewTabState.get(tabKey) ?? "open";
  const data = activeTab === "open" ? channelData.open : channelData.closed;

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
    ...tabToggleBlocks(activeTab),
    ...channelSectionBlocks(
      "Dash channels you created",
      data.created,
      "_You haven't created any dash channels yet._",
      activeTab === "open",
      true,
    ),
    { type: "divider" },
    ...channelSectionBlocks(
      "Other dash channels you're a member of",
      data.memberOf,
      "_You're not a member of any other dash channels._",
      false,
      true,
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
  botUserIdCache.clear();
  viewTabState.clear();
}

export function registerHomeHandlers(app: App): void {
  app.event("app_home_opened", async ({ event, client, logger, context }) => {
    if (!context.teamId) {
      logger.error("Missing teamId in app_home_opened event");
      return;
    }
    try {
      await publishHomeView(client, event.user, context.teamId, logger);
    } catch (error) {
      logger.error("Failed to publish app home:", error);
    }
  });

  app.action("home_create_dash", async ({ ack, body, client, logger }) => {
    await ack();

    try {
      const actionBody = body as unknown as ActionBody;
      await client.views.open({
        trigger_id: actionBody.trigger_id,
        view: createChannelModal([body.user.id]),
      });
    } catch (error) {
      logger.error("Failed to open modal from home:", error);
    }
  });

  app.action("home_tab_open", async ({ ack, body, client, logger }) => {
    await ack();
    const teamId = body.team?.id;
    const userId = body.user.id;
    if (!teamId) return;

    viewTabState.set(`${teamId}:${userId}`, "open");
    dashChannelCache.delete(`${teamId}:${userId}`);
    try {
      await publishHomeView(client, userId, teamId, logger);
    } catch (error) {
      logger.error("Failed to refresh home view after tab switch:", error);
    }
  });

  app.action("home_tab_closed", async ({ ack, body, client, logger }) => {
    await ack();
    const teamId = body.team?.id;
    const userId = body.user.id;
    if (!teamId) return;

    viewTabState.set(`${teamId}:${userId}`, "closed");
    dashChannelCache.delete(`${teamId}:${userId}`);
    try {
      await publishHomeView(client, userId, teamId, logger);
    } catch (error) {
      logger.error("Failed to refresh home view after tab switch:", error);
    }
  });

  app.action(/^home_broadcast_close_/, async ({ ack, body, client, logger }) => {
    await ack();

    const actionBody = body as unknown as ActionBody;
    const action = actionBody.actions?.[0];
    if (action?.type !== "button" || !action?.value) return;
    const channelId = action.value;

    try {
      await client.views.open({
        trigger_id: actionBody.trigger_id,
        view: broadcastModal(channelId),
      });
    } catch (error) {
      logger.error("Failed to open broadcast modal from home:", error);
    }
  });

  app.action(/^home_close_/, async ({ ack, body, client, logger }) => {
    await ack();

    const actionBody = body as unknown as ActionBody;
    const action = actionBody.actions?.[0];
    if (action?.type !== "button" || !action?.value) return;
    const channelId = action.value;
    const userId = body.user.id;
    const teamId = body.team?.id;
    if (!teamId) {
      logger.error("Missing teamId in home_close action");
      return;
    }

    // Verify the user is the channel creator before allowing close
    try {
      const [botUserId, pinsResult] = await Promise.all([
        getBotUserId(client, teamId),
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
    dashChannelCache.delete(`${teamId}:${userId}`);
    try {
      await publishHomeView(client, userId, teamId, logger);
    } catch (error) {
      logger.error("Failed to refresh home view after close:", error);
    }
  });
}
