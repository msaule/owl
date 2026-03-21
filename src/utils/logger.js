import fs from 'node:fs';
import path from 'node:path';
import { LOG_PATH } from '../config/index.js';

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

export class Logger {
  /**
   * @param {{ logPath?: string, debug?: boolean }} [options]
   */
  constructor(options = {}) {
    this.logPath = options.logPath || LOG_PATH;
    this.debugEnabled = Boolean(options.debug);
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
  }

  /**
   * @param {'DEBUG'|'INFO'|'WARN'|'ERROR'} level
   * @param {string} message
   * @param {Record<string, any>} [meta]
   */
  log(level, message, meta = undefined) {
    if (level === 'DEBUG' && !this.debugEnabled) {
      return;
    }

    const timestamp = new Date().toISOString();
    const line = meta
      ? `[${timestamp}] ${level} ${message} ${safeStringify(meta)}`
      : `[${timestamp}] ${level} ${message}`;

    fs.appendFileSync(this.logPath, `${line}\n`, 'utf8');

    if (level === 'ERROR') {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  debug(message, meta) {
    this.log('DEBUG', message, meta);
  }

  info(message, meta) {
    this.log('INFO', message, meta);
  }

  warn(message, meta) {
    this.log('WARN', message, meta);
  }

  error(message, meta) {
    this.log('ERROR', message, meta);
  }
}

export function tailFile(filePath, lineCount = 50) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - lineCount));
}
