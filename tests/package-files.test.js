const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ignorePackageFile} = require('../package-files');

test('packaging excludes local credentials, private state and development artifacts', () => {
  for (const file of ['/.env', '/.env.production', '/.npmrc', '/ui/.env.local', '/vendor/private.key', '/assets/cert.PFX', '/library.json', '/library.json.tmp', '/calendar.ics', '/wake-status.json', '/ui/debug.log', '/.git/config', '/tests/core.test.js', '/outputs/build', '/scratch/private.txt', '\\vendor\\secret.pem']) {
    assert.equal(ignorePackageFile(file), true, file);
  }
});
test('packaging preserves application code, UI, driver and license notices', () => {
  for (const file of ['', '/', '/main.js', '/preload.js', '/windows.ps1', '/wake-word.ps1', '/ui/index.html', '/assets/companion.ico', '/vendor/cua-driver/cua-driver.exe', '/vendor/cua-driver/LICENSE', '/node_modules/ajv/dist/ajv.js', '/node_modules/ajv/LICENSE', '/package.json', '/LICENSE', '/THIRD_PARTY_NOTICES.md']) {
    assert.equal(ignorePackageFile(file), false, file);
  }
});
