// ─── OWL Desktop — Your AI that never sleeps ───
// Electron main process: frameless window, system tray, native notifications,
// global hotkey, window state persistence, discovery polling, deep links.

delete process.env.ELECTRON_RUN_AS_NODE;

const {
  app, BrowserWindow, Tray, Menu, nativeImage, shell,
  globalShortcut, Notification, ipcMain, screen, protocol
} = require('electron');

if (!app) {
  console.error('Electron app module not available. Run: npm run electron:dev');
  process.exit(1);
}

const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');

// ─── Constants ───
const OWL_HOME = process.env.OWL_HOME || path.join(os.homedir(), '.owl');
const CONFIG_PATH = path.join(OWL_HOME, 'config.json');
const PID_PATH = path.join(OWL_HOME, 'owl.pid');
const LOG_PATH = path.join(OWL_HOME, 'logs', 'owl.log');
const WINDOW_STATE_PATH = path.join(OWL_HOME, 'window-state.json');
const ROOT = path.resolve(__dirname, '..');
const DAEMON_SCRIPT = path.join(ROOT, 'src', 'daemon', 'index.js');
const DASHBOARD_PORT = 3737;
const ICON_PATH = path.join(__dirname, 'icon.png');
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');
const NODE_BIN = process.platform === 'win32' ? 'node.exe' : 'node';
const IS_MAC = process.platform === 'darwin';
const GLOBAL_HOTKEY = IS_MAC ? 'CommandOrControl+Shift+O' : 'Ctrl+Shift+O';

// ─── State ───
let mainWindow = null;
let setupWindow = null;
let tray = null;
let daemonProcess = null;
let dashboardProcess = null;
let isQuitting = false;
let lastDiscoveryTimestamp = null;
let recentDiscoveries = [];
let currentScore = null;
let discoveryPollTimer = null;
let trayUpdateTimer = null;

// ─── Single instance ───
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

app.on('second-instance', () => showMainWindow());

// ─── Filesystem helpers ───
function ensureOwlHome() {
  for (const dir of [OWL_HOME, path.join(OWL_HOME, 'logs'), path.join(OWL_HOME, 'credentials')]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function configExists() {
  return fs.existsSync(CONFIG_PATH);
}

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJson(p, data) {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch {}
}

// ─── Window state persistence ───
function loadWindowState() {
  const defaults = { width: 1280, height: 820, x: undefined, y: undefined, maximized: false };
  const saved = readJson(WINDOW_STATE_PATH);
  if (!saved) return defaults;

  // Validate saved position is still on a visible display
  const displays = screen.getAllDisplays();
  const visible = displays.some(d => {
    const b = d.bounds;
    return saved.x >= b.x && saved.x < b.x + b.width &&
           saved.y >= b.y && saved.y < b.y + b.height;
  });

  return {
    width: saved.width || defaults.width,
    height: saved.height || defaults.height,
    x: visible ? saved.x : undefined,
    y: visible ? saved.y : undefined,
    maximized: saved.maximized || false
  };
}

function saveWindowState() {
  if (!mainWindow) return;
  const isMax = mainWindow.isMaximized();
  const bounds = isMax ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  writeJson(WINDOW_STATE_PATH, { ...bounds, maximized: isMax });
}

// ─── HTTP helpers ───
function httpGet(urlPath) {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${DASHBOARD_PORT}${urlPath}`, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function waitForDashboard(maxRetries = 40) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      http.get(`http://127.0.0.1:${DASHBOARD_PORT}/api/stats`, (res) => {
        if (res.statusCode === 200) resolve(true);
        else if (++attempts < maxRetries) setTimeout(check, 250);
        else resolve(false);
      }).on('error', () => {
        if (++attempts < maxRetries) setTimeout(check, 250);
        else resolve(false);
      });
    };
    check();
  });
}

// ─── Dashboard server (child process) ───
function startDashboard() {
  if (dashboardProcess) return;

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
    console.log(`Dashboard exited (${code})`);
    dashboardProcess = null;
    // Auto-restart if not quitting
    if (!isQuitting) {
      setTimeout(() => {
        startDashboard();
        // Reload main window once dashboard is back
        waitForDashboard().then((ok) => {
          if (ok && mainWindow) mainWindow.loadURL(`http://127.0.0.1:${DASHBOARD_PORT}`);
        });
      }, 2000);
    }
  });
}

function stopDashboard() {
  if (dashboardProcess) { dashboardProcess.kill('SIGTERM'); dashboardProcess = null; }
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
    console.log(`Daemon exited (${code})`);
    daemonProcess = null;
    if (!isQuitting && configExists()) {
      setTimeout(() => startDaemon(), 3000);
    }
  });

  try { fs.writeFileSync(PID_PATH, String(daemonProcess.pid)); } catch {}
}

function stopDaemon() {
  if (daemonProcess) { daemonProcess.kill('SIGTERM'); daemonProcess = null; }
  try { fs.unlinkSync(PID_PATH); } catch {}
}

function isDaemonRunning() {
  return daemonProcess !== null && !daemonProcess.killed;
}

// ─── Native Discovery Notifications ───
async function pollDiscoveries() {
  const data = await httpGet('/api/discoveries?days=1');
  if (!data || !Array.isArray(data)) return;

  const fresh = data.filter(d => !lastDiscoveryTimestamp || d.timestamp > lastDiscoveryTimestamp);

  if (fresh.length > 0 && lastDiscoveryTimestamp) {
    // Don't notify on first poll (app just started)
    for (const d of fresh.slice(0, 3)) {
      pushDiscoveryNotification(d);
    }
  }

  if (data.length > 0) {
    lastDiscoveryTimestamp = data[0].timestamp;
    recentDiscoveries = data.slice(0, 5);
    updateTrayMenu();
  }
}

function pushDiscoveryNotification(discovery) {
  if (!Notification.isSupported()) return;

  const urgencyEmoji = { urgent: '!!', important: '!', interesting: '' };
  const prefix = urgencyEmoji[discovery.urgency] || '';

  const n = new Notification({
    title: `OWL ${prefix ? '(' + prefix + ') ' : ''}${discovery.title}`,
    body: discovery.body?.slice(0, 200) || '',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    silent: discovery.urgency === 'interesting',
    urgency: discovery.urgency === 'urgent' ? 'critical' : 'normal'
  });

  n.on('click', () => {
    showMainWindow();
    // Navigate to discoveries view
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(
        `document.querySelector('[data-panel="discoveries"]')?.click?.();`
      ).catch(() => {});
    }
  });

  n.show();
}

// ─── Score + Stats Polling ───
async function pollStats() {
  const data = await httpGet('/api/stats');
  if (data?.score) {
    currentScore = data.score;
    if (tray) {
      const s = data.stats;
      tray.setToolTip(
        `OWL Score: ${data.score.total}/100\n` +
        `${s.entities} entities | ${s.discoveries} discoveries | ${s.events} events`
      );
    }
  }
}

// ─── Tray ───
function createTray() {
  const icon = fs.existsSync(ICON_PATH)
    ? nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('OWL — Starting...');
  updateTrayMenu();

  tray.on('click', () => showMainWindow());
}

function updateTrayMenu() {
  const running = isDaemonRunning();
  const scoreLabel = currentScore ? `OWL Score: ${currentScore.total}/100` : 'OWL Score: —';
  const launchAtStartup = app.getLoginItemSettings().openAtLogin;

  const discoveryItems = recentDiscoveries.slice(0, 3).map(d => ({
    label: `${d.urgency === 'urgent' ? '!! ' : d.urgency === 'important' ? '! ' : ''}${d.title}`.slice(0, 60),
    click: () => showMainWindow(),
    enabled: true
  }));

  const template = [
    { label: scoreLabel, enabled: false },
    { type: 'separator' },
    { label: 'Open OWL', click: () => showMainWindow(), accelerator: GLOBAL_HOTKEY },
    { type: 'separator' },

    // Recent discoveries section
    ...(discoveryItems.length > 0
      ? [{ label: 'Recent Discoveries', enabled: false }, ...discoveryItems, { type: 'separator' }]
      : []),

    // Daemon
    { label: `Daemon: ${running ? 'Running' : 'Stopped'}`, enabled: false },
    {
      label: running ? 'Stop Daemon' : 'Start Daemon',
      click: () => { running ? stopDaemon() : startDaemon(); updateTrayMenu(); }
    },
    { type: 'separator' },

    // Actions
    { label: 'Setup Wizard...', click: () => openSetupWizard() },
    { label: 'Open Config Folder', click: () => shell.openPath(OWL_HOME) },
    { label: 'View Logs', click: () => { if (fs.existsSync(LOG_PATH)) shell.openPath(LOG_PATH); } },
    { type: 'separator' },

    // Preferences
    {
      label: 'Launch at Startup',
      type: 'checkbox',
      checked: launchAtStartup,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      }
    },
    { type: 'separator' },

    { label: 'GitHub', click: () => shell.openExternal('https://github.com/msaule/owl') },
    { label: `About OWL v${require(path.join(ROOT, 'package.json')).version}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit OWL', accelerator: IS_MAC ? 'Cmd+Q' : undefined, click: () => { isQuitting = true; app.quit(); } }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// ─── Splash screen HTML ───
function getSplashHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background:#0a0a0f; color:#e0e0e8;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    display:flex; align-items:center; justify-content:center; height:100vh;
    -webkit-app-region:drag; user-select:none; overflow:hidden;
  }
  .container { text-align:center; }
  .owl-face { position:relative; width:120px; height:100px; margin:0 auto 24px; }

  .eye {
    position:absolute; top:20px; width:36px; height:36px; border-radius:50%;
    background:radial-gradient(circle at 60% 40%, #FFE4B5 0%, #FFB347 40%, #E8850C 100%);
    box-shadow: 0 0 20px rgba(255,179,71,0.4), 0 0 60px rgba(255,179,71,0.15);
    animation: blink 4s ease-in-out infinite;
  }
  .eye.left { left:18px; }
  .eye.right { right:18px; }
  .eye::after {
    content:''; position:absolute; top:30%; left:35%;
    width:12px; height:12px; border-radius:50%;
    background:radial-gradient(circle, #0a0a0f 60%, #1a1a2f 100%);
    animation: look 6s ease-in-out infinite;
  }
  .eye::before {
    content:''; position:absolute; top:22%; left:55%;
    width:5px; height:5px; border-radius:50%;
    background:rgba(255,255,255,0.7);
    z-index:1;
  }

  @keyframes blink {
    0%, 92%, 100% { transform:scaleY(1); }
    95% { transform:scaleY(0.05); }
  }
  @keyframes look {
    0%, 40% { transform:translateX(0); }
    50% { transform:translateX(3px); }
    70% { transform:translateX(-2px); }
    100% { transform:translateX(0); }
  }

  .glow {
    position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
    width:140px; height:140px; border-radius:50%;
    background:radial-gradient(circle, rgba(255,179,71,0.08) 0%, transparent 70%);
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { transform:translate(-50%,-50%) scale(1); opacity:0.5; }
    50% { transform:translate(-50%,-50%) scale(1.15); opacity:1; }
  }

  h1 { font-size:1.6rem; letter-spacing:0.15em; color:#FFB347; margin-bottom:6px; font-weight:700; }
  .tagline { color:#666; font-size:0.8rem; margin-bottom:28px; }
  .status {
    color:#555; font-size:0.75rem; letter-spacing:0.05em;
    animation: dots 1.5s steps(4) infinite;
  }
  @keyframes dots { 0% { content:''; } }
  .dots::after { content:'...'; animation: dotAnim 1.5s steps(4) infinite; }
  @keyframes dotAnim {
    0% { content:''; } 25% { content:'.'; } 50% { content:'..'; } 75% { content:'...'; }
  }
</style></head><body>
  <div class="container">
    <div class="owl-face">
      <div class="glow"></div>
      <div class="eye left"></div>
      <div class="eye right"></div>
    </div>
    <h1>OWL</h1>
    <p class="tagline">Your AI that never sleeps</p>
    <p class="status">Waking up<span class="dots"></span></p>
  </div>
</body></html>`;
}

// ─── Main Window ───
function createMainWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    title: 'OWL',
    frame: false,
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    titleBarOverlay: IS_MAC ? false : {
      color: '#0a0a0f',
      symbolColor: '#888',
      height: 36
    },
    backgroundColor: '#0a0a0f',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PRELOAD_PATH
    },
    show: false
  });

  if (state.maximized) mainWindow.maximize();

  // Save window state on move/resize
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  mainWindow.on('maximize', saveWindowState);
  mainWindow.on('unmaximize', saveWindowState);

  mainWindow.on('close', (e) => {
    saveWindowState();
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // No menu bar on Windows/Linux
  mainWindow.setMenuBarVisibility(false);

  return mainWindow;
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ─── Setup Wizard ───
function openSetupWizard() {
  if (setupWindow) { setupWindow.show(); setupWindow.focus(); return; }

  setupWindow = new BrowserWindow({
    width: 700,
    height: 680,
    resizable: false,
    title: 'OWL Setup',
    backgroundColor: '#0a0a0f',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PRELOAD_PATH
    }
  });

  setupWindow.setMenuBarVisibility(false);
  setupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getSetupHtml())}`);

  setupWindow.on('closed', async () => {
    setupWindow = null;
    if (configExists()) {
      if (!mainWindow || mainWindow.isDestroyed()) await launchMainWindow();
      else showMainWindow();
      if (!isDaemonRunning()) startDaemon();
      updateTrayMenu();
    }
  });
}

function getSetupHtml() {
  let cfg = {};
  try { if (fs.existsSync(CONFIG_PATH)) cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>OWL Setup</title>
<style>
  :root { --bg:#0a0a0f; --card:#12121a; --border:#1e1e2e; --text:#e0e0e8; --dim:#888; --accent:#FFB347; --green:#22C55E; --red:#EF4444; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:32px; }
  h1 { color:var(--accent); font-size:1.4rem; margin-bottom:4px; }
  .subtitle { color:var(--dim); font-size:0.85rem; margin-bottom:32px; }
  .step { display:none; opacity:0; transition:opacity 0.25s ease; }
  .step.active { display:block; opacity:1; }
  .step h2 { font-size:1rem; margin-bottom:16px; }
  label { display:block; font-size:0.85rem; color:var(--dim); margin-bottom:4px; margin-top:14px; }
  input, select { width:100%; padding:10px 12px; background:var(--card); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:0.9rem; outline:none; transition:border-color 0.2s; }
  input:focus, select:focus { border-color:var(--accent); }
  .btn-row { display:flex; gap:12px; margin-top:28px; }
  .btn { padding:10px 24px; border-radius:8px; font-size:0.9rem; cursor:pointer; border:none; font-weight:600; transition:all 0.15s; }
  .btn-primary { background:var(--accent); color:#000; }
  .btn-primary:hover { filter:brightness(1.1); transform:translateY(-1px); }
  .btn-secondary { background:var(--card); color:var(--text); border:1px solid var(--border); }
  .btn-secondary:hover { border-color:var(--accent); }
  .progress { display:flex; gap:6px; margin-bottom:24px; }
  .progress-dot { width:10px; height:10px; border-radius:50%; background:var(--border); transition:all 0.3s; }
  .progress-dot.active { background:var(--accent); box-shadow:0 0 8px rgba(255,179,71,0.4); }
  .progress-dot.done { background:var(--green); }
  .status { margin-top:12px; padding:8px 12px; border-radius:6px; font-size:0.8rem; display:none; }
  .status.success { display:block; background:rgba(34,197,94,0.1); color:var(--green); border:1px solid rgba(34,197,94,0.2); }
  .status.error { display:block; background:rgba(239,68,68,0.1); color:var(--red); border:1px solid rgba(239,68,68,0.2); }
  .hint { font-size:0.75rem; color:var(--dim); margin-top:4px; }
  .plugin-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px; }
  .plugin-card { padding:12px; background:var(--card); border:1px solid var(--border); border-radius:8px; cursor:pointer; transition:all 0.15s; }
  .plugin-card:hover { border-color:var(--accent); transform:translateY(-1px); }
  .plugin-card.selected { border-color:var(--accent); background:rgba(255,179,71,0.05); }
  .plugin-card h4 { font-size:0.85rem; margin-bottom:2px; }
  .plugin-card p { font-size:0.7rem; color:var(--dim); }
  .completion { text-align:center; padding-top:60px; }
  .completion h2 { color:var(--accent); font-size:1.3rem; margin-bottom:12px; }
  .completion .checkmark { font-size:3rem; margin-bottom:16px; }
</style>
</head><body>
<h1>OWL Setup</h1>
<p class="subtitle">Configure your AI that never sleeps</p>
<div class="progress" id="progress"></div>

<div class="step active" id="step-1">
  <h2>1. LLM Connection</h2>
  <p style="color:var(--dim);font-size:0.85rem;margin-bottom:8px">OWL needs an LLM to analyze your data. Ollama is free and runs locally.</p>
  <label>Provider</label>
  <select id="llm-provider">
    <option value="openai-compatible" ${cfg.llm?.provider !== 'anthropic' ? 'selected' : ''}>Ollama / OpenAI-compatible</option>
    <option value="anthropic" ${cfg.llm?.provider === 'anthropic' ? 'selected' : ''}>Claude (Anthropic)</option>
  </select>
  <label>Base URL</label>
  <input id="llm-url" value="${cfg.llm?.baseUrl || 'http://localhost:11434/v1'}" placeholder="http://localhost:11434/v1">
  <p class="hint">Ollama default: http://localhost:11434/v1 &mdash; OpenAI: https://api.openai.com/v1</p>
  <label>Model</label>
  <input id="llm-model" value="${cfg.llm?.model || 'qwen2.5:14b-instruct'}" placeholder="qwen2.5:14b-instruct">
  <label>API Key (leave blank for Ollama)</label>
  <input id="llm-key" type="password" value="${cfg.llm?.apiKey || ''}" placeholder="sk-...">
  <div id="llm-status" class="status"></div>
  <div class="btn-row">
    <button class="btn btn-secondary" onclick="testLlm()">Test Connection</button>
    <button class="btn btn-primary" onclick="goStep(2)">Next &rarr;</button>
  </div>
</div>

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

<div class="step" id="step-3">
  <h2>3. Notification Channel</h2>
  <p style="color:var(--dim);font-size:0.85rem;margin-bottom:8px">How should OWL deliver discoveries? (Desktop notifications always work)</p>
  <label>Additional Channel</label>
  <select id="channel-type">
    <option value="cli">Desktop notifications only</option>
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

<div class="step" id="step-4">
  <h2>4. Your Details</h2>
  <label>Your Name</label>
  <input id="user-name" value="${cfg.user?.name || ''}" placeholder="Your name (used in discoveries)">
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
const STEPS=4;let currentStep=1;const selectedPlugins=new Set();
function updateProgress(){const el=document.getElementById('progress');el.innerHTML='';for(let i=1;i<=STEPS;i++){const d=document.createElement('div');d.className='progress-dot'+(i===currentStep?' active':'')+(i<currentStep?' done':'');el.appendChild(d)}}
updateProgress();
function goStep(n){const old=document.getElementById('step-'+currentStep);old.style.opacity='0';setTimeout(()=>{old.classList.remove('active');currentStep=n;const nw=document.getElementById('step-'+n);nw.classList.add('active');requestAnimationFrame(()=>nw.style.opacity='1');updateProgress()},150)}
function togglePlugin(el){const p=el.dataset.plugin;selectedPlugins.has(p)?(selectedPlugins.delete(p),el.classList.remove('selected')):(selectedPlugins.add(p),el.classList.add('selected'))}
async function testLlm(){const s=document.getElementById('llm-status');s.className='status';s.style.display='block';s.textContent='Testing...';s.style.color='var(--dim)';try{const u=document.getElementById('llm-url').value.replace(/\\/+$/,'');const r=await fetch(u+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',...(document.getElementById('llm-key').value?{'Authorization':'Bearer '+document.getElementById('llm-key').value}:{})},body:JSON.stringify({model:document.getElementById('llm-model').value,messages:[{role:'user',content:'Reply ok'}],max_tokens:10})});s.className=r.ok?'status success':'status error';s.textContent=r.ok?'Connected successfully!':'Failed: HTTP '+r.status}catch(e){s.className='status error';s.textContent='Failed: '+e.message}}
function getChannelHtml(){const t=document.getElementById('channel-type').value;if(t==='cli')return'';if(t==='telegram')return'<label>Bot Token</label><input id="ch-token" placeholder="123456:ABC-DEF..."><label>Chat ID</label><input id="ch-chatid" placeholder="Chat ID">';if(t==='slack')return'<label>Bot Token</label><input id="ch-token" placeholder="xoxb-..."><label>Channel</label><input id="ch-channel" placeholder="#owl-discoveries">';if(t==='discord')return'<label>Webhook URL</label><input id="ch-webhook" placeholder="https://discord.com/api/webhooks/...">';if(t==='email-digest')return'<label>API Key (Resend)</label><input id="ch-apikey" placeholder="re_..."><label>From</label><input id="ch-from" placeholder="owl@yourdomain.com"><label>To</label><input id="ch-to" placeholder="you@email.com">';if(t==='webhook')return'<label>URL</label><input id="ch-webhook" placeholder="https://...">';return''}
document.getElementById('channel-type').addEventListener('change',()=>{document.getElementById('channel-config').innerHTML=getChannelHtml()});
function buildConfig(){const f=document.getElementById('frequency').value;const s={balanced:{q:'*/30 * * * *',d:'0 */6 * * *'},light:{q:'0 */12 * * *',d:'0 */12 * * *'},intense:{q:'*/15 * * * *',d:'0 */3 * * *'}}[f];const c={user:{name:document.getElementById('user-name').value},llm:{provider:document.getElementById('llm-provider').value,baseUrl:document.getElementById('llm-url').value,model:document.getElementById('llm-model').value,apiKey:document.getElementById('llm-key').value,detailLevel:'standard',pricing:{inputPer1k:0,outputPer1k:0}},discovery:{quickSchedule:s.q,deepSchedule:s.d,dailySchedule:'0 7 * * *',maxDiscoveriesPerDay:5,maxDiscoveriesPerRun:3,minConfidence:0.6,importanceThreshold:'medium'},plugins:{},channels:{cli:{enabled:true}}};for(const p of selectedPlugins)c.plugins[p]={enabled:true};const ch=document.getElementById('channel-type').value;if(ch==='telegram')c.channels.telegram={enabled:true,botToken:document.getElementById('ch-token')?.value||'',chatId:document.getElementById('ch-chatid')?.value||''};else if(ch==='slack')c.channels.slack={enabled:true,botToken:document.getElementById('ch-token')?.value||'',channel:document.getElementById('ch-channel')?.value||''};else if(ch==='discord')c.channels.discord={enabled:true,webhookUrl:document.getElementById('ch-webhook')?.value||''};else if(ch==='email-digest')c.channels['email-digest']={enabled:true,provider:'resend',apiKey:document.getElementById('ch-apikey')?.value||'',from:document.getElementById('ch-from')?.value||'',to:document.getElementById('ch-to')?.value||''};else if(ch==='webhook')c.channels.webhook={enabled:true,url:document.getElementById('ch-webhook')?.value||''};return c}
async function saveConfig(){const c=buildConfig();const s=document.getElementById('save-status');try{const r=await fetch('http://127.0.0.1:${DASHBOARD_PORT}/api/save-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(c)});if(r.ok){s.className='status success';s.textContent='Configuration saved! OWL is starting...';setTimeout(()=>window.close(),1500)}else{s.className='status error';s.textContent='Failed to save.'}}catch(e){s.className='status error';s.textContent='Could not reach dashboard. Save config manually to: ${CONFIG_PATH.replace(/\\/g, '/')}'}}
<\/script>
</body></html>`;
}

// ─── IPC Handlers ───
function setupIPC() {
  ipcMain.handle('owl:getVersion', () => require(path.join(ROOT, 'package.json')).version);
  ipcMain.handle('owl:getScore', () => currentScore);
  ipcMain.handle('owl:getPlatform', () => process.platform);
  ipcMain.handle('owl:isDaemonRunning', () => isDaemonRunning());
  ipcMain.handle('owl:toggleDaemon', () => { isDaemonRunning() ? stopDaemon() : startDaemon(); updateTrayMenu(); return isDaemonRunning(); });
  ipcMain.handle('owl:openSetup', () => openSetupWizard());
  ipcMain.handle('owl:minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.handle('owl:maximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.handle('owl:close', () => { if (mainWindow) mainWindow.hide(); });
  ipcMain.handle('owl:isMaximized', () => mainWindow?.isMaximized() ?? false);
}

// ─── Launch sequence ───
async function launchMainWindow() {
  const win = createMainWindow();

  // Show splash while waiting for dashboard
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getSplashHtml())}`);
  win.show();

  const ready = await waitForDashboard();

  if (ready) {
    win.loadURL(`http://127.0.0.1:${DASHBOARD_PORT}`);
  } else {
    // Dashboard not ready after retries — show error with retry
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html><html><head><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{background:#0a0a0f;color:#e0e0e8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;-webkit-app-region:drag}
      .c{text-align:center;-webkit-app-region:no-drag}
      h2{color:#FFB347;margin-bottom:8px}
      p{color:#888;font-size:0.85rem;margin-bottom:16px}
      button{padding:8px 20px;border:1px solid #FFB347;background:transparent;color:#FFB347;border-radius:6px;cursor:pointer;font-size:0.85rem}
      button:hover{background:rgba(255,179,71,0.1)}
    </style></head><body><div class="c"><h2>OWL</h2><p>Dashboard is taking longer than expected...</p>
    <button onclick="location.reload()">Retry</button></div></body></html>`)}`);
  }

  // Start polling once dashboard is up
  if (ready) {
    // Initial data fetch
    await pollStats();
    await pollDiscoveries();

    // Continuous polling
    discoveryPollTimer = setInterval(pollDiscoveries, 60000);
    trayUpdateTimer = setInterval(pollStats, 30000);
  }
}

// ─── App lifecycle ───
app.on('ready', async () => {
  if (!gotLock) return;

  ensureOwlHome();
  setupIPC();

  // Register owl:// protocol
  protocol.registerHttpProtocol('owl', (req) => {
    showMainWindow();
  });

  createTray();
  startDashboard();

  if (!configExists()) {
    openSetupWizard();
  } else {
    await launchMainWindow();
    startDaemon();
  }

  // Register global hotkey
  try {
    globalShortcut.register(GLOBAL_HOTKEY, () => {
      if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        showMainWindow();
      }
    });
  } catch (e) {
    console.warn('Could not register global shortcut:', e.message);
  }
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('activate', () => showMainWindow());

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearInterval(discoveryPollTimer);
  clearInterval(trayUpdateTimer);
});

app.on('before-quit', () => {
  isQuitting = true;
  saveWindowState();
  stopDaemon();
  stopDashboard();
});
