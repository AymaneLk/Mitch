'use strict';

// Project-local, pinned Cua Driver installation. No PATH, registry, or autostart changes.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const VERSION = '0.41.0';
const ARCHIVE = `cua-driver-rs-${VERSION}-windows-x86_64.zip`;
const ARCHIVE_SHA256 = 'bd92626e0258428e2db80baac80fdff605a7b1ef6747776d8cbcf8972de20b6b';
const BASE_URL = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${VERSION}`;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const VENDOR_ROOT = path.join(PROJECT_ROOT, 'vendor');
const DESTINATION = path.join(VENDOR_ROOT, 'cua-driver');
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function runPowerShell(script, env) {
  const preamble = "$ProgressPreference = 'SilentlyContinue'\n";
  return execFileSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(preamble + script, 'utf16le').toString('base64')], {
    encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024,
    env: { ...process.env, PSModulePath: path.join(path.dirname(POWERSHELL), 'Modules'), ...env }
  }).trim();
}

async function fetchBytes(url, maxBytes) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Pixie-Cua-Setup/1.0' }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Download exceeds the size limit.');
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > maxBytes) throw new Error('Download exceeds the size limit.');
    parts.push(part);
  }
  return Buffer.concat(parts);
}

function verifySignature(binaryPath) {
  return runPowerShell(`
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $env:PIXIE_CUA_BINARY
if ($signature.Status -ne 'Valid') { throw "Cua Driver signature is not valid: $($signature.Status)" }
if ($signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ne 'Cua AI, Inc.') { throw 'Unexpected Cua Driver signer.' }
$signature.SignerCertificate.Subject
`, { PIXIE_CUA_BINARY: binaryPath });
}

async function safeRemoveStage(stage) {
  const resolved = path.resolve(stage);
  const realVendor = await fs.realpath(VENDOR_ROOT);
  const realStage = await fs.realpath(resolved).catch(() => null);
  if (!realStage) return;
  if (path.dirname(realStage).toLowerCase() !== realVendor.toLowerCase() || !path.basename(realStage).startsWith('.cua-install-')) {
    throw new Error('Refusing to remove a staging directory outside this project.');
  }
  await fs.rm(realStage, { recursive: true, force: true });
}

async function setup() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This installer targets Windows x64. Set a separately installed driver path on another platform.');
  await fs.mkdir(VENDOR_ROOT, { recursive: true });
  const vendorInfo = await fs.lstat(VENDOR_ROOT);
  if (vendorInfo.isSymbolicLink()) throw new Error('The vendor directory must not be a link.');
  const existing = await fs.lstat(DESTINATION).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('The Cua installation directory must be an ordinary directory.');
    const metadata = JSON.parse(await fs.readFile(path.join(DESTINATION, 'pixie-install.json'), 'utf8'));
    const binary = path.join(DESTINATION, 'cua-driver.exe');
    if (metadata.version !== VERSION || metadata.archiveSha256 !== ARCHIVE_SHA256) throw new Error('A different Cua Driver installation already exists; leave it intact and review before replacing it.');
    const binaryBytes = await fs.readFile(binary);
    if (crypto.createHash('sha256').update(binaryBytes).digest('hex') !== metadata.binarySha256) throw new Error('Installed Cua Driver hash does not match its installation record.');
    verifySignature(binary);
    console.log(`Cua Driver ${VERSION} is already verified at ${binary}`);
    return binary;
  }

  const stage = await fs.mkdtemp(path.join(VENDOR_ROOT, '.cua-install-'));
  try {
    console.log(`Downloading official Cua Driver ${VERSION} for Windows x64...`);
    const [archive, checksums] = await Promise.all([
      fetchBytes(`${BASE_URL}/${ARCHIVE}`, 128 * 1024 * 1024),
      fetchBytes(`${BASE_URL}/SHA256SUMS`, 1024 * 1024)
    ]);
    const checksumRows = checksums.toString('utf8').split(/\r?\n/).map(line => line.trim().split(/\s+/));
    const published = checksumRows.find(row => row[1]?.replace(/^\*/, '') === ARCHIVE)?.[0];
    const actual = crypto.createHash('sha256').update(archive).digest('hex');
    if (published !== ARCHIVE_SHA256 || actual !== ARCHIVE_SHA256) throw new Error('Cua Driver archive SHA256 verification failed.');
    const archivePath = path.join(stage, ARCHIVE);
    await fs.writeFile(archivePath, archive, { flag: 'wx' });
    const unpackPath = path.join(stage, 'unpacked');
    await fs.mkdir(unpackPath);
    // Validate every ZIP member before writing; reject traversal, links, duplicate paths and oversized archives.
    runPowerShell(`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($env:PIXIE_CUA_UNPACK).TrimEnd('\\') + '\\'
$zip = [IO.Compression.ZipFile]::OpenRead($env:PIXIE_CUA_ARCHIVE)
try {
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $total = 0L
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('\\', '/')
    if ($name.StartsWith('/') -or $name.Contains(':') -or ($name.Split('/') -contains '..')) { throw 'Unsafe ZIP entry path.' }
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $name))
    if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP entry escapes staging directory.' }
    if (-not $seen.Add($target)) { throw 'Duplicate ZIP entry.' }
    $unixType = ($entry.ExternalAttributes -shr 16) -band 0xF000
    if ($unixType -eq 0xA000 -or (($entry.ExternalAttributes -band 0x400) -ne 0)) { throw 'ZIP links are not allowed.' }
    $total += $entry.Length
    if ($total -gt 536870912 -or $zip.Entries.Count -gt 1000) { throw 'ZIP exceeds extraction limits.' }
  }
  foreach ($entry in $zip.Entries) {
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $entry.FullName))
    if ($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
  }
} finally { $zip.Dispose() }
`, { PIXIE_CUA_UNPACK: unpackPath, PIXIE_CUA_ARCHIVE: archivePath });
    const releaseFolder = path.join(unpackPath, `cua-driver-rs-${VERSION}-windows-x86_64`);
    const stagedBinary = path.join(releaseFolder, 'cua-driver.exe');
    const signer = verifySignature(stagedBinary);
    const binarySha256 = crypto.createHash('sha256').update(await fs.readFile(stagedBinary)).digest('hex');
    await fs.writeFile(path.join(releaseFolder, 'pixie-install.json'), JSON.stringify({ version: VERSION, source: `${BASE_URL}/${ARCHIVE}`, archiveSha256: ARCHIVE_SHA256, binarySha256, signer }, null, 2) + '\n');
    await fs.rename(releaseFolder, DESTINATION);
    console.log(`Verified Cua Driver ${VERSION}: ${path.join(DESTINATION, 'cua-driver.exe')}`);
    return path.join(DESTINATION, 'cua-driver.exe');
  } finally { await safeRemoveStage(stage); }
}

if (require.main === module) setup().catch(error => { console.error(`Cua setup failed: ${error.message}`); process.exitCode = 1; });

module.exports = { setup, VERSION, ARCHIVE_SHA256 };
