import inquirer from 'inquirer';
import { loadConfig, saveConfig } from '../../config/index.js';

export default async function runSetup({ configPath } = {}) {
  const config = loadConfig(configPath);
  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'botToken',
      message: 'Slack Bot User OAuth Token (xoxb-...):',
      mask: '*'
    },
    {
      type: 'input',
      name: 'channels',
      message: 'Channels to watch (comma-separated, e.g. general,sales,support):',
      default: (config.plugins?.slack?.channels || []).join(', ')
    }
  ]);

  config.plugins.slack = {
    ...(config.plugins.slack || {}),
    botToken: answers.botToken,
    channels: answers.channels.split(',').map((ch) => ch.trim()).filter(Boolean),
    enabled: true
  };
  saveConfig(config, configPath);
  return config.plugins.slack;
}
