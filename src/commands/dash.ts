import type { App } from "@slack/bolt";
import { createChannelModal } from "../modals/create";
import { slugify, welcomeBlocks } from "../utils";

function parseUserIds(text: string): string[] {
  // Slack sends @mentions as <@U12345> or <@U12345|username>
  const matches = text.matchAll(/<@(U[A-Z0-9]+)(?:\|[^>]*)?>/g);
  return [...matches].map((m) => m[1]);
}

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
    const userIds = values.invite_users.invite_users_input.selected_users!;
    const purpose = values.purpose.purpose_input.value ?? undefined;
    const creatorId = body.user.id;

    const channelName = `-${slugify(rawName)}`;

    // Create channel
    let channelId: string;
    try {
      const result = await client.conversations.create({ name: channelName });
      channelId = result.channel!.id!;
    } catch (error: any) {
      if (error?.data?.error === "name_taken") {
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
      // Set purpose/topic
      if (purpose) {
        await Promise.all([
          client.conversations.setPurpose({
            channel: channelId,
            purpose,
          }),
          client.conversations.setTopic({
            channel: channelId,
            topic: purpose,
          }),
        ]);
      }

      // Invite users (bot is auto-joined as creator)
      if (userIds.length > 0) {
        await client.conversations.invite({
          channel: channelId,
          users: userIds.join(","),
        });
      }

      // Post welcome message
      await client.chat.postMessage({
        channel: channelId,
        text: `Temporary channel created by <@${creatorId}>`,
        blocks: welcomeBlocks(creatorId, purpose, userIds),
      });
    } catch (error) {
      logger.error("Error setting up channel:", error);
      await client.chat.postMessage({
        channel: channelId,
        text: "There was an issue setting up this channel fully. Some users may need to be invited manually.",
      });
    }
  });
}
