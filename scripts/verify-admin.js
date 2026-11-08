'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Inspect the embedded Windows resource; do not launch the executable or change UAC.
async function verifyAdministratorManifest(executable) {
  const {NtExecutable,NtExecutableResource} = await import('resedit');
  const exe = NtExecutable.from(fs.readFileSync(executable));
  const resources = NtExecutableResource.from(exe);
  const manifests = resources.entries.filter(entry => entry.type === 24);
  if (manifests.length !== 1) throw new Error('Expected one embedded Windows application manifest.');
  const manifest = Buffer.from(manifests[0].bin).toString('utf8');
  const tags = [...manifest.matchAll(/<requestedExecutionLevel\b([^>]*)\/?\s*>/g)];
  if (tags.length !== 1) throw new Error('Expected one requestedExecutionLevel in the application manifest.');
  const level = tags[0][1].match(/\blevel\s*=\s*["']([^"']+)["']/)?.[1];
  const uiAccess = tags[0][1].match(/\buiAccess\s*=\s*["']([^"']+)["']/)?.[1];
  if (level !== 'requireAdministrator' || uiAccess !== 'false') {
    throw new Error(`Packaged app must request Administrator through normal Windows elevation (found ${level}, uiAccess=${uiAccess}).`);
  }
  return {executable:path.resolve(executable),requestedExecutionLevel:level,uiAccess:false};
}

if (require.main === module) {
  const executable = process.argv[2];
  if (!executable) { console.error('Usage: node scripts/verify-admin.js <Pixie.exe>'); process.exitCode = 1; }
  else verifyAdministratorManifest(executable).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}

module.exports = {verifyAdministratorManifest};
