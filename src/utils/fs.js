import fs from 'node:fs';
import path from 'node:path';

export function appendNdjson(filePath, object) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(object)}\n`, 'utf8');
}

export function writeNdjson(filePath, objects) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!objects.length) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return;
  }

  fs.writeFileSync(filePath, `${objects.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
}

export function readNdjson(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function fileExists(filePath) {
  return fs.existsSync(filePath);
}

export function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, 'utf8');
}

export function deleteFileIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
