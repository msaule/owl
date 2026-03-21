---
name: slack
description: Watches Slack channels for messages, mentions, and activity.
---

# Slack Plugin

Connects to your Slack workspace using a Bot Token and polls for recent messages in configured channels.

## Setup

1. Create a Slack App at https://api.slack.com/apps
2. Add Bot Token Scopes: `channels:history`, `channels:read`, `users:read`
3. Install the app to your workspace
4. Copy the Bot User OAuth Token

## Configuration

```json
{
  "plugins": {
    "slack": {
      "enabled": true,
      "botToken": "xoxb-...",
      "channels": ["general", "sales", "support"],
      "pollMinutes": 2
    }
  }
}
```

## Events Emitted

- `slack.message` — new message in a watched channel
- `slack.mention` — message that mentions the bot or user
