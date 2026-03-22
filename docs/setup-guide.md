# OWL Setup Guide

## What You Need

- Node.js 22 or newer
- A configured LLM endpoint
- Any source credentials you want to connect
- One delivery channel

## Installation

```bash
npm install -g owl-ai
```

For local development in this repository, use:

```bash
npm install
```

## First-Time Setup

Run:

```bash
owl setup
```

The setup wizard walks through:

1. LLM provider
2. Data sources
3. Delivery channel
4. Discovery frequency

The resulting config is written to:

```text
~/.owl/config.json
```

## Credential Notes

### Gmail

OWL opens your browser for Google OAuth consent and stores the resulting credentials under `~/.owl/credentials` by default. Gmail access is read-only.

### Calendar

Calendar uses the same local OAuth flow. OWL opens the consent page, captures the callback on localhost, and stores the refresh token locally so future syncs stay local-first.

### Shopify

Provide your shop domain and Admin API access token.

### GitHub

Provide a personal access token and optionally a username or org.

### Telegram

Create a bot through `@BotFather`, provide the bot token, then send `/start` to the bot. OWL will try to detect the chat ID automatically and only falls back to manual entry if Telegram has not delivered the update yet.

## Running OWL

Start it in the background:

```bash
owl start
```

Run in the foreground:

```bash
owl start --foreground
```

Check status:

```bash
owl status
```

Install the persistent background service:

```bash
owl service install
owl service status
```

## Web Dashboard

Launch the visual dashboard:

```bash
owl dashboard
owl dashboard --port 8080
```

Features an interactive D3.js knowledge graph, live discovery feed, OWL Score gauge, and event timeline. Auto-refreshes every 60 seconds.

## Desktop App

Install Electron dependencies and run the desktop app:

```bash
npm install
npm run electron:dev
```

Build a distributable installer:

```bash
npm run electron:build
```

This produces platform-native installers (`.exe` for Windows, `.dmg` for macOS, `.AppImage` for Linux). The desktop app includes a built-in setup wizard, system tray integration, native notifications, and a global hotkey (`Ctrl+Shift+O`) to toggle the window.

> **Note:** If running from a VS Code terminal, the `electron:dev` script automatically unsets `ELECTRON_RUN_AS_NODE` which VS Code sets by default.

## MCP Server (Claude Desktop / Cursor / Windsurf)

Add OWL as an MCP server in your AI client's config:

```json
{
  "mcpServers": {
    "owl": {
      "command": "node",
      "args": ["/path/to/owl/src/mcp/server.js"]
    }
  }
}
```

Available tools: `owl_status`, `owl_ask`, `owl_entities`, `owl_discoveries`, `owl_events`, `owl_entity_detail`, `owl_graph`, `owl_situations`

This lets Claude Desktop, Cursor, or Windsurf query your world model directly.

## Docker

```bash
docker compose up -d
```

Or build manually:

```bash
docker build -t owl .
docker run -d --name owl -v owl-data:/data -p 3000:3000 owl
```

The container runs the daemon and exposes the dashboard on port 3000. Set `OWL_LLM_BASE_URL` to point to your LLM (use `host.docker.internal` for host-network Ollama).

## Logs and Costs

```bash
owl logs
owl cost
```

## Data Control

Forget one entity:

```bash
owl forget "Acme Corp"
```

Forget one source:

```bash
owl forget --source gmail
```

Reset everything:

```bash
owl reset
```
