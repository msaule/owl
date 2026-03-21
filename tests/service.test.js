import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLaunchdPlist,
  buildSystemdUnit,
  buildWindowsTaskCommand,
  getServiceDefinition
} from '../src/daemon/service.js';

test('windows task command contains node, script, and config paths', () => {
  const command = buildWindowsTaskCommand({
    nodePath: 'C:\\node\\node.exe',
    scriptPath: 'C:\\owl\\src\\daemon\\index.js',
    configPath: 'C:\\Users\\me\\.owl\\config.json'
  });

  assert.match(command, /node\.exe/);
  assert.match(command, /index\.js/);
  assert.match(command, /config\.json/);
});

test('launchd plist includes keepalive and program arguments', () => {
  const plist = buildLaunchdPlist({
    nodePath: '/usr/local/bin/node',
    scriptPath: '/Users/me/owl/src/daemon/index.js',
    configPath: '/Users/me/.owl/config.json',
    logPath: '/Users/me/.owl/logs/owl.log',
    label: 'ai.owl.daemon'
  });

  assert.match(plist, /<key>KeepAlive<\/key>/);
  assert.match(plist, /ai\.owl\.daemon/);
  assert.match(plist, /config\.json/);
});

test('systemd unit includes restart policy and exec start', () => {
  const unit = buildSystemdUnit({
    nodePath: '/usr/bin/node',
    scriptPath: '/home/me/owl/src/daemon/index.js',
    configPath: '/home/me/.owl/config.json',
    logPath: '/home/me/.owl/logs/owl.log'
  });

  assert.match(unit, /Restart=always/);
  assert.match(unit, /ExecStart=\/usr\/bin\/node/);
  assert.match(unit, /config\.json/);
});

test('service definition selects the correct mechanism by platform', () => {
  assert.equal(
    getServiceDefinition({
      platform: 'win32',
      scriptPath: 'C:\\owl\\index.js',
      configPath: 'C:\\owl\\config.json',
      logPath: 'C:\\owl\\owl.log'
    }).mechanism,
    'task-scheduler'
  );

  assert.equal(
    getServiceDefinition({
      platform: 'darwin',
      scriptPath: '/owl/index.js',
      configPath: '/owl/config.json',
      logPath: '/owl/owl.log'
    }).mechanism,
    'launchd'
  );

  assert.equal(
    getServiceDefinition({
      platform: 'linux',
      scriptPath: '/owl/index.js',
      configPath: '/owl/config.json',
      logPath: '/owl/owl.log'
    }).mechanism,
    'systemd'
  );
});
