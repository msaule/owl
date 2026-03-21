#!/usr/bin/env node
import fs from 'node:fs';
import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import chalk from 'chalk';
import { ensureConfigFile, loadConfig } from '../config/index.js';
import { startDetachedDaemon, stopDaemon, readPid, isProcessRunning } from '../daemon/process.js';
import { runSetupWizard } from './setup.js';
import { showStatus } from './status.js';
import { showHistory } from './history.js';
import { showContext } from './context.js';
import { listPluginsCommand, addPluginCommand, removePluginCommand } from './plugins.js';
import { WorldModel } from '../core/world-model.js';
import { tailFile } from '../utils/logger.js';
import { summarizeCosts } from '../llm/connection.js';
import { getServiceStatus, installService, uninstallService } from '../daemon/service.js';
import { computeHealthMetrics, detectHealthAnomalies, formatHealthReport } from '../discovery/health.js';
import { buildAdjacencyList, findPath as graphFindPath, findClusters as graphFindClusters, getHubs as graphGetHubs } from '../core/graph.js';
import { showBanner, computeOwlScore, formatOwlScore } from './banner.js';
import { runDemo } from './demo.js';

const program = new Command();
const __filename = fileURLToPath(import.meta.url);
const daemonScriptPath = path.resolve(path.dirname(__filename), '../daemon/index.js');

program.name('owl').description('Your AI that never sleeps.');

program
  .command('setup')
  .description('Run the interactive OWL setup wizard')
  .action(async () => {
    await runSetupWizard();
  });

program
  .command('start')
  .description('Start the OWL daemon')
  .option('--foreground', 'Run in the foreground')
  .action(async (options) => {
    ensureConfigFile();
    const config = loadConfig();
    const existingPid = readPid(config.paths.pidPath);
    if (isProcessRunning(existingPid)) {
      console.log(chalk.yellow(`OWL is already running (pid ${existingPid}).`));
      return;
    }

    if (options.foreground) {
      const child = spawn(process.execPath, [daemonScriptPath, '--config', config.paths.configPath], {
        stdio: 'inherit'
      });
      child.on('exit', (code) => {
        process.exitCode = code || 0;
      });
      return;
    }

    const pid = startDetachedDaemon({
      scriptPath: daemonScriptPath,
      pidPath: config.paths.pidPath,
      configPath: config.paths.configPath
    });

    console.log(chalk.green(`Started OWL in the background (pid ${pid}).`));
  });

program
  .command('stop')
  .description('Stop the OWL daemon')
  .action(() => {
    ensureConfigFile();
    const config = loadConfig();
    const stopped = stopDaemon(config.paths.pidPath);
    console.log(stopped ? chalk.green('Stopped OWL.') : chalk.yellow('OWL was not running.'));
  });

program
  .command('status')
  .description('Show OWL daemon and world model status')
  .action(() => {
    ensureConfigFile();
    showStatus();
  });

program
  .command('context')
  .description('Show a structured snapshot of OWL context')
  .option('--json', 'Output JSON')
  .option('--days <days>', 'Look back this many days', Number, 3)
  .action((options) => {
    ensureConfigFile();
    showContext(undefined, options);
  });

program
  .command('history')
  .description('Show recent discoveries')
  .option('--week', 'Show the last week')
  .option('--days <days>', 'Show the last N days', Number)
  .action((options) => {
    ensureConfigFile();
    showHistory(undefined, options);
  });

const pluginsCommand = program.command('plugins').description('Manage plugins');
pluginsCommand.action(() => {
  ensureConfigFile();
  listPluginsCommand();
});
pluginsCommand.command('add <name>').action(async (name) => addPluginCommand(name));
pluginsCommand.command('rm <name>').action((name) => removePluginCommand(name));

const serviceCommand = program.command('service').description('Manage OWL autostart service');
serviceCommand
  .command('install')
  .description('Install an OS-level background service so OWL survives reboots')
  .option('--now', 'Start the service immediately when supported')
  .action((options) => {
    ensureConfigFile();
    const config = loadConfig();
    const result = installService({
      scriptPath: daemonScriptPath,
      configPath: config.paths.configPath,
      logPath: config.paths.logPath,
      startNow: Boolean(options.now)
    });
    console.log(
      chalk.green(
        `Installed OWL ${result.mechanism} service${result.path ? ` at ${result.path}` : ` (${result.name})`}.`
      )
    );
  });

serviceCommand
  .command('uninstall')
  .description('Remove the OWL autostart service')
  .action(() => {
    const result = uninstallService();
    console.log(
      result.removed
        ? chalk.green('Removed OWL autostart service.')
        : chalk.yellow('OWL autostart service was not installed.')
    );
  });

serviceCommand
  .command('status')
  .description('Show OWL autostart service status')
  .action(() => {
    const status = getServiceStatus();
    console.log(chalk.bold('\nOWL Service Status'));
    console.log(`Mechanism: ${status.mechanism}`);
    console.log(`Installed: ${status.installed ? 'yes' : 'no'}`);
    console.log(`Active: ${status.active ? 'yes' : 'no'}`);
    if (status.path) {
      console.log(`Path: ${status.path}`);
    }
  });

program
  .command('forget [entity]')
  .description('Forget an entity or an entire source')
  .option('--source <plugin>', 'Forget everything from a source plugin')
  .action((entity, options) => {
    ensureConfigFile();
    const config = loadConfig();
    const worldModel = new WorldModel(config.paths.dbPath);

    if (options.source) {
      worldModel.forgetSource(options.source);
      console.log(chalk.green(`Forgot source "${options.source}".`));
      worldModel.close();
      return;
    }

    if (!entity) {
      console.log(chalk.yellow('Provide an entity name or use --source.'));
      worldModel.close();
      return;
    }

    const removed = worldModel.forgetEntity(entity);
    console.log(removed ? chalk.green(`Forgot "${entity}".`) : chalk.yellow(`No entity found for "${entity}".`));
    worldModel.close();
  });

program
  .command('reset')
  .description('Delete OWL memory and start fresh')
  .action(() => {
    ensureConfigFile();
    const config = loadConfig();
    const worldModel = new WorldModel(config.paths.dbPath);
    worldModel.reset();
    worldModel.close();
    console.log(chalk.green('OWL memory reset.'));
  });

program
  .command('config')
  .description('Open the OWL config file in the default editor')
  .action(() => {
    ensureConfigFile();
    const config = loadConfig();
    const editor = process.env.EDITOR || 'notepad';
    spawn(editor, [config.paths.configPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    console.log(`Opened ${config.paths.configPath}`);
  });

program
  .command('logs')
  .description('Show recent OWL logs')
  .option('--lines <lines>', 'Number of lines to show', Number, 50)
  .action((options) => {
    ensureConfigFile();
    const config = loadConfig();
    for (const line of tailFile(config.paths.logPath, options.lines)) {
      console.log(line);
    }
  });

program
  .command('cost')
  .description('Show recent LLM usage costs')
  .option('--days <days>', 'Number of days to summarize', Number, 30)
  .action((options) => {
    ensureConfigFile();
    const config = loadConfig();
    const summary = summarizeCosts(config.paths.costLogPath, options.days);
    console.log(chalk.bold('\nLLM Cost Summary'));
    console.log(`Calls: ${summary.calls}`);
    console.log(`Input tokens: ${summary.inputTokens}`);
    console.log(`Output tokens: ${summary.outputTokens}`);
    console.log(`Estimated cost: $${summary.estimatedCost.toFixed(4)}`);
  });

program
  .command('graph [entity]')
  .description('Show entity relationships and graph insights')
  .option('--path <from> <to>', 'Find path between two entities')
  .option('--hubs', 'Show the most connected entities')
  .option('--clusters', 'Show entity clusters')
  .action((entity, options) => {
    ensureConfigFile();
    const config = loadConfig();
    const worldModel = new WorldModel(config.paths.dbPath);
    const graph = buildAdjacencyList(worldModel);

    if (graph.size === 0) {
      console.log(chalk.yellow('No entities or relationships in the world model yet.'));
      worldModel.close();
      return;
    }

    if (options.hubs) {
      const hubs = graphGetHubs(graph, 15);
      console.log(chalk.bold('\nMost Connected Entities'));
      for (const hub of hubs) {
        const e = worldModel.getEntity(hub.entityId);
        const name = e ? e.name : hub.entityId;
        console.log(`  ${name} — ${hub.degree} connections (avg strength: ${hub.avgStrength.toFixed(2)})`);
      }
      worldModel.close();
      return;
    }

    if (options.clusters) {
      const clusters = graphFindClusters(graph);
      console.log(chalk.bold(`\nEntity Clusters (${clusters.size} found)`));
      let i = 1;
      for (const [, members] of clusters) {
        const names = [...members].map((id) => {
          const e = worldModel.getEntity(id);
          return e ? e.name : id;
        });
        console.log(`  Cluster ${i}: ${names.join(', ')}`);
        i++;
      }
      worldModel.close();
      return;
    }

    if (entity) {
      const found = worldModel.findEntities(entity, 1)[0];
      if (!found) {
        console.log(chalk.yellow(`No entity found matching "${entity}".`));
        worldModel.close();
        return;
      }

      console.log(chalk.bold(`\n${found.name} [${found.type}]`));
      console.log(`First seen: ${found.first_seen}  |  Last seen: ${found.last_seen}`);
      console.log(`Sources: ${(found.sources || []).join(', ')}`);

      const relationships = worldModel.getRelationships(found.id);
      if (relationships.length > 0) {
        console.log(chalk.bold('\nRelationships:'));
        for (const rel of relationships) {
          const otherEntity = rel.from_entity === found.id
            ? worldModel.getEntity(rel.to_entity)
            : worldModel.getEntity(rel.from_entity);
          const otherName = otherEntity ? otherEntity.name : (rel.from_entity === found.id ? rel.to_entity : rel.from_entity);
          const direction = rel.from_entity === found.id ? '->' : '<-';
          console.log(`  ${direction} ${rel.type} ${otherName} (strength: ${rel.strength})`);
        }
      }

      // Show recent events involving this entity
      const recentEvents = worldModel.getRecentEvents(
        new Date(Date.now() - 14 * 86_400_000).toISOString(), 200
      ).filter((e) => (e.entities || []).includes(found.id)).slice(0, 10);

      if (recentEvents.length > 0) {
        console.log(chalk.bold('\nRecent Activity:'));
        for (const event of recentEvents) {
          const dateStr = new Date(event.timestamp).toLocaleDateString();
          console.log(`  [${dateStr}] ${event.source}/${event.type}: ${event.summary.slice(0, 80)}`);
        }
      }
    } else {
      // Default: show graph summary
      console.log(chalk.bold('\nEntity Graph Summary'));
      console.log(`Nodes: ${graph.size}`);
      const totalEdges = [...graph.values()].reduce((sum, edges) => sum + edges.length, 0) / 2;
      console.log(`Edges: ${Math.round(totalEdges)}`);
      const hubs = graphGetHubs(graph, 5);
      if (hubs.length > 0) {
        console.log(chalk.bold('\nTop Hubs:'));
        for (const hub of hubs) {
          const e = worldModel.getEntity(hub.entityId);
          console.log(`  ${e ? e.name : hub.entityId} (${hub.degree} connections)`);
        }
      }
    }

    worldModel.close();
  });

program
  .command('export')
  .description('Export OWL data for backup or portability')
  .option('--format <format>', 'Export format: json or csv', 'json')
  .option('--output <path>', 'Output file path')
  .option('--entities', 'Export entities only')
  .option('--discoveries', 'Export discoveries only')
  .option('--events', 'Export events only')
  .option('--days <days>', 'Only export data from the last N days', Number)
  .action((options) => {
    ensureConfigFile();
    const config = loadConfig();
    const worldModel = new WorldModel(config.paths.dbPath);

    const since = options.days
      ? new Date(Date.now() - options.days * 86_400_000).toISOString()
      : new Date(0).toISOString();

    const data = {};

    if (!options.entities && !options.discoveries && !options.events) {
      // Export everything
      data.entities = worldModel.getChangedEntities(since, 10000);
      data.discoveries = worldModel.getRecentDiscoveries(since, 10000);
      data.events = worldModel.getRecentEvents(since, 10000);
      data.patterns = worldModel.getPatterns(1000);
      data.situations = worldModel.getActiveSituations(1000);
      data.chains = worldModel.getActiveChains(1000);
    } else {
      if (options.entities) data.entities = worldModel.getChangedEntities(since, 10000);
      if (options.discoveries) data.discoveries = worldModel.getRecentDiscoveries(since, 10000);
      if (options.events) data.events = worldModel.getRecentEvents(since, 10000);
    }

    data.exportedAt = new Date().toISOString();
    data.stats = worldModel.getStats();

    const output = JSON.stringify(data, null, 2);

    if (options.output) {
      fs.writeFileSync(options.output, output, 'utf8');
      console.log(chalk.green(`Exported to ${options.output}`));
    } else {
      console.log(output);
    }

    worldModel.close();
  });

program
  .command('health')
  .description('Show OWL health diagnostics and self-analysis')
  .option('--json', 'Output raw JSON metrics')
  .action((options) => {
    ensureConfigFile();
    const config = loadConfig();
    const worldModel = new WorldModel(config.paths.dbPath);
    const metrics = computeHealthMetrics(worldModel);
    const anomalies = detectHealthAnomalies(metrics);

    if (options.json) {
      console.log(JSON.stringify({ metrics, anomalies }, null, 2));
    } else {
      console.log('');
      console.log(formatHealthReport(metrics, anomalies));
    }

    worldModel.close();
  });

program
  .command('demo')
  .description('Run an interactive demo to see OWL in action — no setup required')
  .action(async () => {
    await runDemo();
  });

program
  .command('score')
  .description('Show your OWL Score — a single number for how aware OWL is of your world')
  .option('--json', 'Output raw JSON')
  .action((options) => {
    ensureConfigFile();
    const config = loadConfig();
    const worldModel = new WorldModel(config.paths.dbPath);
    const score = computeOwlScore(worldModel, config);

    if (options.json) {
      console.log(JSON.stringify(score, null, 2));
    } else {
      console.log('');
      console.log(formatOwlScore(score));
      console.log('');
    }

    worldModel.close();
  });

program.parseAsync(process.argv);
