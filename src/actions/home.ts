import type { App } from "@slack/bolt";
import { APP_HOME_DESCRIPTION, APP_HOME_HEADING, LABEL_CREATE } from "../constants";
import { createChannelModal } from "../modals/create";

export function registerHomeHandlers(app: App): void {
  app.event("app_home_opened", async ({ event, client, logger }) => {
    try {
      await client.views.publish({
        user_id: event.user,
        view: {
          type: "home",
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: APP_HOME_HEADING },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: APP_HOME_DESCRIPTION,
              },
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
          ],
        },
      });
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
}
