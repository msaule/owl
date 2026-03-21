#!/usr/bin/env node
import { showContext } from '../src/cli/context.js';

const args = process.argv.slice(2);
const daysIndex = args.indexOf('--days');
const days = daysIndex !== -1 ? Number.parseInt(args[daysIndex + 1], 10) : 3;

showContext(undefined, {
  json: true,
  days: Number.isFinite(days) ? days : 3
});
