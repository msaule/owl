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
