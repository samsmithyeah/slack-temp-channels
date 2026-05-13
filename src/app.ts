import "dotenv/config";
import { App, ExpressReceiver } from "@slack/bolt";
import { registerAgentTaskHandlers } from "./actions/agentTask";
import { registerBroadcastAction } from "./actions/broadcast";
import { registerCloseAction } from "./actions/close";
import { registerExportAction } from "./actions/export";
import { registerHomeHandlers } from "./actions/home";
import { registerDashCommand } from "./commands/dash";
import { registerAppMentionHandler } from "./events/appMention";

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
});

receiver.router.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

registerDashCommand(app);
registerCloseAction(app);
registerBroadcastAction(app);
registerExportAction(app);
registerAgentTaskHandlers(app);
registerAppMentionHandler(app);
registerHomeHandlers(app);

(async () => {
  await app.start(Number(process.env.PORT) || 3000);
  console.log("⚡ Dash app is running!");
})().catch(console.error);
