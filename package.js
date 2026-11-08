const fs = require('node:fs');
const path = require('node:path');
const {verifyAdministratorManifest} = require('./scripts/verify-admin');
async function build() {
  if (!fs.existsSync(path.join(__dirname, 'vendor/cua-driver/cua-driver.exe'))) throw new Error('Run npm run setup:cua before packaging.');
  const {packager} = await import('@electron/packager');
  const results = await packager({
    dir: __dirname, name: 'Mitch', platform: 'win32', arch: 'x64',
    out: process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'outputs/windows-build'),
    overwrite: true, asar: {unpack: '{windows,wake-word}.ps1', unpackDir: 'vendor'}, prune: true,
    icon: path.join(__dirname, 'assets/companion.ico'), appVersion: require('./package.json').version,
    download: {cacheRoot: path.join(__dirname, '.electron-cache')},
    ignore: [/^\/(?:tests|test-output|outputs|scripts|\.npm-cache|\.electron-cache|\.git)(?:\/|$)/, /^\/(?:build-icon|package)\.js$/],
    win32metadata: {CompanyName:'Independent recreation', FileDescription:'Mitch Windows desktop companion', ProductName:'Mitch', 'requested-execution-level':'requireAdministrator'},
  });
  for (const result of results) {
    if (!fs.existsSync(path.join(result,'resources/app.asar.unpacked/vendor/cua-driver/cua-driver.exe'))) throw new Error('Packaged Cua executable was not unpacked.');
    if (!fs.existsSync(path.join(result,'resources/app.asar.unpacked/wake-word.ps1'))) throw new Error('Packaged local wake listener was not unpacked.');
    await verifyAdministratorManifest(path.join(result,'Mitch.exe'));
  }
  console.log(results.join('\n'));
}
build().catch(error => { console.error(error); process.exitCode = 1; });
