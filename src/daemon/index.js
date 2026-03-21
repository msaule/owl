#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ensureConfigFile, BUNDLED_PLUGIN_DIR } from '../config/index.js';
import { Logger } from '../utils/logger.js';
import { WorldModel } from '../core/world-model.js';
import { processEvent } from '../core/event-processor.js';
import { EntityExtractionQueue } from '../llm/entity-extract.js';
import { LLMConnection } from '../llm/connection.js';
import { loadPlugins } from '../plugins/loader.js';
import { DiscoveryEngine } from '../discovery/engine.js';
import { ChannelManager } from '../channels/manager.js';
import { registerSchedules } from './scheduler.js';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      continue;
    }

    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(key, true);
      continue;
    }

    args.set(key, next);
    index += 1;
  }
  return args;
}

async function watchPlugin(plugin, { worldModel, llm, entityQueue, logger }) {
  try {
    for await (const event of plugin.instance.watch()) {
      await processEvent(event, worldModel, llm, { entityQueue, logger });
    }
  } catch (error) {
    logger.error(`Plugin ${plugin.name} error`, { message: error.message });
    setTimeout(() => {
      watchPlugin(plugin, { worldModel, llm, entityQueue, logger });
    }, 60_000);
  }
}

function getProjectPluginDir() {
  return path.resolve(process.cwd(), 'plugins');
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function startDaemon(options = {}) {
  ensureConfigFile();
  const config = loadConfig(options.configPath);
  const logger = new Logger({ logPath: config.paths.logPath, debug: options.debug });
  const worldModel = new WorldModel(config.paths.dbPath, { logger });
  const llm = new LLMConnection(config.llm, { logger, costLogPath: config.paths.costLogPath });
  const channels = new ChannelManager(config.channels, {
    logger,
    worldModel,
    llm,
    deliveryQueuePath: config.paths.deliveryQueuePath
  });
  const entityQueue = new EntityExtractionQueue({ worldModel, llm, logger });
  const discovery = new DiscoveryEngine(worldModel, llm, channels, config.discovery, {
    logger,
    user: config.user
  });

  const plugins = await loadPlugins({
    builtInDir: BUNDLED_PLUGIN_DIR,
    externalDirs: [config.paths.userPluginDir, getProjectPluginDir()],
    config
  });

  writeState(config.paths.statePath, {
    startedAt: new Date().toISOString(),
    pid: process.pid,
    plugins: plugins.map((plugin) => plugin.name),
    dbPath: config.paths.dbPath
  });

  for (const plugin of plugins) {
    watchPlugin(plugin, { worldModel, llm, entityQueue, logger });
  }

  const tasks = registerSchedules({
    discovery,
    channels,
    entityQueue,
    config,
    worldModel,
    llm,
    logger
  });

  logger.info('OWL is watching', { plugins: plugins.length });
  console.log(`OWL is watching. ${plugins.length} plugins active.`);

  const cleanup = async () => {
    for (const task of tasks) {
      task.stop();
    }
    worldModel.close();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return { config, logger, worldModel, llm, channels, entityQueue, discovery, plugins };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  startDaemon({
    configPath: args.get('config'),
    debug: Boolean(args.get('debug'))
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
