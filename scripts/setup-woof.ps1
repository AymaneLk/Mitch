# Optional benchmark model; free only for non-commercial use with attribution.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content (Join-Path $root 'local_runtime/woof-manifest.json') -Raw | ConvertFrom-Json
$destination = Join-Path $root 'vendor/local-ai/woof'
foreach ($entry in $manifest.files) {
  $file = Join-Path $destination $entry.file
  New-Item -ItemType Directory -Force (Split-Path $file -Parent) | Out-Null
  if ((Test-Path $file) -and (Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant() -eq $entry.sha256) { continue }
  & curl.exe --fail --location --retry 3 --silent --show-error --output "$file.part" "https://huggingface.co/$($manifest.repository)/resolve/$($manifest.revision)/$($entry.file)"
  if ($LASTEXITCODE -ne 0) { throw 'Woof download failed.' }
  if ((Get-FileHash "$file.part" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Woof checksum mismatch.' }
  Move-Item -LiteralPath "$file.part" -Destination $file -Force
}
Write-Host 'Woof downloaded for local evaluation. Read vendor/local-ai/woof/LICENSE before use. Voice by Underdog Woof.'
