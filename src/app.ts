import "dotenv/config";
import { App } from "@slack/bolt";
import { registerDashCommand } from "./commands/dash";
import { registerCloseAction } from "./actions/close";
import { registerBroadcastAction } from "./actions/broadcast";
import { createChannelModal } from "./modals/create";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
});

// Register all handlers
registerDashCommand(app);
registerCloseAction(app);
registerBroadcastAction(app);

// App Home tab
app.event("app_home_opened", async ({ event, client, logger }) => {
  try {
    await client.views.publish({
      user_id: event.user,
      view: {
        type: "home",
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "Dash — Temporary Channels" },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Quickly spin up a temporary channel with the right people. When you're done, close it — optionally broadcasting the outcome first.\n\nType `/dash` in any channel, or use the button below.",
            },
          },
          { type: "divider" },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Create a Dash" },
                style: "primary",
                action_id: "home_create_dash",
              },
            ],
          },
        ],
      },
    });
  } catch (error) {
    logger.error("Failed to publish app home:", error);
  }
});

// Handle "Create a Dash" button from App Home
app.action("home_create_dash", async ({ ack, body, client, logger }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: (body as any).trigger_id,
      view: createChannelModal(),
    });
  } catch (error) {
    logger.error("Failed to open modal from home:", error);
  }
});

(async () => {
  await app.start();
  console.log("⚡ Dash app is running!");
})();
