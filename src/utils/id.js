import crypto from 'node:crypto';

export function createId(prefix = 'owl') {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
