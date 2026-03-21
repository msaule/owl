# Discovery Tuning

The discovery prompt is the product. Everything else exists to feed it better context.

## Current Discovery Stack

1. Context compiler
2. Prompt builder
3. LLM call
4. Quality filter
5. Channel delivery

## What To Tune First

### 1. Prompt quality

Ask:

- Did the discovery connect multiple signals?
- Did it explain why the connection matters?
- Would the user act on it?
- Is it too obvious?

If the answer is not strong, rewrite the prompt before adding more code.

### 2. Context relevance

Reduce stale or noisy context first. OWL should never spend tokens on dead information when the user needs current signal.

### 3. Novelty threshold

If OWL repeats itself, tighten similarity checks. If it becomes too quiet, loosen them carefully.

### 4. Importance threshold

`medium` is a good default. Raise it if OWL is too chatty. Lower it only when signal density is poor and you need exploratory output during testing.

## Scan Modes

### Quick

- recent changes only
- optimized for urgency
- tighter token budget

### Deep

- last 72 hours
- strongest place for cross-source reasoning

### Daily

- strategic review
- fewer but broader insights

## Feedback Loop

OWL records reactions and updates learned preference scores. Over time, the best tuning source is not abstract theory but the user’s own reactions:

- positive reaction
- action taken
- negative reaction
- silence

That feedback should shape future thresholds and prompt emphasis.
