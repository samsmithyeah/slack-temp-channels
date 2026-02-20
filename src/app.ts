import "dotenv/config";
import { App, type InstallationQuery } from "@slack/bolt";
import { registerBroadcastAction } from "./actions/broadcast";
import { registerCloseAction } from "./actions/close";
import { registerHomeHandlers } from "./actions/home";
import { registerDashCommand } from "./commands/dash";
import { createInstallationStore } from "./stores/installation-store";

const installationStore = createInstallationStore();

const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  scopes: [
    "channels:manage",
    "channels:history",
    "channels:read",
    "channels:join",
    "chat:write",
    "pins:read",
    "pins:write",
    "commands",
    "users:read",
  ],
  installationStore,
});

// Clean up when a workspace uninstalls the app
app.event("app_uninstalled", async ({ context }) => {
  const query = context.isEnterpriseInstall
    ? ({
        enterpriseId: context.enterpriseId!,
        isEnterpriseInstall: true,
      } as InstallationQuery<true>)
    : ({ teamId: context.teamId!, isEnterpriseInstall: false } as InstallationQuery<false>);
  await installationStore.deleteInstallation?.(query);
});

app.event("tokens_revoked", async ({ context }) => {
  const query = context.isEnterpriseInstall
    ? ({
        enterpriseId: context.enterpriseId!,
        isEnterpriseInstall: true,
      } as InstallationQuery<true>)
    : ({ teamId: context.teamId!, isEnterpriseInstall: false } as InstallationQuery<false>);
  await installationStore.deleteInstallation?.(query);
});

// Register all handlers
registerDashCommand(app);
registerCloseAction(app);
registerBroadcastAction(app);
registerHomeHandlers(app);

const port = Number(process.env.PORT) || 3000;

(async () => {
  await app.start(port);
  console.log(`⚡ Dash app is running on port ${port}!`);
})().catch(console.error);
