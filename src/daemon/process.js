import fs from 'node:fs';
import { spawn } from 'node:child_process';

export function readPid(pidPath) {
  if (!fs.existsSync(pidPath)) {
    return null;
  }

  const value = Number.parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
  return Number.isFinite(value) ? value : null;
}

export function isProcessRunning(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function startDetachedDaemon({ scriptPath, pidPath, configPath }) {
  const child = spawn(process.execPath, [scriptPath, '--run-daemon', '--config', configPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });

  child.unref();
  fs.writeFileSync(pidPath, `${child.pid}\n`, 'utf8');
  return child.pid;
}

export function stopDaemon(pidPath) {
  const pid = readPid(pidPath);
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }

  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }

  return true;
}
