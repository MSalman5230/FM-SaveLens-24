param([string]$Executable = 'packaging/stage/extracted/FM SaveLens 24/fm-savelens-24.exe')
$ErrorActionPreference = 'Stop'
$executablePath = [IO.Path]::GetFullPath($Executable)
$runtimePath = Join-Path (Split-Path -Parent $executablePath) 'WebView2Runtime'
$testData = Join-Path ([IO.Path]::GetTempPath()) ('fm-savelens-desktop-' + [guid]::NewGuid())
$previousData = $env:FM_SAVELENS_24_DATA_DIR
$desktopProcess = $null
try {
    $env:FM_SAVELENS_24_DATA_DIR = $testData
    $desktopProcess = Start-Process -FilePath $executablePath -WindowStyle Hidden -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        $desktopProcess.Refresh()
        if ($desktopProcess.HasExited) { throw 'Packaged desktop exited during startup' }
        $listener = Get-NetTCPConnection -OwningProcess $desktopProcess.Id -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        $renderer = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
            Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($runtimePath + '\') -and $_.CommandLine -like '*--type=renderer*' }
        if ($listener -and $renderer) {
            $url = "http://127.0.0.1:$($listener.LocalPort)"
            $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 5
            if ($health.productName -ne 'FM SaveLens 24') { throw 'Unexpected application service' }
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw 'Bundled WebView2 renderer or owned Rust service did not start' }
    Write-Host "Packaged desktop $($health.version): bundled WebView2 renderer and owned loopback service passed."
} finally {
    $env:FM_SAVELENS_24_DATA_DIR = $previousData
    if ($desktopProcess -and -not $desktopProcess.HasExited) {
        Stop-Process -Id $desktopProcess.Id
        $desktopProcess.WaitForExit(10000) | Out-Null
    }
    if (Test-Path -LiteralPath $testData) {
        $resolved = [IO.Path]::GetFullPath($testData)
        if (-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()) + 'fm-savelens-desktop-')) { throw 'Unexpected test directory' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
