const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ignorePackageFile} = require('../package-files');

test('packaging excludes local credentials, private state and development artifacts', () => {
  for (const file of ['/.env', '/.env.production', '/.npmrc', '/ui/.env.local', '/vendor/private.key', '/assets/cert.PFX', '/library.json', '/library.json.tmp', '/calendar.ics', '/wake-status.json', '/ui/debug.log', '/.git/config', '/tests/core.test.js', '/outputs/build', '/scratch/private.txt', '\\vendor\\secret.pem']) {
    assert.equal(ignorePackageFile(file), true, file);
  }
});
test('hybrid packaging keeps the browser adapter and folder helper without local credentials or models', () => {
  for (const file of ['/browser-extension', '/browser-extension/manifest.json', '/browser-extension/worker.js', '/browser-extension/tab-operations.js', '/browser-extension/page-agent.js', '/browser-extension/page-operations.js', '/browser-extension/site-agent.js', '/browser-extension/site-operations.js', '/public-site-task.js', '/browser-extension/popup.html', '/browser-extension/popup.js', '/folder-helper.ps1', '/native-state-signals.ps1']) {
    assert.equal(ignorePackageFile(file), false, file);
  }
  for (const file of ['/browser-extension/config.js', '/browser-extension/private.json', '/browser-extension/extra/config.js', '/vendor/local-ai', '/vendor/local-ai/model.gguf', '/vendor/goclick', '/vendor/goclick/model.safetensors', '/local_runtime/goclick.py']) {
    assert.equal(ignorePackageFile(file), true, file);
  }
});
test('packaging preserves application code, UI, driver and license notices', () => {
  for (const file of ['', '/', '/main.js', '/preload.js', '/windows.ps1', '/wake-word.ps1', '/ui/index.html', '/assets/companion.ico', '/vendor/cua-driver/cua-driver.exe', '/vendor/cua-driver/LICENSE', '/node_modules/ajv/dist/ajv.js', '/node_modules/ajv/LICENSE', '/package.json', '/LICENSE', '/THIRD_PARTY_NOTICES.md']) {
    assert.equal(ignorePackageFile(file), false, file);
  }
});
