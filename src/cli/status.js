import chalk from 'chalk';
import { loadConfig } from '../config/index.js';
import { getEmailDigestQueuePath } from '../channels/email-digest.js';
import { WorldModel } from '../core/world-model.js';
import { readPid, isProcessRunning } from '../daemon/process.js';
import { readNdjson } from '../utils/fs.js';
import { daysAgo, nextCronOccurrence } from '../utils/time.js';
import { getServiceStatus } from '../daemon/service.js';
import { showMiniBanner, computeOwlScore, formatOwlScore } from './banner.js';

function formatOccurrence(isoTimestamp) {
  if (!isoTimestamp) {
    return 'unknown';
  }

  return `${new Date(isoTimestamp).toLocaleString()} (local)`;
}

export function showStatus(configPath) {
  const config = loadConfig(configPath);
  const worldModel = new WorldModel(config.paths.dbPath);
  const pid = readPid(config.paths.pidPath);
  const running = isProcessRunning(pid);
  const stats = worldModel.getStats();
  const lastDiscovery = worldModel.getRecentDiscoveries(daysAgo(30), 1)[0];
  const deliveryQueueDepth = readNdjson(config.paths.deliveryQueuePath).length;
  const digestQueueDepth = readNdjson(getEmailDigestQueuePath(config.paths.deliveryQueuePath)).length;
  const nextQuick = nextCronOccurrence(config.discovery?.quickSchedule);
  const nextDeep = nextCronOccurrence(config.discovery?.deepSchedule);
  const nextDaily = nextCronOccurrence(config.discovery?.dailySchedule);
  const serviceStatus = getServiceStatus();

  showMiniBanner();
  console.log(chalk.bold('Status'));
  console.log(`Daemon: ${running ? chalk.green(`running (pid ${pid})`) : chalk.yellow('stopped')}`);
  console.log(
    `Autostart service: ${
      serviceStatus.installed
        ? `${serviceStatus.mechanism}${serviceStatus.active ? ' (active)' : ' (installed)'}`
        : 'not installed'
    }`
  );
  console.log(
    `Plugins active: ${
      Object.entries(config.plugins || {})
        .filter(([, value]) => value?.enabled)
        .map(([name]) => name)
        .join(', ') || 'none'
    }`
  );
  console.log(
    `Channels: ${
      Object.entries(config.channels || {})
        .filter(([, value]) => value?.enabled)
        .map(([name]) => name)
        .join(', ') || 'none'
    }`
  );
  console.log(`Entities tracked: ${stats.entities}`);
  console.log(`Events stored: ${stats.events}`);
  console.log(`Patterns stored: ${stats.patterns}`);
  console.log(`Active situations: ${stats.situations}`);
  console.log(`Discoveries: ${stats.discoveries}`);
  console.log(`Quick schedule: ${config.discovery?.quickSchedule}`);
  console.log(`Deep schedule: ${config.discovery?.deepSchedule}`);
  console.log(`Daily schedule: ${config.discovery?.dailySchedule}`);
  console.log(`Next quick scan: ${formatOccurrence(nextQuick)}`);
  console.log(`Next deep scan: ${formatOccurrence(nextDeep)}`);
  console.log(`Next daily review: ${formatOccurrence(nextDaily)}`);
  console.log(`Queued deliveries: ${deliveryQueueDepth}`);
  console.log(`Buffered email digest items: ${digestQueueDepth}`);

  if (lastDiscovery) {
    console.log(`Last discovery: ${lastDiscovery.timestamp} - ${lastDiscovery.title}`);
  } else {
    console.log('Last discovery: none yet');
  }

  // OWL Score
  console.log('');
  const score = computeOwlScore(worldModel, config);
  console.log(formatOwlScore(score));
  console.log('');

  worldModel.close();
}
