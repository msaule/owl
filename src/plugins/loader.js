import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUNDLED_PLUGIN_DIR } from '../config/index.js';

const RESERVED_NAMES = new Set(['loader']);

function getPluginCandidates(baseDir) {
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !RESERVED_NAMES.has(entry.name))
    .map((entry) => path.join(baseDir, entry.name));
}

function normalizeDirs(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

async function loadPluginFromDirectory(pluginPath, config = {}) {
  const indexPath = path.join(pluginPath, 'index.js');
  const pluginMdPath = path.join(pluginPath, 'PLUGIN.md');
  if (!fs.existsSync(indexPath)) {
    return null;
  }
  if (!fs.existsSync(pluginMdPath)) {
    return null;
  }

  const module = await import(pathToFileURL(indexPath).href);
  const plugin = module.default || module;
  if (!plugin?.name || typeof plugin.watch !== 'function') {
    throw new Error(`Invalid plugin at ${pluginPath}`);
  }

  if (typeof plugin.setup === 'function') {
    await plugin.setup(config);
  }

  return {
    name: plugin.name,
    description: plugin.description || '',
    path: pluginPath,
    instance: plugin
  };
}

export async function loadPlugins(options = {}) {
  const builtInDir = options.builtInDir || BUNDLED_PLUGIN_DIR;
  const externalDirs = normalizeDirs(options.externalDirs || options.externalDir);
  const config = options.config || {};
  const pluginDirs = [
    ...getPluginCandidates(builtInDir),
    ...externalDirs.flatMap((directory) => getPluginCandidates(directory))
  ];
  const seen = new Set();
  const loaded = [];

  for (const pluginDir of pluginDirs) {
    const name = path.basename(pluginDir);
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);

    const pluginConfig = config.plugins?.[name];
    if (pluginConfig && pluginConfig.enabled === false) {
      continue;
    }

    if (!pluginConfig?.enabled && !config.loadDisabled) {
      continue;
    }

    const plugin = await loadPluginFromDirectory(pluginDir, pluginConfig || {});
    if (plugin) {
      loaded.push(plugin);
    }
  }

  return loaded;
}

export function listAvailablePlugins(options = {}) {
  const builtInDir = options.builtInDir || BUNDLED_PLUGIN_DIR;
  const externalDirs = normalizeDirs(options.externalDirs || options.externalDir);
  const pluginDirs = [
    ...getPluginCandidates(builtInDir),
    ...externalDirs.flatMap((directory) => getPluginCandidates(directory))
  ];
  const seen = new Set();

  return pluginDirs
    .filter((pluginDir) => {
      const name = path.basename(pluginDir);
      if (seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    })
    .map((pluginDir) => {
      const name = path.basename(pluginDir);
      const pluginMd = path.join(pluginDir, 'PLUGIN.md');
      return {
        name,
        path: pluginDir,
        hasMetadata: fs.existsSync(pluginMd)
      };
    });
}

export async function runPluginSetup(name, options = {}) {
  const builtInDir = options.builtInDir || BUNDLED_PLUGIN_DIR;
  const externalDirs = normalizeDirs(options.externalDirs || options.externalDir);
  const candidates = [...getPluginCandidates(builtInDir), ...externalDirs.flatMap((directory) => getPluginCandidates(directory))];
  const pluginDir = candidates.find((entry) => path.basename(entry) === name);

  if (!pluginDir) {
    throw new Error(`Plugin "${name}" not found`);
  }

  const setupPath = path.join(pluginDir, 'setup.js');
  if (!fs.existsSync(setupPath)) {
    return null;
  }

  const module = await import(pathToFileURL(setupPath).href);
  const setup = module.default || module.runSetup || module.setup;

  if (typeof setup !== 'function') {
    return null;
  }

  return setup(options);
}
