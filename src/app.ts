import "dotenv/config";
import { App } from "@slack/bolt";
import { registerAgentTaskHandlers } from "./actions/agentTask";
import { registerBroadcastAction } from "./actions/broadcast";
import { registerCloseAction } from "./actions/close";
import { registerExportAction } from "./actions/export";
import { registerHomeHandlers } from "./actions/home";
import { registerDashCommand } from "./commands/dash";
import { registerAppMentionHandler } from "./events/appMention";

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
registerExportAction(app);
registerAgentTaskHandlers(app);
registerAppMentionHandler(app);
registerHomeHandlers(app);

(async () => {
  await app.start();
  console.log("⚡ Dash app is running!");
})().catch(console.error);
