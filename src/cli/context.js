import chalk from 'chalk';
import { loadConfig } from '../config/index.js';
import { WorldModel } from '../core/world-model.js';
import { daysAgo } from '../utils/time.js';

export function buildContextSnapshot(worldModel, options = {}) {
  const since = daysAgo(options.days || 3);

  return {
    generatedAt: new Date().toISOString(),
    summary: worldModel.getStats(),
    activeSituations: worldModel.getActiveSituations(options.situationLimit || 10),
    recentDiscoveries: worldModel.getRecentDiscoveries(since, options.discoveryLimit || 10),
    recentEvents: worldModel.getRecentEvents(since, options.eventLimit || 25),
    changedEntities: worldModel.getChangedEntities(since, options.entityLimit || 15),
    upcomingEvents: worldModel.getUpcomingEvents(options.upcomingDays || 7, options.upcomingLimit || 15),
    patterns: worldModel.getPatterns(options.patternLimit || 10)
  };
}

export function showContext(configPath, options = {}) {
  const config = loadConfig(configPath);
  const worldModel = new WorldModel(config.paths.dbPath);
  const snapshot = buildContextSnapshot(worldModel, options);

  if (options.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    worldModel.close();
    return;
  }

  console.log(chalk.bold('\nOWL Context Snapshot'));
  console.log(`Generated: ${snapshot.generatedAt}`);
  console.log(`Entities: ${snapshot.summary.entities}`);
  console.log(`Events: ${snapshot.summary.events}`);
  console.log(`Discoveries: ${snapshot.summary.discoveries}`);
  console.log(`Active situations: ${snapshot.activeSituations.length}`);
  console.log(`Recent events: ${snapshot.recentEvents.length}`);
  console.log(`Upcoming events: ${snapshot.upcomingEvents.length}`);

  if (snapshot.activeSituations.length) {
    console.log(chalk.bold('\nActive Situations'));
    for (const situation of snapshot.activeSituations) {
      console.log(`- urgency=${situation.urgency} ${situation.description}`);
    }
  }

  if (snapshot.recentDiscoveries.length) {
    console.log(chalk.bold('\nRecent Discoveries'));
    for (const discovery of snapshot.recentDiscoveries) {
      console.log(`- [${discovery.timestamp}] ${discovery.urgency.toUpperCase()} ${discovery.title}`);
    }
  }

  worldModel.close();
}
