import inquirer from 'inquirer';
import { loadConfig, saveConfig, readJsonIfExists, resolveHomePath } from '../../config/index.js';
import { GOOGLE_SCOPES, authorizeGoogle } from '../google-auth.js';

export default async function runSetup({ configPath } = {}) {
  const config = loadConfig(configPath);
  const existingPath = resolveHomePath(config.plugins?.calendar?.credentials || '~/.owl/credentials/calendar.json');
  const existingCredentials = readJsonIfExists(existingPath) || {};
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'credentials',
      message: 'Where should OWL store Calendar credentials?',
      default: config.plugins?.calendar?.credentials || '~/.owl/credentials/calendar.json'
    },
    {
      type: 'number',
      name: 'windowDays',
      message: 'How many days ahead should OWL watch?',
      default: config.plugins?.calendar?.windowDays || 14
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
  console.log('\nOpening your browser for Google Calendar read-only consent...');
  await authorizeGoogle({
    clientId: answers.clientId,
    clientSecret: answers.clientSecret,
    scopes: [GOOGLE_SCOPES.calendar],
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

  config.plugins.calendar = {
    ...(config.plugins.calendar || {}),
    credentials: answers.credentials,
    windowDays: answers.windowDays,
    enabled: true
  };
  saveConfig(config, configPath);
  return config.plugins.calendar;
}
