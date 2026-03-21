# Contributing to OWL

Thank you for your interest in contributing to OWL! This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/msaule/owl.git
cd owl
npm install
```

Run the test suite:

```bash
npm test
```

Try the demo without connecting any sources:

```bash
node src/cli/index.js demo
```

## Project Structure

```
src/
  cli/          # CLI commands, setup wizard, demo, banner
  channels/     # Discovery delivery (CLI, Telegram, Slack, Discord, Email, Webhook, RSS, WhatsApp)
  core/         # World model, entity resolution, graph, anomaly detection, migrations
  daemon/       # Background daemon, scheduler, process management, OS services
  discovery/    # Engine, prompts, filtering, chains, correlation, debrief, health
  learning/     # Feedback, preferences, confidence calibration
  llm/          # LLM connection, entity extraction, conversation follow-up
  plugins/      # Data source plugins (Gmail, Calendar, Slack, GitHub, Files, Shopify, Mock)
  config/       # Configuration loading and defaults
  utils/        # Shared utilities (fs, time, logger)
tests/          # Test suites (node:test)
docs/           # Documentation and GitHub Pages site
```

## Writing a Plugin

OWL plugins follow a simple contract. See [Plugin Development](docs/plugin-development.md) for details. The short version:

1. Create a directory under `src/plugins/<name>/`
2. Export `setup()`, `watch()`, and `query()` functions
3. Add a `PLUGIN.md` metadata file
4. Register the plugin in the plugin loader

## Writing a Channel

Channels implement a `send(discoveries, metadata)` method and optionally `flush()` for batched delivery and `pollReplies()` for conversational follow-up. See existing channels for reference.

## Running Tests

OWL uses the Node.js built-in test runner:

```bash
# Run all tests
npm test

# Run a specific test file
node --test tests/banner-score.test.js
```

Tests create temporary SQLite databases that are cleaned up automatically.

## Code Style

- ESM modules throughout (`import`/`export`, no `require`)
- Minimal dependencies — prefer Node.js built-ins
- No TypeScript — plain JavaScript with clear function signatures
- Keep files focused and under ~200 lines where possible

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b my-feature`
3. Make your changes and add tests
4. Run `npm test` to ensure everything passes
5. Submit a pull request with a clear description

## Reporting Bugs

Open an issue with:
- Your Node.js version (`node --version`)
- Your OS
- Steps to reproduce
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
