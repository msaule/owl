import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

export const OWL_HOME = path.join(os.homedir(), '.owl');
export const CONFIG_PATH = path.join(OWL_HOME, 'config.json');
export const DB_PATH = path.join(OWL_HOME, 'world.db');
export const LOG_DIR = path.join(OWL_HOME, 'logs');
export const LOG_PATH = path.join(LOG_DIR, 'owl.log');
export const PID_PATH = path.join(OWL_HOME, 'owl.pid');
export const STATE_PATH = path.join(OWL_HOME, 'state.json');
export const COST_LOG_PATH = path.join(OWL_HOME, 'costs.ndjson');
export const DELIVERY_QUEUE_PATH = path.join(OWL_HOME, 'delivery-queue.ndjson');
export const CREDENTIALS_DIR = path.join(OWL_HOME, 'credentials');
export const USER_PLUGIN_DIR = path.join(OWL_HOME, 'plugins');
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BUNDLED_DEFAULT_CONFIG_PATH = path.join(PACKAGE_ROOT, 'owl.config.json');
export const BUNDLED_PLUGIN_DIR = path.join(PACKAGE_ROOT, 'src', 'plugins');

const ROOT_DEFAULT_CONFIG = BUNDLED_DEFAULT_CONFIG_PATH;

/**
 * @typedef {Record<string, any>} JsonObject
 */

export function ensureRuntimeDirs() {
  for (const dir of [OWL_HOME, LOG_DIR, CREDENTIALS_DIR, USER_PLUGIN_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
export function resolveHomePath(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }

  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

/**
 * @param {string} value
 * @returns {string}
 */
export function collapseHomePath(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }

  const home = os.homedir();
  if (value === home) {
    return '~';
  }

  if (value.startsWith(`${home}${path.sep}`)) {
    return `~/${value.slice(home.length + 1).replaceAll('\\', '/')}`;
  }

  return value;
}

/**
 * @param {string} filePath
 * @returns {JsonObject | null}
 */
export function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * @param {string} filePath
 * @param {JsonObject} value
 */
export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * @param {JsonObject} base
 * @param {JsonObject} overlay
 * @returns {JsonObject}
 */
export function mergeDeep(base, overlay) {
  const output = Array.isArray(base) ? [...base] : { ...base };

  for (const [key, value] of Object.entries(overlay ?? {})) {
    if (Array.isArray(value)) {
      output[key] = [...value];
      continue;
    }

    if (value && typeof value === 'object') {
      output[key] = mergeDeep(
        output[key] && typeof output[key] === 'object' && !Array.isArray(output[key]) ? output[key] : {},
        value
      );
      continue;
    }

    output[key] = value;
  }

  return output;
}

export function getDefaultConfig() {
  const defaults = readJsonIfExists(ROOT_DEFAULT_CONFIG) ?? {};

  return mergeDeep(
    {
      user: { name: '' },
      llm: {
        provider: 'openai-compatible',
        baseUrl: process.env.OWL_LLM_BASE_URL || 'http://localhost:11434/v1',
        apiKey: process.env.OWL_LLM_API_KEY || '',
        model: process.env.OWL_LLM_MODEL || 'qwen2.5:14b-instruct',
        detailLevel: 'standard',
        pricing: { inputPer1k: 0, outputPer1k: 0 }
      },
      discovery: {
        quickSchedule: '*/30 * * * *',
        deepSchedule: '0 */6 * * *',
        dailySchedule: '0 7 * * *',
        maxDiscoveriesPerDay: 5,
        maxDiscoveriesPerRun: 3,
        minConfidence: 0.6,
        importanceThreshold: 'medium'
      },
      plugins: {},
      channels: { cli: { enabled: true } }
    },
    defaults
  );
}

/**
 * @param {string} [configPath]
 */
export function loadConfig(configPath = CONFIG_PATH) {
  ensureRuntimeDirs();

  const defaults = getDefaultConfig();
  const userConfig = readJsonIfExists(configPath) ?? {};
  const merged = mergeDeep(defaults, userConfig);

  merged.paths = {
    owlHome: OWL_HOME,
    configPath,
    dbPath: resolveHomePath(merged.dbPath || DB_PATH),
    logPath: resolveHomePath(merged.logPath || LOG_PATH),
    pidPath: resolveHomePath(merged.pidPath || PID_PATH),
    statePath: resolveHomePath(merged.statePath || STATE_PATH),
    costLogPath: resolveHomePath(merged.costLogPath || COST_LOG_PATH),
    deliveryQueuePath: resolveHomePath(merged.deliveryQueuePath || DELIVERY_QUEUE_PATH),
    credentialsDir: resolveHomePath(merged.credentialsDir || CREDENTIALS_DIR),
    userPluginDir: resolveHomePath(merged.userPluginDir || USER_PLUGIN_DIR)
  };

  for (const [pluginName, pluginConfig] of Object.entries(merged.plugins ?? {})) {
    if (pluginConfig && typeof pluginConfig === 'object') {
      if (pluginConfig.credentials) {
        pluginConfig.credentials = resolveHomePath(pluginConfig.credentials);
      }

      if (Array.isArray(pluginConfig.paths)) {
        pluginConfig.paths = pluginConfig.paths.map(resolveHomePath);
      }

      merged.plugins[pluginName] = pluginConfig;
    }
  }

  return merged;
}

function toPersistedConfigValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => toPersistedConfigValue(item));
  }

  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'paths') {
        continue;
      }
      output[key] = toPersistedConfigValue(child);
    }
    return output;
  }

  return typeof value === 'string' ? collapseHomePath(value) : value;
}

/**
 * @param {JsonObject} config
 * @param {string} [configPath]
 */
export function saveConfig(config, configPath = CONFIG_PATH) {
  ensureRuntimeDirs();
  writeJson(configPath, toPersistedConfigValue(config));
}

export function ensureConfigFile() {
  ensureRuntimeDirs();

  if (!fs.existsSync(CONFIG_PATH)) {
    saveConfig(getDefaultConfig(), CONFIG_PATH);
  }

  return CONFIG_PATH;
}
