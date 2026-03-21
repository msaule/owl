import chalk from 'chalk';

const OWL_ASCII = `
    ◉  ◉
   ╭┻──┻╮
   │ OWL │
   ╰─┬┬──╯
    ╱╱╲╲
`;

const COMPACT_OWL = '🦉';

export function showBanner(version = '0.1.0') {
  const owl = chalk.hex('#FFB347')(OWL_ASCII);
  const title = chalk.bold.hex('#FFB347')('OWL');
  const tagline = chalk.dim('Your AI that never sleeps.');
  const ver = chalk.dim(`v${version}`);
  console.log(owl);
  console.log(`  ${title} ${ver}  —  ${tagline}\n`);
}

export function showMiniBanner() {
  console.log(`\n${COMPACT_OWL}  ${chalk.bold.hex('#FFB347')('OWL')} ${chalk.dim('— Your AI that never sleeps.')}\n`);
}

/**
 * OWL Score — a single 0-100 number that captures how "aware" OWL is of
 * your world right now. Designed to be shareable, gamified, motivating.
 *
 * Components (weighted):
 *   - Data freshness   (25%) — how recently sources produced events
 *   - Entity coverage   (20%) — entities tracked relative to baseline
 *   - Discovery rate    (20%) — discoveries per day vs target
 *   - Feedback loop     (15%) — % of discoveries with user reactions
 *   - Source diversity   (10%) — number of active sources
 *   - Health            (10%) — no anomalies = full marks
 */
export function computeOwlScore(worldModel, config = {}) {
  const stats = worldModel.getStats();
  const now = Date.now();
  const oneDayAgo = new Date(now - 86_400_000).toISOString();
  const sevenDaysAgo = new Date(now - 7 * 86_400_000).toISOString();

  // 1. Data freshness (25 pts) — events in last 24h
  const recentEvents = worldModel.getRecentEvents(oneDayAgo, 1000);
  const freshness = Math.min(recentEvents.length / 10, 1) * 25;

  // 2. Entity coverage (20 pts)
  const entityTarget = config.entityTarget || 50;
  const coverage = Math.min(stats.entities / entityTarget, 1) * 20;

  // 3. Discovery rate (20 pts) — discoveries in last 7 days
  const weekDiscoveries = worldModel.getRecentDiscoveries(sevenDaysAgo, 1000);
  const dailyRate = weekDiscoveries.length / 7;
  const targetRate = config.maxDiscoveriesPerDay || 5;
  const discoveryScore = Math.min(dailyRate / targetRate, 1) * 20;

  // 4. Feedback loop (15 pts) — % reacted in last 7 days
  const reacted = weekDiscoveries.filter((d) => d.user_reaction && d.user_reaction !== 'neutral');
  const feedbackRatio = weekDiscoveries.length > 0 ? reacted.length / weekDiscoveries.length : 0;
  const feedbackScore = feedbackRatio * 15;

  // 5. Source diversity (10 pts)
  const activeSources = Object.entries(config.plugins || {}).filter(([, v]) => v?.enabled).length;
  const diversityScore = Math.min(activeSources / 3, 1) * 10;

  // 6. Health (10 pts) — simple: are there entities and events?
  const healthScore = (stats.entities > 0 ? 5 : 0) + (stats.events > 0 ? 5 : 0);

  const total = Math.round(freshness + coverage + discoveryScore + feedbackScore + diversityScore + healthScore);

  return {
    total: Math.min(total, 100),
    breakdown: {
      freshness: Math.round(freshness),
      coverage: Math.round(coverage),
      discoveryRate: Math.round(discoveryScore),
      feedbackLoop: Math.round(feedbackScore),
      sourceDiversity: Math.round(diversityScore),
      health: Math.round(healthScore)
    }
  };
}

export function formatOwlScore(score) {
  const { total, breakdown } = score;

  let color;
  let label;
  if (total >= 80) {
    color = '#22C55E';
    label = 'Excellent';
  } else if (total >= 60) {
    color = '#FFB347';
    label = 'Good';
  } else if (total >= 40) {
    color = '#FBBF24';
    label = 'Growing';
  } else if (total >= 20) {
    color = '#F97316';
    label = 'Waking Up';
  } else {
    color = '#EF4444';
    label = 'Sleeping';
  }

  const bar = renderBar(total, 100, 20, color);
  const lines = [
    chalk.bold(`  OWL Score: ${chalk.hex(color)(total)} / 100  —  ${chalk.hex(color)(label)}`),
    `  ${bar}`,
    '',
    chalk.dim(`  Freshness ${padScore(breakdown.freshness, 25)}  Coverage ${padScore(breakdown.coverage, 20)}  Discoveries ${padScore(breakdown.discoveryRate, 20)}`),
    chalk.dim(`  Feedback  ${padScore(breakdown.feedbackLoop, 15)}  Sources  ${padScore(breakdown.sourceDiversity, 10)}  Health      ${padScore(breakdown.health, 10)}`)
  ];

  return lines.join('\n');
}

function padScore(value, max) {
  return `${String(value).padStart(2)}/${max}`;
}

function renderBar(value, max, width, color) {
  const filled = Math.round((value / max) * width);
  const empty = width - filled;
  return chalk.hex(color)('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
}
