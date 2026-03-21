import chalk from 'chalk';
import { loadConfig } from '../config/index.js';
import { WorldModel } from '../core/world-model.js';
import { daysAgo } from '../utils/time.js';

const URGENCY_EMOJI = {
  urgent: '\u{1F534}',
  important: '\u{1F7E1}',
  interesting: '\u{1F7E2}'
};

const URGENCY_CHALK = {
  urgent: chalk.red,
  important: chalk.yellow,
  interesting: chalk.green
};

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function showHistory(configPath, options = {}) {
  const config = loadConfig(configPath);
  const worldModel = new WorldModel(config.paths.dbPath);
  const since = options.week ? daysAgo(7) : daysAgo(options.days || 3);
  const discoveries = worldModel.getRecentDiscoveries(since, 100);

  const label = options.week ? 'past week' : `past ${options.days || 3} days`;
  console.log(chalk.bold(`\nRecent Discoveries (${label})`));

  if (!discoveries.length) {
    console.log('No discoveries yet.');
    worldModel.close();
    return;
  }

  for (const discovery of discoveries) {
    const emoji = URGENCY_EMOJI[discovery.urgency] || '';
    const colorFn = URGENCY_CHALK[discovery.urgency] || chalk.white;
    const time = formatTimestamp(discovery.timestamp);
    const reaction = discovery.user_reaction
      ? chalk.dim(` [${discovery.user_reaction}${discovery.acted_on ? ', acted on' : ''}]`)
      : '';

    console.log(`\n${emoji} ${colorFn(discovery.title)}  ${chalk.dim(time)}${reaction}`);
    console.log(discovery.body);
    console.log(chalk.dim(`Sources: ${(discovery.sources || []).join(', ') || 'unknown'}`));
  }

  console.log(chalk.dim(`\n${discoveries.length} discoveries shown.`));
  worldModel.close();
}
