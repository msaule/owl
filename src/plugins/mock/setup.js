import inquirer from 'inquirer';
import { loadConfig, saveConfig } from '../../config/index.js';

export default async function runSetup({ configPath } = {}) {
  const config = loadConfig(configPath);
  const answers = await inquirer.prompt([
    {
      type: 'number',
      name: 'intervalSeconds',
      message: 'How often should mock events be emitted?',
      default: config.plugins?.mock?.intervalSeconds || 5
    }
  ]);

  config.plugins.mock = {
    ...(config.plugins.mock || {}),
    ...answers,
    enabled: true
  };
  saveConfig(config, configPath);
  return config.plugins.mock;
}
