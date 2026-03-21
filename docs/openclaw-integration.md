# OWL and OpenClaw

OWL is the "eyes" layer. OpenClaw is the "hands" layer.

## Why combine them

OWL keeps a living model of the user's world across email, calendar, files, Shopify, GitHub, and other plugins. OpenClaw can query that context before taking action, which makes commands like "handle this" much less blind.

## Included wrapper

This repository includes an OpenClaw-facing wrapper in [openclaw/SKILL.md](../openclaw/SKILL.md) plus helper scripts at [openclaw/query-context.js](../openclaw/query-context.js) and [openclaw/owl-daemon.js](../openclaw/owl-daemon.js).

The helper returns a structured JSON snapshot:

```bash
node openclaw/query-context.js --days 3
```

It includes:

- active situations
- recent discoveries
- recent events
- changed entities
- upcoming events
- known patterns

## Typical flow

1. OWL runs in the background and discovers something important.
2. The user asks OpenClaw to act on it.
3. OpenClaw calls the OWL context helper before taking action.
4. OpenClaw uses that context to decide what to do and which tools to call.

## Useful commands

```bash
owl status
owl context --json
owl history --days 7
```

## Principle

OWL should stay quiet unless something matters.
OpenClaw should act with that context when the user wants action.
