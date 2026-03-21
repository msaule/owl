import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugins } from '../src/plugins/loader.js';
import { BUNDLED_PLUGIN_DIR } from '../src/config/index.js';

test('plugin loader loads enabled plugins only', async () => {
  const plugins = await loadPlugins({
    builtInDir: BUNDLED_PLUGIN_DIR,
    config: {
      plugins: {
        mock: { enabled: true },
        files: { enabled: false }
      }
    }
  });

  assert.ok(plugins.find((plugin) => plugin.name === 'mock'));
  assert.ok(!plugins.find((plugin) => plugin.name === 'files'));
});
