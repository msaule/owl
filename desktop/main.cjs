// Remove ELECTRON_RUN_AS_NODE for child processes (VS Code terminals set this).
// Note: Must be unset BEFORE launching electron.exe — see electron:dev script.
delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog } = require('electron');

if (!app) {
  console.error('ERROR: Electron app module not available.');
  console.error('If running from VS Code terminal, use: npm run electron:dev');
  console.error('Or unset ELECTRON_RUN_AS_NODE before running.');
  process.exit(1);
}
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');

// ─── Paths ───
const OWL_HOME = process.env.OWL_HOME || path.join(os.homedir(), '.owl');
const CONFIG_PATH = path.join(OWL_HOME, 'config.json');
const DB_PATH = path.join(OWL_HOME, 'world.db');
const PID_PATH = path.join(OWL_HOME, 'owl.pid');
const LOG_PATH = path.join(OWL_HOME, 'logs', 'owl.log');

const ROOT = path.resolve(__dirname, '..');
const DAEMON_SCRIPT = path.join(ROOT, 'src', 'daemon', 'index.js');
const DASHBOARD_PORT = 3737; // Use non-standard port to avoid conflicts
const ICON_PATH = path.join(__dirname, 'icon.png');

// Use system Node.js for child processes to avoid native module version mismatches.
// Electron's embedded Node.js has a different ABI than the system Node.js that compiled
// native modules like better-sqlite3.
const NODE_BIN = process.platform === 'win32' ? 'node.exe' : 'node';

let mainWindow = null;
let setupWindow = null;
let tray = null;
let daemonProcess = null;
let dashboardProcess = null;
let isQuitting = false;

// ─── Ensure OWL home directory exists ───
function ensureOwlHome() {
  const dirs = [OWL_HOME, path.join(OWL_HOME, 'logs'), path.join(OWL_HOME, 'credentials')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function configExists() {
  return fs.existsSync(CONFIG_PATH);
}

// ─── Dashboard server (runs in a child process) ───
function startDashboard() {
  if (dashboardProcess) return;

  // We use a small inline script to start the dashboard
  const script = `
    import('file:///${ROOT.replace(/\\/g, '/')}/src/dashboard/server.js')
      .then(m => m.startDashboard({ port: ${DASHBOARD_PORT} }))
      .catch(e => { console.error(e); process.exit(1); });
  `;

  dashboardProcess = spawn(NODE_BIN, ['--input-type=module', '-e', script], {
    env: { ...process.env, OWL_HOME },
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: ROOT
  });

  dashboardProcess.stdout.on('data', (d) => console.log('[dashboard]', d.toString().trim()));
  dashboardProcess.stderr.on('data', (d) => console.error('[dashboard]', d.toString().trim()));
  dashboardProcess.on('exit', (code) => {
    console.log(`Dashboard exited with code ${code}`);
    dashboardProcess = null;
  });
}

function stopDashboard() {
  if (dashboardProcess) {
    dashboardProcess.kill('SIGTERM');
    dashboardProcess = null;
  }
}

// ─── Daemon management ───
function startDaemon() {
  if (daemonProcess) return;

  daemonProcess = spawn(NODE_BIN, [DAEMON_SCRIPT, '--config', CONFIG_PATH], {
    env: { ...process.env, OWL_HOME },
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: ROOT
  });

  daemonProcess.stdout.on('data', (d) => console.log('[daemon]', d.toString().trim()));
  daemonProcess.stderr.on('data', (d) => console.error('[daemon]', d.toString().trim()));
  daemonProcess.on('exit', (code) => {
    console.log(`Daemon exited with code ${code}`);
    daemonProcess = null;
    // Auto-restart if not quitting
    if (!isQuitting && configExists()) {
      setTimeout(() => startDaemon(), 3000);
    }
  });

  // Write PID
  try { fs.writeFileSync(PID_PATH, String(daemonProcess.pid)); } catch {}
}

function stopDaemon() {
  if (daemonProcess) {
    daemonProcess.kill('SIGTERM');
    daemonProcess = null;
  }
  try { fs.unlinkSync(PID_PATH); } catch {}
}

function isDaemonRunning() {
  return daemonProcess !== null && !daemonProcess.killed;
}

// ─── Wait for dashboard to be ready ───
function waitForDashboard(maxRetries = 30) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      http.get(`http://127.0.0.1:${DASHBOARD_PORT}/api/stats`, (res) => {
        if (res.statusCode === 200) resolve(true);
        else if (++attempts < maxRetries) setTimeout(check, 300);
        else resolve(false);
      }).on('error', () => {
        if (++attempts < maxRetries) setTimeout(check, 300);
        else resolve(false);
      });
    };
    check();
  });
}

// ─── Fetch OWL stats for tray ───
async function fetchStats() {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${DASHBOARD_PORT}/api/stats`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// ─── Tray ───
function createTray() {
  const icon = fs.existsSync(ICON_PATH)
    ? nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('OWL — Your AI that never sleeps');

  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Periodically update tray tooltip with OWL Score
  setInterval(async () => {
    const stats = await fetchStats();
    if (stats?.score) {
      tray.setToolTip(`OWL Score: ${stats.score.total}/100 | ${stats.stats.entities} entities | ${stats.stats.discoveries} discoveries`);
    }
  }, 30000);
}

function updateTrayMenu() {
  const running = isDaemonRunning();
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open OWL Dashboard', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: `Daemon: ${running ? 'Running' : 'Stopped'}`, enabled: false },
    { label: running ? 'Stop Daemon' : 'Start Daemon', click: () => { running ? stopDaemon() : startDaemon(); updateTrayMenu(); } },
    { type: 'separator' },
    { label: 'Setup Wizard', click: () => openSetupWizard() },
    { label: 'Open Config Folder', click: () => shell.openPath(OWL_HOME) },
    { label: 'View Logs', click: () => { if (fs.existsSync(LOG_PATH)) shell.openPath(LOG_PATH); } },
    { type: 'separator' },
    { label: 'GitHub', click: () => shell.openExternal('https://github.com/msaule/owl') },
    { label: 'Quit OWL', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
}

// ─── Main Window (Dashboard) ───
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'OWL',
    backgroundColor: '#0a0a0f',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    show: false
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Remove default menu bar
  mainWindow.setMenuBarVisibility(false);

  return mainWindow;
}

// ─── Setup Wizard Window ───
function openSetupWizard() {
  if (setupWindow) {
    setupWindow.show();
    setupWindow.focus();
    return;
  }

  setupWindow = new BrowserWindow({
    width: 700,
    height: 650,
    resizable: false,
    title: 'OWL Setup',
    backgroundColor: '#0a0a0f',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  setupWindow.setMenuBarVisibility(false);

  // Serve the setup wizard HTML
  const setupHtml = getSetupHtml();
  setupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(setupHtml)}`);

  setupWindow.on('closed', async () => {
    setupWindow = null;
    // If config now exists, the user completed setup — launch everything
    if (configExists()) {
      if (!mainWindow) await launchDashboard();
      if (!isDaemonRunning()) startDaemon();
      updateTrayMenu();
    }
  });
}

// ─── Setup Wizard HTML ───
function getSetupHtml() {
  // Read current config if it exists
  let currentConfig = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      currentConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {}

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>OWL Setup</title>
<style>
  :root { --bg:#0a0a0f; --card:#12121a; --border:#1e1e2e; --text:#e0e0e8; --dim:#888; --accent:#FFB347; --green:#22C55E; --red:#EF4444; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:32px; }
  h1 { color:var(--accent); font-size:1.4rem; margin-bottom:4px; }
  .subtitle { color:var(--dim); font-size:0.85rem; margin-bottom:32px; }
  .step { display:none; }
  .step.active { display:block; }
  .step h2 { font-size:1rem; margin-bottom:16px; }
  label { display:block; font-size:0.85rem; color:var(--dim); margin-bottom:4px; margin-top:14px; }
  input, select { width:100%; padding:10px 12px; background:var(--card); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:0.9rem; outline:none; }
  input:focus, select:focus { border-color:var(--accent); }
  .checkbox-row { display:flex; align-items:center; gap:8px; margin-top:10px; }
  .checkbox-row input { width:auto; }
  .checkbox-row label { margin:0; }
  .btn-row { display:flex; gap:12px; margin-top:28px; }
  .btn { padding:10px 24px; border-radius:8px; font-size:0.9rem; cursor:pointer; border:none; font-weight:600; }
  .btn-primary { background:var(--accent); color:#000; }
  .btn-primary:hover { filter:brightness(1.1); }
  .btn-secondary { background:var(--card); color:var(--text); border:1px solid var(--border); }
  .btn-secondary:hover { border-color:var(--accent); }
  .progress { display:flex; gap:6px; margin-bottom:24px; }
  .progress-dot { width:8px; height:8px; border-radius:50%; background:var(--border); }
  .progress-dot.active { background:var(--accent); }
  .progress-dot.done { background:var(--green); }
  .status { margin-top:12px; padding:8px 12px; border-radius:6px; font-size:0.8rem; display:none; }
  .status.success { display:block; background:rgba(34,197,94,0.1); color:var(--green); border:1px solid rgba(34,197,94,0.2); }
  .status.error { display:block; background:rgba(239,68,68,0.1); color:var(--red); border:1px solid rgba(239,68,68,0.2); }
  .hint { font-size:0.75rem; color:var(--dim); margin-top:4px; }
  .plugin-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px; }
  .plugin-card { padding:12px; background:var(--card); border:1px solid var(--border); border-radius:8px; cursor:pointer; transition:border-color 0.15s; }
  .plugin-card:hover, .plugin-card.selected { border-color:var(--accent); }
  .plugin-card h4 { font-size:0.85rem; margin-bottom:2px; }
  .plugin-card p { font-size:0.7rem; color:var(--dim); }
</style>
</head>
<body>
<h1>OWL Setup</h1>
<p class="subtitle">Configure your AI that never sleeps</p>

<div class="progress" id="progress"></div>

<!-- Step 1: LLM -->
<div class="step active" id="step-1">
  <h2>1. LLM Connection</h2>
  <p style="color:var(--dim);font-size:0.85rem;margin-bottom:8px">OWL needs an LLM to analyze your data. Ollama is free and runs locally.</p>

  <label>Provider</label>
  <select id="llm-provider">
    <option value="openai-compatible" ${(currentConfig.llm?.provider !== 'anthropic') ? 'selected' : ''}>Ollama / OpenAI-compatible</option>
    <option value="anthropic" ${(currentConfig.llm?.provider === 'anthropic') ? 'selected' : ''}>Claude (Anthropic)</option>
  </select>

  <label>Base URL</label>
  <input id="llm-url" value="${currentConfig.llm?.baseUrl || 'http://localhost:11434/v1'}" placeholder="http://localhost:11434/v1">
  <p class="hint">Ollama default: http://localhost:11434/v1 | OpenAI: https://api.openai.com/v1</p>

  <label>Model</label>
  <input id="llm-model" value="${currentConfig.llm?.model || 'qwen2.5:14b-instruct'}" placeholder="qwen2.5:14b-instruct">

  <label>API Key (leave blank for Ollama)</label>
  <input id="llm-key" type="password" value="${currentConfig.llm?.apiKey || ''}" placeholder="sk-...">

  <div id="llm-status" class="status"></div>

  <div class="btn-row">
    <button class="btn btn-primary" onclick="testLlm()">Test Connection</button>
    <button class="btn btn-primary" onclick="goStep(2)">Next &rarr;</button>
  </div>
</div>

<!-- Step 2: Plugins -->
<div class="step" id="step-2">
  <h2>2. Data Sources</h2>
  <p style="color:var(--dim);font-size:0.85rem">Select which sources OWL should watch:</p>
  <div class="plugin-grid">
    <div class="plugin-card" data-plugin="gmail" onclick="togglePlugin(this)"><h4>Gmail</h4><p>Email monitoring</p></div>
    <div class="plugin-card" data-plugin="calendar" onclick="togglePlugin(this)"><h4>Calendar</h4><p>Google Calendar events</p></div>
    <div class="plugin-card" data-plugin="github" onclick="togglePlugin(this)"><h4>GitHub</h4><p>Repos, PRs, issues</p></div>
    <div class="plugin-card" data-plugin="slack" onclick="togglePlugin(this)"><h4>Slack</h4><p>Messages & mentions</p></div>
    <div class="plugin-card" data-plugin="shopify" onclick="togglePlugin(this)"><h4>Shopify</h4><p>Orders & fulfillment</p></div>
    <div class="plugin-card" data-plugin="files" onclick="togglePlugin(this)"><h4>Files</h4><p>Local file system</p></div>
  </div>
  <div class="btn-row">
    <button class="btn btn-secondary" onclick="goStep(1)">&larr; Back</button>
    <button class="btn btn-primary" onclick="goStep(3)">Next &rarr;</button>
  </div>
</div>

<!-- Step 3: Channel -->
<div class="step" id="step-3">
  <h2>3. Notification Channel</h2>
  <p style="color:var(--dim);font-size:0.85rem;margin-bottom:8px">How should OWL deliver discoveries? (Dashboard always works)</p>

  <label>Primary Channel</label>
  <select id="channel-type">
    <option value="cli">CLI / Dashboard only</option>
    <option value="telegram">Telegram</option>
    <option value="slack">Slack</option>
    <option value="discord">Discord</option>
    <option value="email-digest">Email Digest</option>
    <option value="webhook">Webhook</option>
  </select>

  <div id="channel-config"></div>

  <div class="btn-row">
    <button class="btn btn-secondary" onclick="goStep(2)">&larr; Back</button>
    <button class="btn btn-primary" onclick="goStep(4)">Next &rarr;</button>
  </div>
</div>

<!-- Step 4: User prefs & save -->
<div class="step" id="step-4">
  <h2>4. Your Details</h2>

  <label>Your Name</label>
  <input id="user-name" value="${currentConfig.user?.name || ''}" placeholder="Your name (used in discoveries)">

  <label>Scan Frequency</label>
  <select id="frequency">
    <option value="balanced">Balanced (every 30 min quick, 6h deep)</option>
    <option value="light">Light (every 12h)</option>
    <option value="intense">Intense (every 15 min quick, 3h deep)</option>
  </select>

  <div id="save-status" class="status"></div>

  <div class="btn-row">
    <button class="btn btn-secondary" onclick="goStep(3)">&larr; Back</button>
    <button class="btn btn-primary" onclick="saveConfig()">Save & Launch OWL</button>
  </div>
</div>

<script>
const STEPS = 4;
let currentStep = 1;
const selectedPlugins = new Set();

function updateProgress() {
  const el = document.getElementById('progress');
  el.innerHTML = '';
  for (let i = 1; i <= STEPS; i++) {
    const dot = document.createElement('div');
    dot.className = 'progress-dot' + (i === currentStep ? ' active' : '') + (i < currentStep ? ' done' : '');
    el.appendChild(dot);
  }
}
updateProgress();

function goStep(n) {
  document.getElementById('step-' + currentStep).classList.remove('active');
  currentStep = n;
  document.getElementById('step-' + currentStep).classList.add('active');
  updateProgress();
}

function togglePlugin(el) {
  const plugin = el.dataset.plugin;
  if (selectedPlugins.has(plugin)) {
    selectedPlugins.delete(plugin);
    el.classList.remove('selected');
  } else {
    selectedPlugins.add(plugin);
    el.classList.add('selected');
  }
}

async function testLlm() {
  const status = document.getElementById('llm-status');
  status.className = 'status';
  status.style.display = 'block';
  status.textContent = 'Testing...';
  status.style.color = 'var(--dim)';

  try {
    const baseUrl = document.getElementById('llm-url').value.replace(/\\/+$/, '');
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(document.getElementById('llm-key').value ? { 'Authorization': 'Bearer ' + document.getElementById('llm-key').value } : {})
      },
      body: JSON.stringify({
        model: document.getElementById('llm-model').value,
        messages: [{ role: 'user', content: 'Reply with just: ok' }],
        max_tokens: 10
      })
    });
    if (res.ok) {
      status.className = 'status success';
      status.textContent = 'Connected successfully!';
    } else {
      status.className = 'status error';
      status.textContent = 'Connection failed: HTTP ' + res.status;
    }
  } catch (e) {
    status.className = 'status error';
    status.textContent = 'Connection failed: ' + e.message;
  }
}

function getChannelHtml() {
  const type = document.getElementById('channel-type').value;
  if (type === 'cli') return '';
  if (type === 'telegram') return '<label>Bot Token</label><input id="ch-token" placeholder="123456:ABC-DEF..."><label>Chat ID</label><input id="ch-chatid" placeholder="Your Telegram chat ID">';
  if (type === 'slack') return '<label>Bot Token</label><input id="ch-token" placeholder="xoxb-..."><label>Channel</label><input id="ch-channel" placeholder="#owl-discoveries">';
  if (type === 'discord') return '<label>Webhook URL</label><input id="ch-webhook" placeholder="https://discord.com/api/webhooks/...">';
  if (type === 'email-digest') return '<label>API Key (Resend)</label><input id="ch-apikey" placeholder="re_..."><label>From</label><input id="ch-from" placeholder="owl@yourdomain.com"><label>To</label><input id="ch-to" placeholder="you@email.com">';
  if (type === 'webhook') return '<label>URL</label><input id="ch-webhook" placeholder="https://...">';
  return '';
}

document.getElementById('channel-type').addEventListener('change', () => {
  document.getElementById('channel-config').innerHTML = getChannelHtml();
});

function buildConfig() {
  const freq = document.getElementById('frequency').value;
  const schedules = {
    balanced: { quick: '*/30 * * * *', deep: '0 */6 * * *' },
    light: { quick: '0 */12 * * *', deep: '0 */12 * * *' },
    intense: { quick: '*/15 * * * *', deep: '0 */3 * * *' }
  }[freq];

  const config = {
    user: { name: document.getElementById('user-name').value },
    llm: {
      provider: document.getElementById('llm-provider').value,
      baseUrl: document.getElementById('llm-url').value,
      model: document.getElementById('llm-model').value,
      apiKey: document.getElementById('llm-key').value,
      detailLevel: 'standard',
      pricing: { inputPer1k: 0, outputPer1k: 0 }
    },
    discovery: {
      quickSchedule: schedules.quick,
      deepSchedule: schedules.deep,
      dailySchedule: '0 7 * * *',
      maxDiscoveriesPerDay: 5,
      maxDiscoveriesPerRun: 3,
      minConfidence: 0.6,
      importanceThreshold: 'medium'
    },
    plugins: {},
    channels: { cli: { enabled: true } }
  };

  for (const p of selectedPlugins) {
    config.plugins[p] = { enabled: true };
  }

  // Channel config
  const chType = document.getElementById('channel-type').value;
  if (chType === 'telegram') {
    config.channels.telegram = { enabled: true, botToken: document.getElementById('ch-token')?.value || '', chatId: document.getElementById('ch-chatid')?.value || '' };
  } else if (chType === 'slack') {
    config.channels.slack = { enabled: true, botToken: document.getElementById('ch-token')?.value || '', channel: document.getElementById('ch-channel')?.value || '' };
  } else if (chType === 'discord') {
    config.channels.discord = { enabled: true, webhookUrl: document.getElementById('ch-webhook')?.value || '' };
  } else if (chType === 'email-digest') {
    config.channels['email-digest'] = { enabled: true, provider: 'resend', apiKey: document.getElementById('ch-apikey')?.value || '', from: document.getElementById('ch-from')?.value || '', to: document.getElementById('ch-to')?.value || '' };
  } else if (chType === 'webhook') {
    config.channels.webhook = { enabled: true, url: document.getElementById('ch-webhook')?.value || '' };
  }

  return config;
}

async function saveConfig() {
  const config = buildConfig();
  const status = document.getElementById('save-status');

  // We need to communicate back to the main process
  // Since we don't have preload/IPC, we POST to the dashboard API
  // Actually, we'll use a special save endpoint
  try {
    const res = await fetch('http://127.0.0.1:${DASHBOARD_PORT}/api/save-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    if (res.ok) {
      status.className = 'status success';
      status.textContent = 'Configuration saved! OWL is starting...';
      setTimeout(() => window.close(), 2000);
    } else {
      status.className = 'status error';
      status.textContent = 'Failed to save configuration.';
    }
  } catch (e) {
    // Fallback: write directly using a data URL trick won't work.
    // Just show instructions
    status.className = 'status error';
    status.textContent = 'Save the config manually to ${CONFIG_PATH.replace(/\\/g, '/')}';
  }
}
<\/script>
</body></html>`;
}

// ─── Single instance lock ───
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ─── Launch dashboard + main window once dashboard is ready ───
async function launchDashboard() {
  const win = createMainWindow();
  const ready = await waitForDashboard();

  if (ready) {
    win.loadURL(`http://127.0.0.1:${DASHBOARD_PORT}`);
  } else {
    win.loadURL(`data:text/html,<html><body style="background:#0a0a0f;color:#e0e0e8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h2 style="color:#FFB347">OWL</h2><p>Dashboard is starting...</p><p style="color:#888;font-size:0.8rem">If this persists, check your configuration.</p></div></body></html>`);
  }

  win.show();
}

// ─── App lifecycle ───
app.on('ready', async () => {
  if (!gotLock) return;

  ensureOwlHome();
  createTray();
  startDashboard();

  const needsSetup = !configExists();

  if (needsSetup) {
    openSetupWizard();
    // After setup wizard closes, start daemon and show dashboard
  } else {
    await launchDashboard();
    startDaemon();
  }
});

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
  if (process.platform !== 'darwin') {
    // On Windows/Linux, keep alive via tray
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopDaemon();
  stopDashboard();
});
