import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureConfigFile, loadConfig, saveConfig } from '../config/index.js';
import { LLMConnection } from '../llm/connection.js';
import { startDetachedDaemon, readPid, isProcessRunning } from '../daemon/process.js';
import { installService } from '../daemon/service.js';
import { resolveTelegramChatId } from '../channels/telegram-setup.js';
import { GOOGLE_SCOPES, authorizeGoogle } from '../plugins/google-auth.js';

function applyFrequencyPreset(config, preset) {
  if (preset === 'light') {
    config.discovery.quickSchedule = '0 */12 * * *';
    config.discovery.deepSchedule = '0 */12 * * *';
  } else if (preset === 'intense') {
    config.discovery.quickSchedule = '*/15 * * * *';
    config.discovery.deepSchedule = '0 */3 * * *';
  } else {
    config.discovery.quickSchedule = '*/30 * * * *';
    config.discovery.deepSchedule = '0 */6 * * *';
  }
}

export async function runSetupWizard(configPath) {
  ensureConfigFile();
  const config = loadConfig(configPath);

  console.log(chalk.bold('\nOWL Setup\n'));

  const llmAnswers = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Which LLM do you want OWL to use?',
      choices: [
        { name: 'Claude (Anthropic API)', value: 'anthropic' },
        { name: 'ChatGPT / OpenAI', value: 'openai-compatible' },
        { name: 'Ollama (local)', value: 'openai-compatible' },
        { name: 'Other OpenAI-compatible endpoint', value: 'openai-compatible' }
      ],
      default: config.llm.provider
    },
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Base URL:',
      default: config.llm.baseUrl
    },
    {
      type: 'input',
      name: 'model',
      message: 'Model name:',
      default: config.llm.model
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'API key (leave blank for local models):',
      mask: '*',
      default: config.llm.apiKey
    }
  ]);

  config.llm = { ...config.llm, ...llmAnswers };

  const spinner = ora('Testing LLM connection...').start();
  try {
    const llm = new LLMConnection(config.llm, { costLogPath: config.paths.costLogPath });
    await llm.testConnection();
    spinner.succeed(`Connected to ${config.llm.model}`);
  } catch (error) {
    spinner.warn(`LLM test skipped or failed: ${error.message}`);
  }

  const sources = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'plugins',
      message: 'Which data sources do you want to connect?',
      choices: [
        { name: 'Gmail', value: 'gmail' },
        { name: 'Google Calendar', value: 'calendar' },
        { name: 'Slack (watch channels)', value: 'slack' },
        { name: 'Shopify', value: 'shopify' },
        { name: 'GitHub', value: 'github' },
        { name: 'Local Files', value: 'files' },
        { name: 'Mock (for testing)', value: 'mock' }
      ]
    }
  ]);

  for (const plugin of ['gmail', 'calendar', 'slack', 'shopify', 'github', 'files', 'mock']) {
    config.plugins[plugin] = {
      ...(config.plugins[plugin] || {}),
      enabled: sources.plugins.includes(plugin)
    };
  }

  if (sources.plugins.includes('gmail') || sources.plugins.includes('calendar')) {
    const googleAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'credentials',
        message: 'Where should OWL store Google credentials?',
        default:
          config.plugins.gmail.credentials ||
          config.plugins.calendar.credentials ||
          '~/.owl/credentials/google.json'
      },
      ...(sources.plugins.includes('gmail')
        ? [
            {
              type: 'list',
              name: 'emailDetailLevel',
              message: 'Email detail level to store locally:',
              choices: ['minimal', 'standard', 'full'],
              default: config.plugins.gmail.emailDetailLevel || 'standard'
            }
          ]
        : []),
      ...(sources.plugins.includes('calendar')
        ? [
            {
              type: 'number',
              name: 'windowDays',
              message: 'How many days ahead should OWL watch?',
              default: config.plugins.calendar.windowDays || 14
            }
          ]
        : []),
      {
        type: 'input',
        name: 'clientId',
        message: 'Google OAuth client ID:'
      },
      {
        type: 'password',
        name: 'clientSecret',
        message: 'Google OAuth client secret:',
        mask: '*'
      }
    ]);

    const scopes = [
      ...(sources.plugins.includes('gmail') ? [GOOGLE_SCOPES.gmail] : []),
      ...(sources.plugins.includes('calendar') ? [GOOGLE_SCOPES.calendar] : [])
    ];
    const googleSpinner = ora('Waiting for Google OAuth consent...').start();

    try {
      await authorizeGoogle({
        clientId: googleAnswers.clientId,
        clientSecret: googleAnswers.clientSecret,
        scopes,
        credentialsPath: googleAnswers.credentials,
        onPending({ authorizationUrl, browserOpened }) {
          googleSpinner.text = browserOpened
            ? 'Browser opened for Google consent. Finish the flow to continue...'
            : 'Open the Google consent URL printed below to continue...';
          console.log(`\n${authorizationUrl}\n`);
        }
      });
      googleSpinner.succeed('Google account connected');
    } catch (error) {
      googleSpinner.fail(`Google setup failed: ${error.message}`);
      throw error;
    }

    if (sources.plugins.includes('gmail')) {
      config.plugins.gmail = {
        ...config.plugins.gmail,
        credentials: googleAnswers.credentials,
        emailDetailLevel: googleAnswers.emailDetailLevel || config.plugins.gmail.emailDetailLevel || 'standard',
        enabled: true
      };
    }

    if (sources.plugins.includes('calendar')) {
      config.plugins.calendar = {
        ...config.plugins.calendar,
        credentials: googleAnswers.credentials,
        windowDays: googleAnswers.windowDays || config.plugins.calendar.windowDays || 14,
        enabled: true
      };
    }
  }

  if (sources.plugins.includes('shopify')) {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'shopDomain',
        message: 'Shopify store URL:',
        default: config.plugins.shopify.shopDomain || ''
      },
      {
        type: 'password',
        name: 'accessToken',
        message: 'Shopify API token:',
        mask: '*'
      }
    ]);
    config.plugins.shopify = { ...config.plugins.shopify, ...answers, enabled: true };
  }

  if (sources.plugins.includes('github')) {
    const answers = await inquirer.prompt([
      {
        type: 'password',
        name: 'token',
        message: 'GitHub token:',
        mask: '*'
      },
      {
        type: 'input',
        name: 'owner',
        message: 'GitHub username or org (optional):',
        default: config.plugins.github.owner || ''
      }
    ]);
    config.plugins.github = { ...config.plugins.github, ...answers, enabled: true };
  }

  if (sources.plugins.includes('slack')) {
    const answers = await inquirer.prompt([
      {
        type: 'password',
        name: 'botToken',
        message: 'Slack bot token (xoxb-...):',
        mask: '*'
      },
      {
        type: 'input',
        name: 'channels',
        message: 'Slack channels to watch (comma-separated):',
        default: (config.plugins.slack?.channels || []).join(', ')
      }
    ]);
    config.plugins.slack = {
      ...config.plugins.slack,
      botToken: answers.botToken,
      channels: answers.channels.split(',').map((ch) => ch.trim()).filter(Boolean),
      enabled: true
    };
  }

  if (sources.plugins.includes('files')) {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'paths',
        message: 'Directories to watch (comma-separated):',
        default: (config.plugins.files.paths || []).join(', ')
      }
    ]);
    config.plugins.files = {
      ...config.plugins.files,
      enabled: true,
      paths: answers.paths.split(',').map((item) => item.trim()).filter(Boolean)
    };
  }

  const channelAnswers = await inquirer.prompt([
    {
      type: 'list',
      name: 'channel',
      message: 'How should OWL reach you?',
      choices: [
        { name: 'Telegram', value: 'telegram' },
        { name: 'Slack', value: 'slack' },
        { name: 'Discord', value: 'discord' },
        { name: 'Email digest', value: 'email-digest' },
        { name: 'Webhook (custom URL)', value: 'webhook' },
        { name: 'WhatsApp (Business API)', value: 'whatsapp' },
        { name: 'RSS/Atom feed (local file)', value: 'rss' },
        { name: 'CLI', value: 'cli' }
      ],
      default: 'cli'
    }
  ]);

  for (const channel of Object.keys(config.channels || {})) {
    config.channels[channel].enabled = false;
  }
  config.channels.cli.enabled = channelAnswers.channel === 'cli';

  if (channelAnswers.channel === 'telegram') {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'botToken',
        message: 'Telegram bot token:',
        default: config.channels.telegram?.botToken || ''
      }
    ]);

    console.log('\nSend /start to your Telegram bot from the chat where you want OWL discoveries.');
    await inquirer.prompt([
      {
        type: 'input',
        name: 'ready',
        message: 'After you send /start, press Enter so OWL can detect the chat automatically:'
      }
    ]);

    let chatId = null;
    const telegramSpinner = ora('Looking for your Telegram chat...').start();
    try {
      chatId = await resolveTelegramChatId(answers.botToken);
      if (!chatId) {
        throw new Error('No private Telegram chat found yet');
      }
      telegramSpinner.succeed(`Telegram connected to chat ${chatId}`);
    } catch (error) {
      telegramSpinner.fail(`Automatic Telegram setup failed: ${error.message}`);
      const fallback = await inquirer.prompt([
        {
          type: 'input',
          name: 'chatId',
          message: 'Telegram chat ID (manual fallback):',
          default: config.channels.telegram?.chatId || ''
        }
      ]);
      chatId = fallback.chatId;
    }

    config.channels.telegram = {
      ...config.channels.telegram,
      botToken: answers.botToken,
      chatId,
      enabled: true
    };
  }

  if (channelAnswers.channel === 'slack') {
    const answers = await inquirer.prompt([
      { type: 'password', name: 'botToken', message: 'Slack bot token:', mask: '*' },
      { type: 'input', name: 'channel', message: 'Slack channel ID or name:' }
    ]);
    config.channels.slack = { ...config.channels.slack, ...answers, enabled: true };
  }

  if (channelAnswers.channel === 'discord') {
    const answers = await inquirer.prompt([
      { type: 'input', name: 'webhookUrl', message: 'Discord webhook URL:' }
    ]);
    config.channels.discord = { ...config.channels.discord, ...answers, enabled: true };
  }

  if (channelAnswers.channel === 'email-digest') {
    const answers = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: 'Resend API key:', mask: '*' },
      { type: 'input', name: 'from', message: 'From email address:' },
      { type: 'input', name: 'to', message: 'Destination email address:' }
    ]);
    config.channels['email-digest'] = {
      ...config.channels['email-digest'],
      ...answers,
      enabled: true
    };
  }

  if (channelAnswers.channel === 'webhook') {
    const answers = await inquirer.prompt([
      { type: 'input', name: 'url', message: 'Webhook URL:' },
      { type: 'password', name: 'secret', message: 'Webhook secret (optional):', mask: '*' }
    ]);
    config.channels.webhook = {
      ...config.channels.webhook,
      ...answers,
      enabled: true
    };
  }

  if (channelAnswers.channel === 'whatsapp') {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'phoneNumberId',
        message: 'WhatsApp Business phone number ID:',
        default: config.channels.whatsapp?.phoneNumberId || ''
      },
      {
        type: 'password',
        name: 'accessToken',
        message: 'Meta Cloud API access token:',
        mask: '*'
      },
      {
        type: 'input',
        name: 'recipientPhone',
        message: 'Your WhatsApp phone number (with country code, e.g., 1234567890):',
        default: config.channels.whatsapp?.recipientPhone || ''
      }
    ]);
    config.channels.whatsapp = {
      ...config.channels.whatsapp,
      ...answers,
      enabled: true
    };
  }

  if (channelAnswers.channel === 'rss') {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'feedPath',
        message: 'Path for the Atom feed file:',
        default: config.channels.rss?.feedPath || '~/.owl/discoveries.atom'
      },
      {
        type: 'input',
        name: 'title',
        message: 'Feed title:',
        default: config.channels.rss?.title || 'OWL Discoveries'
      }
    ]);
    config.channels.rss = {
      ...config.channels.rss,
      ...answers,
      enabled: true
    };
  }

  if (channelAnswers.channel === 'cli') {
    config.channels.cli.enabled = true;
  }

  const preferenceAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Your name (for personalized discoveries):',
      default: config.user.name || ''
    },
    {
      type: 'list',
      name: 'frequency',
      message: 'Discovery frequency:',
      choices: [
        { name: 'Normal', value: 'normal' },
        { name: 'Light', value: 'light' },
        { name: 'Intense', value: 'intense' }
      ],
      default: 'normal'
    },
    {
      type: 'confirm',
      name: 'installService',
      message: 'Keep OWL running after reboots by installing an OS background service?',
      default: true
    }
  ]);

  config.user.name = preferenceAnswers.name;
  applyFrequencyPreset(config, preferenceAnswers.frequency);
  saveConfig(config, configPath);

  console.log(chalk.green('\nOWL is set up.'));

  const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../daemon/index.js');
  const existingPid = readPid(config.paths.pidPath);
  if (!isProcessRunning(existingPid)) {
    const pid = startDetachedDaemon({
      scriptPath,
      pidPath: config.paths.pidPath,
      configPath: config.paths.configPath
    });
    console.log(`Started OWL daemon in the background (pid ${pid}).`);
  } else {
    console.log(`OWL daemon is already running (pid ${existingPid}).`);
  }

  if (preferenceAnswers.installService) {
    try {
      const result = installService({
        scriptPath,
        configPath: config.paths.configPath,
        logPath: config.paths.logPath
      });
      console.log(
        `Installed OWL ${result.mechanism} service${result.path ? ` at ${result.path}` : ` (${result.name})`}.`
      );
    } catch (error) {
      console.log(chalk.yellow(`Could not install the background service automatically: ${error.message}`));
      console.log("You can install it later with 'owl service install'.");
    }
  }
}
