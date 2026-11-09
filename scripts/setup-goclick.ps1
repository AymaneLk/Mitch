$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskRuntime = Join-Path $taskRoot 'vendor/goclick'
$taskModel = Join-Path $taskRuntime 'model'
New-Item -ItemType Directory -Force -Path $taskRuntime,$taskModel | Out-Null
$taskManifest = Get-Content (Join-Path $taskRoot 'local_runtime/goclick-manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $taskManifest.files) {
  $destination = Join-Path $taskModel $entry.file
  if ((Test-Path -LiteralPath $destination) -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -eq $entry.sha256) { continue }
  Write-Host "Downloading $($entry.file)"
  & curl.exe --fail --location --retry 3 --silent --show-error --output "$destination.part" "https://huggingface.co/$($taskManifest.repository)/resolve/$($taskManifest.revision)/$($entry.file)"
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $($entry.file)" }
  if ((Get-FileHash -LiteralPath "$destination.part" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Checksum mismatch: $($entry.file)" }
  Move-Item -LiteralPath "$destination.part" -Destination $destination -Force
}
$taskPython = Join-Path $taskRuntime 'venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $taskPython)) {
  & uv venv --python 3.12 (Join-Path $taskRuntime 'venv')
  if ($LASTEXITCODE -ne 0) { throw 'GoClick environment creation failed.' }
}
& uv pip sync --python $taskPython --index https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match (Join-Path $taskRoot 'local_runtime/goclick-requirements-lock.txt')
if ($LASTEXITCODE -ne 0) { throw 'GoClick dependency installation failed.' }
Write-Host 'GoClick files verified. CPU-only environment ready; no service or GPU model was started.'
