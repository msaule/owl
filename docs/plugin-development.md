# OWL Plugin Development

OWL plugins are intentionally small. A plugin should be understandable in one sitting and buildable in a day.

## Plugin Shape

Every plugin lives in its own folder and should contain:

```text
src/plugins/my-plugin/
  PLUGIN.md
  index.js
  setup.js   # optional
```

OWL also looks for community plugins in:

```text
plugins/my-plugin/
~/.owl/plugins/my-plugin/
```

`index.js` exports:

```javascript
export default {
  name: 'my-plugin',
  description: 'What this plugin watches',

  async setup(config) {
    // Validate config, credentials, or local files
  },

  async *watch() {
    // Yield structured OWL events continuously
  },

  async query(question) {
    // Optional on-demand lookup support
  }
};
```

## Event Contract

Yield plain objects like:

```javascript
{
  source: 'my-plugin',
  type: 'invoice.created',
  timestamp: new Date().toISOString(),
  summary: 'Invoice created for Acme Corp',
  data: {
    customer: 'Acme Corp',
    amount: 1200
  },
  importance: 0.7
}
```

Keep the event small and structured. OWL will do the rest:

- simple entity extraction
- entity resolution
- relationship updates
- pattern updates
- situation tracking
- discovery reasoning

## Design Rules

- Keep privacy in mind first
- Prefer summaries over raw bodies
- Keep `watch()` resilient and long-running
- Return events in a format a human could understand
- Avoid framework complexity

## Good Plugin Patterns

- Poll an API every N minutes
- Watch filesystem changes
- Transform incoming records into clear summaries
- Expose a tiny setup wizard for credentials

## Example

The `files` plugin is the cleanest template in this repository because it shows the intended complexity level: small setup, local watch loop, concise event payloads, no heavy abstractions.
