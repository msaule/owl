import inquirer from 'inquirer';
import { loadConfig, saveConfig } from '../../config/index.js';

export default async function runSetup({ configPath } = {}) {
  const config = loadConfig(configPath);
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'shopDomain',
      message: 'Shopify shop domain (example: mystore.myshopify.com):',
      default: config.plugins?.shopify?.shopDomain || ''
    },
    {
      type: 'password',
      name: 'accessToken',
      message: 'Shopify Admin API access token:',
      mask: '*'
    }
  ]);

  config.plugins.shopify = {
    ...(config.plugins.shopify || {}),
    ...answers,
    enabled: true
  };
  saveConfig(config, configPath);
  return config.plugins.shopify;
}
