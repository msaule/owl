import inquirer from 'inquirer';
import { loadConfig, saveConfig } from '../../config/index.js';

export default async function runSetup({ configPath } = {}) {
  const config = loadConfig(configPath);
  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: 'GitHub personal access token:',
      mask: '*'
    },
    {
      type: 'input',
      name: 'owner',
      message: 'Optional GitHub username or org to watch (blank = authenticated user):',
      default: config.plugins?.github?.owner || ''
    }
  ]);

  config.plugins.github = {
    ...(config.plugins.github || {}),
    ...answers,
    enabled: true
  };
  saveConfig(config, configPath);
  return config.plugins.github;
}
