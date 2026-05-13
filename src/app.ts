import "dotenv/config";
import { App, ExpressReceiver } from "@slack/bolt";
import { registerAgentTaskHandlers } from "./actions/agentTask";
import { registerBroadcastAction } from "./actions/broadcast";
import { registerCloseAction } from "./actions/close";
import { registerExportAction } from "./actions/export";
import { registerHomeHandlers } from "./actions/home";
import { registerDashCommand } from "./commands/dash";
import { registerAppMentionHandler } from "./events/appMention";

const signingSecret = process.env.SLACK_SIGNING_SECRET;
const botToken = process.env.SLACK_BOT_TOKEN;
if (!signingSecret || !botToken) {
  throw new Error("SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN environment variables are required");
}

const receiver = new ExpressReceiver({ signingSecret });

receiver.router.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

const app = new App({
  token: botToken,
  receiver,
});

registerDashCommand(app);
registerCloseAction(app);
registerBroadcastAction(app);
registerExportAction(app);
registerAgentTaskHandlers(app);
registerAppMentionHandler(app);
registerHomeHandlers(app);

const shutdown = async () => {
  await app.stop();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

(async () => {
  await app.start(Number(process.env.PORT) || 3000);
  console.log("⚡ Dash app is running!");
})().catch(console.error);
