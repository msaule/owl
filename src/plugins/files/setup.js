import inquirer from 'inquirer';
import { loadConfig, saveConfig } from '../../config/index.js';

export default async function runSetup({ configPath } = {}) {
  const config = loadConfig(configPath);
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'paths',
      message: 'Comma-separated directories to watch:',
      default: (config.plugins?.files?.paths || ['~/Documents', '~/Desktop', '~/Downloads']).join(', ')
    }
  ]);

  config.plugins.files = {
    ...(config.plugins.files || {}),
    enabled: true,
    paths: answers.paths
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  };

  saveConfig(config, configPath);
  return config.plugins.files;
}
