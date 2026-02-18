import type { App } from "@slack/bolt";
import { CHANNEL_PREFIX, CHANNEL_TOPIC, ERR_CHANNEL_SETUP } from "../constants";
import { createChannelModal } from "../modals/create";
import { getSlackErrorCode, parseUserIds, slugify, welcomeBlocks } from "../utils";

export function registerDashCommand(app: App): void {
  app.command("/dash", async ({ ack, body, client, logger }) => {
    await ack();

    const preselectedUserIds = parseUserIds(body.text ?? "");

    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: createChannelModal(preselectedUserIds),
      });
    } catch (error) {
      logger.error("Failed to open create channel modal:", error);
    }
  });

  app.view("create_channel", async ({ ack, body, view, client, logger }) => {
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
      const setPurpose = purpose
        ? client.conversations.setPurpose({ channel: channelId, purpose })
        : Promise.resolve();
      const setTopic = client.conversations.setTopic({
        channel: channelId,
        topic: CHANNEL_TOPIC,
      });
      await Promise.all([setPurpose, setTopic]);

      // Invite users (bot is auto-joined as creator)
      if (userIds.length > 0) {
        await client.conversations.invite({
          channel: channelId,
          users: userIds.join(","),
        });
      }

      // Post and pin welcome message
      const welcome = await client.chat.postMessage({
        channel: channelId,
        text: `Temporary channel created by <@${creatorId}>`,
        blocks: welcomeBlocks(creatorId, purpose, userIds),
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
  });
}
