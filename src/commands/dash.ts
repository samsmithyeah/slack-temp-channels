import type { App } from "@slack/bolt";
import {
  CHANNEL_PREFIX,
  CHANNEL_PURPOSE,
  CREATOR_MSG_TEXT,
  ERR_CHANNEL_SETUP,
  ORIGIN_MSG_TEXT,
} from "../constants";
import { createChannelModal } from "../modals/create";
import { getSlackErrorCode, parseUserIds, slugify, welcomeBlocks } from "../utils";

export function registerDashCommand(app: App): void {
  app.command("/dash", async ({ ack, body, client, logger }) => {
    await ack();

    const preselectedUserIds = [...new Set([body.user_id, ...parseUserIds(body.text ?? "")])];

    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: createChannelModal(preselectedUserIds, body.channel_id),
      });
    } catch (error) {
      logger.error("Failed to open create channel modal:", error);
    }
  });

  app.view("create_channel", async ({ ack, body, view, client, logger }) => {
    const originChannelId = view.private_metadata || undefined;
    const values = view.state.values;
    const rawName = values.channel_name.channel_name_input.value!;
    const selectedUsers = values.invite_users.invite_users_input.selected_users!;
    const purpose = values.purpose.purpose_input.value ?? undefined;
    const creatorId = body.user.id;

    // Ensure creator is in the invite list
    const userIds = selectedUsers.includes(creatorId)
      ? selectedUsers
      : [creatorId, ...selectedUsers];

    const slug = slugify(rawName);
    if (!slug) {
      await ack({
        response_action: "errors",
        errors: {
          channel_name: "Channel name must contain at least one letter or number.",
        },
      });
      return;
    }

    const channelName = `${CHANNEL_PREFIX}${slug}`;

    // Create channel
    let channelId: string;
    try {
      const result = await client.conversations.create({ name: channelName });
      channelId = result.channel!.id!;
    } catch (error: unknown) {
      if (getSlackErrorCode(error) === "name_taken") {
        await ack({
          response_action: "errors",
          errors: {
            channel_name: `A channel named #${channelName} already exists. Pick a different name.`,
          },
        });
        return;
      }
      logger.error("Failed to create channel:", error);
      await ack({
        response_action: "errors",
        errors: {
          channel_name: "Failed to create channel. Please try again.",
        },
      });
      return;
    }

    await ack();

    try {
      // Set purpose and topic
      const setTopic = purpose
        ? client.conversations.setTopic({ channel: channelId, topic: purpose })
        : Promise.resolve();
      const setPurpose = client.conversations.setPurpose({
        channel: channelId,
        purpose: CHANNEL_PURPOSE,
      });
      await Promise.all([setTopic, setPurpose]);

      // Invite users individually so one failure doesn't block the rest
      const failedUserIds: string[] = [];
      for (const userId of userIds) {
        try {
          await client.conversations.invite({
            channel: channelId,
            users: userId,
          });
        } catch (error) {
          const code = getSlackErrorCode(error);
          if (code === "already_in_channel") continue;
          if (code === "user_team_not_in_channel") {
            // External user — send a Slack Connect invitation
            try {
              await client.conversations.inviteShared({
                channel: channelId,
                user_ids: [userId],
              });
            } catch (shareError) {
              logger.error(`Failed to send Slack Connect invite to ${userId}:`, shareError);
              failedUserIds.push(userId);
            }
          } else {
            logger.error(`Failed to invite ${userId} (${code}):`, error);
            failedUserIds.push(userId);
          }
        }
      }

      if (failedUserIds.length > 0) {
        const mentions = failedUserIds.map((id) => `<@${id}>`).join(", ");
        await client.chat.postMessage({
          channel: channelId,
          text: `Some users couldn't be invited and may need to be added manually: ${mentions}`,
        });
      }

      // Post and pin welcome message
      const welcome = await client.chat.postMessage({
        channel: channelId,
        text: `<@${creatorId}> ${CREATOR_MSG_TEXT}`,
        blocks: welcomeBlocks(creatorId, purpose, userIds, originChannelId),
      });
      if (welcome.ts) {
        await client.pins.add({ channel: channelId, timestamp: welcome.ts });
      }
    } catch (error) {
      logger.error("Error setting up channel:", error);
      await client.chat.postMessage({
        channel: channelId,
        text: ERR_CHANNEL_SETUP,
      });
    }

    // Notify the origin channel (slash-command flow only)
    if (originChannelId) {
      try {
        const blocks = [
          {
            type: "section" as const,
            text: {
              type: "mrkdwn" as const,
              text: `<@${creatorId}> created a new dash channel: <#${channelId}>`,
            },
          },
          ...(purpose
            ? [
                {
                  type: "section" as const,
                  text: { type: "mrkdwn" as const, text: `*Purpose:* ${purpose}` },
                },
              ]
            : []),
          {
            type: "context" as const,
            elements: [{ type: "mrkdwn" as const, text: "Created with /dash" }],
          },
        ];
        await client.chat.postMessage({
          channel: originChannelId,
          text: ORIGIN_MSG_TEXT,
          blocks,
        });
      } catch (error) {
        logger.error("Failed to notify origin channel:", error);
      }
    }
  });
}
