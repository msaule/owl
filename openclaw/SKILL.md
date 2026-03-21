# OWL Skill

Use this skill when you need persistent context about the user's world before taking action.

## What OWL provides

OWL watches the user's email, calendar, files, stores, and other connected sources in the background. It builds a local world model and discovers risks, opportunities, and time-sensitive connections.

## How to use it

1. Check whether OWL is running:

```bash
owl status
```

2. Ask OWL for a structured snapshot of the user's current world:

```bash
node openclaw/query-context.js --days 3
```

If OWL is not already running and you are working from this repository, you can start it directly through the wrapper:

```bash
node openclaw/owl-daemon.js
```

3. Review recent discoveries if you need more narrative history:

```bash
owl history --days 7
```

## When this helps

- Before making multi-step decisions that depend on business context
- Before replying about customers, suppliers, meetings, deadlines, or inventory
- When the user says "handle this" and the surrounding context matters

## Operating principle

OWL sees. OpenClaw acts.

Use OWL to understand what is already happening in the user's world, then use OpenClaw tools to take the next action.
