import inquirer from 'inquirer';
import { loadConfig, saveConfig, readJsonIfExists, resolveHomePath } from '../../config/index.js';
import { GOOGLE_SCOPES, authorizeGoogle } from '../google-auth.js';

export default async function runSetup({ configPath } = {}) {
  const config = loadConfig(configPath);
  const existingPath = resolveHomePath(config.plugins?.gmail?.credentials || '~/.owl/credentials/gmail.json');
  const existingCredentials = readJsonIfExists(existingPath) || {};
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'credentials',
      message: 'Where should OWL store Gmail credentials?',
      default: config.plugins?.gmail?.credentials || '~/.owl/credentials/gmail.json'
    },
    {
      type: 'list',
      name: 'emailDetailLevel',
      message: 'Email detail level to store locally:',
      choices: ['minimal', 'standard', 'full'],
      default: config.plugins?.gmail?.emailDetailLevel || 'standard'
    },
    {
      type: 'input',
      name: 'clientId',
      message: 'Google OAuth client ID:',
      default: existingCredentials.clientId || ''
    },
    {
      type: 'password',
      name: 'clientSecret',
      message: 'Google OAuth client secret:',
      mask: '*',
      default: existingCredentials.clientSecret || ''
    }
  ]);

  const credentialsPath = resolveHomePath(answers.credentials);
  console.log('\nOpening your browser for Gmail read-only consent...');
  await authorizeGoogle({
    clientId: answers.clientId,
    clientSecret: answers.clientSecret,
    scopes: [GOOGLE_SCOPES.gmail],
    credentialsPath,
    onPending({ authorizationUrl, browserOpened }) {
      if (!browserOpened) {
        console.log('Open this URL in your browser to continue:');
      } else {
        console.log('If the browser does not open, use this URL:');
      }
      console.log(authorizationUrl);
    }
  });

  config.plugins.gmail = {
    ...(config.plugins.gmail || {}),
    credentials: answers.credentials,
    emailDetailLevel: answers.emailDetailLevel,
    enabled: true
  };
  saveConfig(config, configPath);
  return config.plugins.gmail;
}
