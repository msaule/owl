import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const OWL_SERVICE_NAME = 'owl-ai';
export const WINDOWS_TASK_NAME = 'OWL AI';

function quoteWindows(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true
  });

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function parseListOutput(text) {
  const output = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      output[key] = value;
    }
  }

  return output;
}

export function getServicePaths(platform = process.platform) {
  if (platform === 'darwin') {
    return {
      installPath: path.join(os.homedir(), 'Library', 'LaunchAgents', 'ai.owl.daemon.plist'),
      label: 'ai.owl.daemon',
      mechanism: 'launchd'
    };
  }

  if (platform === 'linux') {
    return {
      installPath: path.join(os.homedir(), '.config', 'systemd', 'user', `${OWL_SERVICE_NAME}.service`),
      label: OWL_SERVICE_NAME,
      mechanism: 'systemd'
    };
  }

  return {
    installPath: null,
    label: WINDOWS_TASK_NAME,
    mechanism: 'task-scheduler'
  };
}

export function buildWindowsTaskCommand({ nodePath, scriptPath, configPath }) {
  return `${quoteWindows(nodePath)} ${quoteWindows(scriptPath)} --config ${quoteWindows(configPath)}`;
}

export function buildLaunchdPlist({ nodePath, scriptPath, configPath, logPath, label }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${nodePath}</string>
      <string>${scriptPath}</string>
      <string>--config</string>
      <string>${configPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
  </dict>
</plist>
`;
}

export function buildSystemdUnit({ nodePath, scriptPath, configPath, logPath }) {
  return `[Unit]
Description=OWL AI daemon
After=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${scriptPath} --config ${configPath}
Restart=always
RestartSec=10
StandardOutput=append:${logPath}
StandardError=append:${logPath}

[Install]
WantedBy=default.target
`;
}

export function getServiceDefinition({
  platform = process.platform,
  nodePath = process.execPath,
  scriptPath,
  configPath,
  logPath
}) {
  const base = getServicePaths(platform);
  if (platform === 'win32') {
    return {
      ...base,
      platform,
      command: buildWindowsTaskCommand({ nodePath, scriptPath, configPath })
    };
  }

  if (platform === 'darwin') {
    return {
      ...base,
      platform,
      fileContents: buildLaunchdPlist({
        nodePath,
        scriptPath,
        configPath,
        logPath,
        label: base.label
      })
    };
  }

  return {
    ...base,
    platform,
    fileContents: buildSystemdUnit({
      nodePath,
      scriptPath,
      configPath,
      logPath
    })
  };
}

function writeServiceFile(installPath, contents) {
  fs.mkdirSync(path.dirname(installPath), { recursive: true });
  fs.writeFileSync(installPath, contents, 'utf8');
}

export function installService({
  platform = process.platform,
  nodePath = process.execPath,
  scriptPath,
  configPath,
  logPath,
  startNow = false
}) {
  const definition = getServiceDefinition({
    platform,
    nodePath,
    scriptPath,
    configPath,
    logPath
  });

  if (platform === 'win32') {
    const createResult = runCommand('schtasks', [
      '/Create',
      '/TN',
      WINDOWS_TASK_NAME,
      '/SC',
      'ONLOGON',
      '/RL',
      'LIMITED',
      '/TR',
      definition.command,
      '/F'
    ]);

    if (!createResult.ok) {
      throw new Error(createResult.stderr.trim() || createResult.stdout.trim() || 'Failed to create scheduled task');
    }

    if (startNow) {
      runCommand('schtasks', ['/Run', '/TN', WINDOWS_TASK_NAME]);
    }

    return {
      installed: true,
      platform,
      mechanism: definition.mechanism,
      name: WINDOWS_TASK_NAME
    };
  }

  writeServiceFile(definition.installPath, definition.fileContents);

  if (platform === 'darwin') {
    if (startNow) {
      runCommand('launchctl', ['unload', definition.installPath]);
      const loadResult = runCommand('launchctl', ['load', definition.installPath]);
      if (!loadResult.ok) {
        throw new Error(loadResult.stderr.trim() || loadResult.stdout.trim() || 'Failed to load launchd service');
      }
    }
  } else {
    const reloadResult = runCommand('systemctl', ['--user', 'daemon-reload']);
    if (!reloadResult.ok) {
      throw new Error(reloadResult.stderr.trim() || reloadResult.stdout.trim() || 'Failed to reload systemd user units');
    }

    const enableResult = runCommand('systemctl', ['--user', 'enable', OWL_SERVICE_NAME]);
    if (!enableResult.ok) {
      throw new Error(enableResult.stderr.trim() || enableResult.stdout.trim() || 'Failed to enable systemd service');
    }

    if (startNow) {
      const startResult = runCommand('systemctl', ['--user', 'start', OWL_SERVICE_NAME]);
      if (!startResult.ok) {
        throw new Error(startResult.stderr.trim() || startResult.stdout.trim() || 'Failed to start systemd service');
      }
    }
  }

  return {
    installed: true,
    platform,
    mechanism: definition.mechanism,
    path: definition.installPath
  };
}

export function uninstallService({ platform = process.platform } = {}) {
  const definition = getServicePaths(platform);

  if (platform === 'win32') {
    const result = runCommand('schtasks', ['/Delete', '/TN', WINDOWS_TASK_NAME, '/F']);
    return {
      installed: false,
      platform,
      removed: result.ok,
      mechanism: definition.mechanism
    };
  }

  if (platform === 'darwin') {
    runCommand('launchctl', ['unload', definition.installPath]);
    if (fs.existsSync(definition.installPath)) {
      fs.unlinkSync(definition.installPath);
    }

    return {
      installed: false,
      platform,
      removed: true,
      mechanism: definition.mechanism,
      path: definition.installPath
    };
  }

  runCommand('systemctl', ['--user', 'disable', '--now', OWL_SERVICE_NAME]);
  if (fs.existsSync(definition.installPath)) {
    fs.unlinkSync(definition.installPath);
  }
  runCommand('systemctl', ['--user', 'daemon-reload']);

  return {
    installed: false,
    platform,
    removed: true,
    mechanism: definition.mechanism,
    path: definition.installPath
  };
}

export function getServiceStatus({ platform = process.platform } = {}) {
  const definition = getServicePaths(platform);

  if (platform === 'win32') {
    const result = runCommand('schtasks', ['/Query', '/TN', WINDOWS_TASK_NAME, '/FO', 'LIST', '/V']);
    if (!result.ok) {
      return {
        installed: false,
        active: false,
        platform,
        mechanism: definition.mechanism
      };
    }

    const details = parseListOutput(result.stdout);
    return {
      installed: true,
      active: /running/i.test(details.Status || details['Scheduled Task State'] || ''),
      platform,
      mechanism: definition.mechanism,
      details
    };
  }

  if (platform === 'darwin') {
    const installed = fs.existsSync(definition.installPath);
    if (!installed) {
      return {
        installed: false,
        active: false,
        platform,
        mechanism: definition.mechanism,
        path: definition.installPath
      };
    }

    const userId = typeof process.getuid === 'function' ? process.getuid() : null;
    const printResult =
      userId == null ? { ok: false } : runCommand('launchctl', ['print', `gui/${userId}/${definition.label}`]);

    return {
      installed,
      active: Boolean(printResult.ok),
      platform,
      mechanism: definition.mechanism,
      path: definition.installPath
    };
  }

  const installed = fs.existsSync(definition.installPath);
  if (!installed) {
    return {
      installed: false,
      active: false,
      platform,
      mechanism: definition.mechanism,
      path: definition.installPath
    };
  }

  const enabledResult = runCommand('systemctl', ['--user', 'is-enabled', OWL_SERVICE_NAME]);
  const activeResult = runCommand('systemctl', ['--user', 'is-active', OWL_SERVICE_NAME]);

  return {
    installed: enabledResult.ok && enabledResult.stdout.trim() !== 'disabled',
    active: activeResult.ok && activeResult.stdout.trim() === 'active',
    platform,
    mechanism: definition.mechanism,
    path: definition.installPath
  };
}
