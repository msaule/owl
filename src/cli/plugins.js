import chalk from 'chalk';
import path from 'node:path';
import { BUNDLED_PLUGIN_DIR, loadConfig, saveConfig } from '../config/index.js';
import { listAvailablePlugins, runPluginSetup } from '../plugins/loader.js';

function getProjectPluginDir() {
  return path.resolve(process.cwd(), 'plugins');
}

export function listPluginsCommand(configPath) {
  const config = loadConfig(configPath);
  const available = listAvailablePlugins({
    builtInDir: BUNDLED_PLUGIN_DIR,
    externalDirs: [config.paths.userPluginDir, getProjectPluginDir()]
  });

  console.log(chalk.bold('\nInstalled Plugins'));
  for (const plugin of available) {
    const enabled = config.plugins?.[plugin.name]?.enabled;
    console.log(`- ${plugin.name}${enabled ? ' (enabled)' : ''}`);
  }
}

export async function addPluginCommand(name, configPath) {
  const config = loadConfig(configPath);
  config.plugins[name] = {
    ...(config.plugins[name] || {}),
    enabled: true
  };
  saveConfig(config, configPath);

  await runPluginSetup(name, {
    configPath,
    builtInDir: BUNDLED_PLUGIN_DIR,
    externalDirs: [config.paths.userPluginDir, getProjectPluginDir()]
  });

  console.log(chalk.green(`Enabled plugin "${name}".`));
}

export function removePluginCommand(name, configPath) {
  const config = loadConfig(configPath);
  config.plugins[name] = {
    ...(config.plugins[name] || {}),
    enabled: false
  };
  saveConfig(config, configPath);
  console.log(chalk.yellow(`Disabled plugin "${name}".`));
}
