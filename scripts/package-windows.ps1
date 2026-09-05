$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$runtime = Get-Content packaging/webview2.json -Raw | ConvertFrom-Json
$stage = Join-Path $projectRoot 'packaging/stage/FM SaveLens 24'
$unpacked = Join-Path $projectRoot 'packaging/stage/webview2-unpacked'
foreach ($target in @($stage, $unpacked, (Join-Path $projectRoot 'packaging/stage/extracted'))) {
    $resolved = [IO.Path]::GetFullPath($target)
    if (-not $resolved.StartsWith((Join-Path $projectRoot 'packaging/stage') + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid staging path' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
New-Item -ItemType Directory -Path $stage,$unpacked,'.cache/downloads','dist' -Force | Out-Null
$cab = Join-Path $projectRoot '.cache/downloads/webview2-x64.cab'
if (-not (Test-Path -LiteralPath $cab) -or (Get-FileHash -LiteralPath $cab -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtime.sha256) {
    Invoke-WebRequest $runtime.url -OutFile $cab
}
if ((Get-FileHash -LiteralPath $cab -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtime.sha256) { throw 'WebView2 checksum mismatch' }
& expand.exe $cab '-F:*' $unpacked | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'WebView2 extraction failed' }
$runtimeExe = Get-ChildItem -LiteralPath $unpacked -Filter msedgewebview2.exe -Recurse | Select-Object -First 1
if (-not $runtimeExe) { throw 'WebView2 runtime missing' }
Copy-Item -LiteralPath $runtimeExe.Directory.FullName -Destination (Join-Path $stage 'WebView2Runtime') -Recurse
foreach ($file in @('fm-savelens-24.exe','fm-savelens-24-server.exe')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "target/release/$file") -Destination $stage
}
foreach ($file in @('README.md','Start-FM-SaveLens-24.ps1','Start-Browser.cmd','Stop-Browser.cmd')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $stage
}
$zip = Join-Path $projectRoot "dist/FM-SaveLens-24-v$version-windows-x64-portable.zip"
Compress-Archive -LiteralPath $stage -DestinationPath $zip -Force
$installer = Get-ChildItem -LiteralPath 'target/release/bundle/nsis' -Filter '*-setup.exe'
if (@($installer).Count -ne 1) { throw 'Expected exactly one NSIS installer' }
Copy-Item -LiteralPath $installer.FullName -Destination "dist/FM-SaveLens-24-v$version-windows-x64-setup.exe" -Force
Expand-Archive -LiteralPath $zip -DestinationPath 'packaging/stage/extracted' -Force
Write-Host "Created Windows installer and portable ZIP for v$version"
