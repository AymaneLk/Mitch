$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $root 'vendor/local-ai'
$models = Join-Path $runtime 'models'
New-Item -ItemType Directory -Force -Path $runtime,$models | Out-Null
function Download-Checked($url, $destination, $sha) {
  if (Test-Path -LiteralPath $destination) {
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -eq $sha) { return }
  }
  Write-Host "Downloading $(Split-Path $destination -Leaf)"
  & curl.exe --fail --location --retry 3 --silent --show-error --output "$destination.part" $url
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
  if ((Get-FileHash -LiteralPath "$destination.part" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha) { throw "Checksum mismatch: $destination" }
  Move-Item -LiteralPath "$destination.part" -Destination $destination -Force
}
$release = 'https://github.com/ggml-org/llama.cpp/releases/download/b12110'
$archives = @(
  @{name='llama-b12110-bin-win-cuda-12.4-x64.zip'; sha='1ce755bc3a061889234048f88e33328e17971eaad73c4666cfeb26026b317fee'},
  @{name='cudart-llama-bin-win-cuda-12.4-x64.zip'; sha='8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6'}
)
foreach ($archive in $archives) {
  $destination = Join-Path $runtime $archive.name
  Download-Checked "$release/$($archive.name)" $destination $archive.sha
  Expand-Archive -LiteralPath $destination -DestinationPath (Join-Path $runtime 'llama') -Force
}
$manifest = Get-Content (Join-Path $root 'local_runtime/models-manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest) {
  Download-Checked "https://huggingface.co/$($entry.repository)/resolve/$($entry.revision)/$($entry.file)" (Join-Path $models $entry.file) $entry.sha256
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'models-manifest.json')
Download-Checked 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx' (Join-Path $models 'kokoro-v1.0.onnx') 'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a'
Download-Checked 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin' (Join-Path $models 'voices-v1.0.bin') 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d'
Write-Host 'Local model downloads verified.'
if (!(Get-Command uv -ErrorAction SilentlyContinue)) { throw 'Install uv, then rerun this setup to create the Python speech environment.' }
$python = Join-Path $runtime 'venv/Scripts/python.exe'
if (!(Test-Path $python)) {
  & uv venv --python 3.12 (Join-Path $runtime 'venv')
  if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
}
& uv pip sync --python $python (Join-Path $root 'local_runtime/requirements-lock.txt')
if ($LASTEXITCODE -ne 0) { throw 'Speech dependency installation failed.' }
