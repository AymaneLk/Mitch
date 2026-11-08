$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$destination = Join-Path $root 'vendor/local-ai/nemotron'
New-Item -ItemType Directory -Force $destination | Out-Null
function Download-Verified($url,$name,$sha) {
  $file = Join-Path $destination $name
  if ((Test-Path $file) -and (Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant() -eq $sha) { return }
  & curl.exe --fail --location --retry 3 --silent --show-error --output "$file.part" $url
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $name" }
  if ((Get-FileHash "$file.part" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha) { throw "Checksum mismatch: $name" }
  Move-Item -LiteralPath "$file.part" -Destination $file -Force
}
Download-Verified 'https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.3.0/nemo-speech-0.3.0-windows-x86_64-cpu.zip' 'runtime.zip' '4ed9740e361e4653f56c3dce7d1e81883a1c8b831c1bd7d01567fff1130b5b05'
Expand-Archive -LiteralPath (Join-Path $destination 'runtime.zip') -DestinationPath (Join-Path $destination 'runtime') -Force
Download-Verified 'https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b/resolve/ebe59e5a817142986528bbbee5dba8db7b38ed50/nemotron-speech-streaming-en-0.6b.q8_0.gguf' 'nemotron-en-q8.gguf' 'd9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d'
Write-Host 'Verified Nemotron English Q8 model and CPU runtime installed for local evaluation.'
