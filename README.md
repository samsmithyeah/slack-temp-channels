# Dash — Temporary Slack Channels

A Slack app that lets you quickly spin up temporary channels with the right people in them. Type `/dash`, pick some people, give it a name and purpose, and a channel is created ready to go. When the conversation is done, close it with a button — optionally broadcasting the outcome to another channel first.

## Setup

### 1. Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From an app manifest**
3. Select your workspace
4. Paste the contents of `slack-manifest.json`
5. Click **Create**

### 2. Enable Socket Mode

1. Go to **Settings** → **Socket Mode**
2. Toggle **Enable Socket Mode** on
3. Click **Generate** to create an App-Level Token with the `connections:write` scope
4. Copy the `xapp-...` token

### 3. Install to Workspace

1. Go to **Install App** in the sidebar
2. Click **Install to Workspace** → **Allow**
3. Copy the `xoxb-...` Bot User OAuth Token

### 4. Get the Signing Secret

1. Go to **Basic Information** → **App Credentials**
2. Copy the **Signing Secret**

### 5. Configure Environment

```sh
cp .env.example .env
```

Fill in the three values:

- `SLACK_BOT_TOKEN` — the `xoxb-...` token
- `SLACK_APP_TOKEN` — the `xapp-...` token
- `SLACK_SIGNING_SECRET` — the signing secret

### 6. Run

```sh
npm install
npm run dev
```

### 7. Test

Type `/dash` in any Slack channel.

## Usage

- **`/dash`** — Opens a modal to create a temporary channel
- **App Home** — Visit the Dash app's Home tab for a description and a create button
- **Close Channel** — Archives the channel
- **Broadcast & Close** — Post a summary to another channel, then archive
