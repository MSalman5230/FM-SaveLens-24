param([switch]$NoBrowser, [switch]$Stop)
$ErrorActionPreference = 'Stop'
$scoutRoot = $PSScriptRoot
$scoutData = if ($env:FMSCOUT_DATA_DIR) { $env:FMSCOUT_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'io.github.MSalman5230.FMSaveLens24' }
$scoutPidFile = Join-Path $scoutData 'server.pid.json'
$scoutPort = if ($env:FMSCOUT_PORT) { [int]$env:FMSCOUT_PORT } else { 4242 }
$scoutUrl = "http://127.0.0.1:$scoutPort"
try {
    if ($Stop) {
        if (Test-Path -LiteralPath $scoutPidFile) {
            $scoutSaved = Get-Content -LiteralPath $scoutPidFile -Raw | ConvertFrom-Json
            $scoutProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($scoutSaved.pid)"
            if ($scoutProcess -and $scoutProcess.ExecutablePath -eq $scoutSaved.executable) { Stop-Process -Id $scoutSaved.pid }
            Remove-Item -LiteralPath $scoutPidFile -Force
        }
        exit 0
    }
    $scoutEntry = Join-Path $scoutRoot 'fm-savelens-24-server.exe'
    if (-not (Test-Path -LiteralPath $scoutEntry)) { $scoutEntry = Join-Path $scoutRoot 'target/release/fm-savelens-24-server.exe' }
    if (-not (Test-Path -LiteralPath $scoutEntry)) { throw 'Rust server not built. Run npm run build, or download the portable release.' }
    $scoutHealth = $null
    try { $scoutHealth = Invoke-RestMethod "$scoutUrl/api/health" -TimeoutSec 2 } catch {}
    if ($scoutHealth -and $scoutHealth.productName -ne 'FM SaveLens 24') { throw "Port $scoutPort is already used by another application." }
    if (-not $scoutHealth) {
        New-Item -ItemType Directory -Path $scoutData -Force | Out-Null
        $scoutChild = Start-Process -FilePath $scoutEntry -ArgumentList @('--no-open','--port',"$scoutPort") -WorkingDirectory $scoutRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $scoutData 'server.log') -RedirectStandardError (Join-Path $scoutData 'server-error.log')
        @{ pid=$scoutChild.Id; executable=[IO.Path]::GetFullPath($scoutEntry) } | ConvertTo-Json | Set-Content -LiteralPath $scoutPidFile
        for ($scoutAttempt = 0; $scoutAttempt -lt 60; $scoutAttempt++) {
            try { $scoutHealth = Invoke-RestMethod "$scoutUrl/api/health" -TimeoutSec 1; if ($scoutHealth.productName -eq 'FM SaveLens 24') { break } } catch {}
            if ($scoutChild.HasExited) { throw "Server startup failed. See $scoutData\server-error.log" }
            Start-Sleep -Milliseconds 150
        }
        if (-not $scoutHealth) { throw "The app did not start. See $scoutData\server-error.log" }
    }
    if (-not $NoBrowser) { Start-Process $scoutUrl }
    Write-Host "FM SaveLens 24 is ready at $scoutUrl"
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
