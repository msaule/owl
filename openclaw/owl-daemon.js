#!/usr/bin/env node
import { startDaemon } from '../src/daemon/index.js';

startDaemon().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
