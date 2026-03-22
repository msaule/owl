# OWL

**Your AI that never sleeps. Watches your world. Discovers what you didn't know.**

OWL is a local-first Node.js daemon that watches the tools you already use, builds a living world model, and surfaces high-value discoveries through channels you already live in. It is not a chatbot and not a dashboard. It is a quiet analyst that speaks first only when something matters.

## What OWL Does

- Connects to data sources through simple plugins
- Continuously stores entities, relationships, events, patterns, and situations in a local SQLite world model
- Runs scheduled discovery passes through your chosen LLM
- Filters aggressively for novelty, confidence, and importance
- Delivers discoveries through CLI, Telegram, Slack, Discord, email digest, RSS/Atom, or webhooks
- Learns from your reactions over time so the signal gets sharper
- Automatically expires stale situations and unresponded discoveries
- Detects cross-source correlations and statistical anomalies
- Chains related discoveries into narrative threads and generates meta-insights
- Produces weekly debriefs summarizing your world
- Monitors its own health and surfaces self-diagnostics

## Quick Start

1. Install OWL globally:

```bash
npm install -g owl-ai
```

2. Run setup:

```bash
owl setup
```

For Gmail and Google Calendar, OWL opens your browser for Google OAuth consent and stores the resulting refresh token locally under `~/.owl/credentials`.

3. Start OWL:

```bash
owl start
```

4. Check status anytime:

```bash
owl status
```

For local development inside this repository, use `npm install` and then run the same commands through `node src/cli/index.js ...` or `npx owl ...`.

To keep OWL running after reboots, install the OS-level service:

```bash
owl service install
```

## Commands

```bash
owl demo                          # See OWL in action — no setup required
owl setup                         # Interactive setup wizard
owl start                         # Start the daemon
owl stop                          # Stop the daemon
owl status                        # Dashboard with OWL Score
owl score                         # Your world-awareness score (0-100)
owl context --json                # Structured world snapshot
owl history                       # Recent discoveries
owl history --week                # Last 7 days
owl health                        # Self-diagnostics
owl health --json                 # Machine-readable health
owl graph                         # Entity graph summary
owl graph "Acme Corp"             # Explore an entity's connections
owl graph --hubs                  # Most connected entities
owl graph --clusters              # Community detection
owl export                        # Full data export
owl export --discoveries --days 30
owl export --output backup.json
owl plugins                       # List plugins
owl plugins add gmail
owl plugins rm gmail
owl forget "Acme Corp"            # Right to be forgotten
owl forget --source gmail
owl reset                         # Start fresh
owl config                        # Open config in editor
owl logs                          # Recent log output
owl cost                          # LLM usage costs
owl ask "what's happening with Acme?"  # Natural language queries
owl dashboard                     # Web UI with knowledge graph
owl dashboard --port 8080
owl service install               # Survive reboots
owl service status
```

## Built-In Plugins

- `gmail` — email monitoring (sent/received)
- `calendar` — Google Calendar event tracking
- `files` — local file system watching (text, PDF, DOCX metadata)
- `shopify` — store orders and fulfillment
- `github` — repository events (pushes, PRs, issues)
- `slack` — watches channels for messages and mentions
- `mock` — synthetic test data generator

Each plugin follows the same contract: `setup`, `watch`, `query`, plus a local `PLUGIN.md` metadata file. The goal is that a community developer can write a useful plugin in a day.

## Built-In Channels

- `cli` — terminal output
- `telegram` — with conversational follow-up via reply
- `slack` — Block Kit rich formatting with thread-based follow-up
- `discord` — rich embed cards with urgency colors
- `email-digest` — batched HTML digest with smart grouping by entity/theme
- `webhook` — POST JSON to any URL (n8n, Zapier, IFTTT, custom integrations)
- `rss` — local Atom feed file for any feed reader (Feedly, Miniflux, etc.)
- `whatsapp` — via Meta Business Cloud API

## Ask OWL Anything

Talk to your world model in natural language:

```bash
owl ask "what's happening with Acme Corp?"
owl ask "who am I meeting this week?"
owl ask "any risks I should know about?"
owl ask "what's the relationship between Sarah and Project Aurora?" --days 30
```

OWL queries your entire knowledge graph — entities, events, discoveries, patterns, situations — and answers using your configured LLM.

## Web Dashboard

Launch a visual dashboard at `localhost:3000`:

```bash
owl dashboard
```

Features:
- **Interactive knowledge graph** — force-directed D3.js visualization of entities and relationships
- **Live discovery feed** — real-time stream of insights with urgency colors
- **OWL Score gauge** — world-awareness metric with breakdown
- **Event timeline** — recent activity across all sources
- Auto-refreshes every 60 seconds

## MCP Server (Claude Desktop / Cursor / Windsurf)

OWL exposes a Model Context Protocol server so any MCP-compatible AI client can query your world model:

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

**Available MCP tools:** `owl_status`, `owl_ask`, `owl_entities`, `owl_discoveries`, `owl_events`, `owl_entity_detail`, `owl_graph`, `owl_situations`

**Available MCP resources:** `owl://world-model/snapshot`, `owl://health/report`

This means Claude Desktop, Cursor, Windsurf, or any MCP client can ask "What's happening in my world?" and get real answers from your data.

## Docker

```bash
docker compose up -d
```

Or build manually:

```bash
docker build -t owl .
docker run -d --name owl -v owl-data:/data -p 3000:3000 owl
```

The container runs the daemon and exposes the dashboard on port 3000. Mount a volume for persistent data. Set `OWL_LLM_BASE_URL` to point to your Ollama instance (use `host.docker.internal` for host-network access).

## Advanced Features

### Discovery Chains
OWL tracks how discoveries relate to each other over time. When enough related discoveries accumulate (shared entities, sources, or themes), OWL generates **meta-discoveries** — higher-level insights about what the pattern of discoveries means.

### Cross-Source Correlation
Deep and daily scans automatically detect temporal correlations between events from different sources. For example: "Calendar meetings with Acme Corp are followed by GitHub PR activity within 2 hours."

### Statistical Anomaly Detection
OWL builds baselines of normal event rates per source, day-of-week, and time-of-day. It flags volume spikes and unexpected silence — e.g., "No Shopify orders in 24h, normally ~5/day."

### Weekly Debrief
Every Sunday, OWL generates a narrative summary of the past week: top discoveries, new entities, active situations, and what to watch for next week.

### Health Self-Diagnostics
`owl health` shows pipeline metrics, feedback rates, entity growth, and automatic anomaly detection for OWL's own performance. The daemon runs a daily health check and logs warnings.

### Quiet Hours
Configure a quiet period (e.g., 10pm-7am) when OWL holds non-urgent discoveries until morning. Urgent discoveries still break through unless `muteUrgent` is set. Weekend muting is also supported.

### Schema Migrations
OWL automatically upgrades its SQLite database schema when you update to a new version. Migrations are tracked and idempotent.

### Entity Graph Analysis
OWL builds a relationship graph and can traverse it to find hidden connections, community clusters, bridge entities, and hub nodes.

### Learning Feedback Loop
User reactions (via Telegram reply, Slack thread, or CLI) feed back into preference scoring. Discovery types and sources the user values get boosted; ones they dismiss get dampened. Preference hints are injected into LLM prompts so the model itself adapts.

## Privacy Model

- OWL runs locally on your machine
- Data is stored in a local SQLite database at `~/.owl/world.db`
- Config lives in `~/.owl/config.json`
- Logs live in `~/.owl/logs/owl.log`
- Stored email content is snippet-based by default, not full-body
- The only external calls are to your enabled data APIs and your configured LLM
- `owl forget` and `owl reset` remove local data immediately
- `owl export` lets you back up or inspect all stored data

## Project Structure

```text
src/
  cli/          # CLI commands, setup wizard, status, history, health, export, ask
  channels/     # Discovery delivery (CLI, Telegram, Slack, Discord, Email, Webhook, RSS, WhatsApp)
  core/         # World model, entity resolution, patterns, situations, anomaly detection, graph
  daemon/       # Background daemon, scheduler, process management, OS services
  dashboard/    # Web UI server + embedded HTML/JS with D3.js knowledge graph
  discovery/    # Engine, prompts, filtering, chains, correlation, debrief, health
  learning/     # Feedback, preferences, improvement scoring
  llm/          # LLM connection, entity extraction, conversation follow-up
  mcp/          # Model Context Protocol server for Claude Desktop, Cursor, etc.
  plugins/      # Data source plugins (Gmail, Calendar, Slack, GitHub, Files, Shopify, Mock)
tests/
docs/
```

## Development

Run the test suite:

```bash
npm test
```

Architecture includes:

- SQLite world model (entities, relationships, events, patterns, situations, discoveries, chains, preferences)
- Two-tier entity extraction (regex + LLM) with fuzzy resolution
- Entity graph traversal (paths, clusters, bridges, hubs)
- Discovery engine with three scan types (quick/deep/daily) and aggressive quality filtering
- Discovery chains with meta-discovery generation
- Cross-source temporal correlation detection
- Statistical anomaly detection with z-score baselines
- Weekly debrief generation
- Learning feedback loop — user reactions influence future discovery ranking and LLM prompts
- Automatic feedback expiry (unresponded discoveries marked neutral after 48h)
- Situation lifecycle (auto-creation, auto-expiry after 7d inactivity)
- Pattern detection with confidence scoring and next-expected prediction
- Local daemon with cron scheduling, plugin error recovery, and OS-level autostart
- Plugin loader with package-relative and external directory resolution
- Full CLI with setup wizard, status, history, health diagnostics, export, cost tracking, and privacy controls
- Eight channel implementations with retry queue, rich formatting, and conversational follow-up
- Schema migration system for seamless database upgrades
- Quiet hours with configurable windows and urgent pass-through
- Confidence calibration from historical feedback accuracy
- OpenClaw skill integration (SKILL.md + query-context + owl-daemon)

## Docs

- [Setup Guide](docs/setup-guide.md)
- [Plugin Development](docs/plugin-development.md)
- [Discovery Tuning](docs/discovery-tuning.md)
- [OpenClaw Integration](docs/openclaw-integration.md)

## License

MIT
