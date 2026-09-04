param([switch]$NoBrowser, [switch]$Stop)
$ErrorActionPreference = 'Stop'
$scoutRoot = $PSScriptRoot
$scoutEntry = Join-Path $scoutRoot 'server\index.ts'
$scoutData = Join-Path $env:LOCALAPPDATA 'FMScout24'
$scoutPidFile = Join-Path $scoutData 'server.pid'
$scoutUrl = 'http://127.0.0.1:4242'
try {
    if ($Stop) {
        if (Test-Path -LiteralPath $scoutPidFile) {
            $scoutPid = [int](Get-Content -LiteralPath $scoutPidFile -Raw)
            $scoutProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $scoutPid"
            if ($scoutProcess -and $scoutProcess.Name -eq 'node.exe' -and $scoutProcess.CommandLine.Contains($scoutEntry)) {
                Stop-Process -Id $scoutPid
                Write-Host 'FM Scout 24 stopped.'
            }
            Remove-Item -LiteralPath $scoutPidFile -Force
        }
        exit 0
    }
    $scoutNode = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $scoutNode) { throw 'Install Node.js 24 LTS from nodejs.org, then run this launcher again.' }
    & $scoutNode -e "const v=process.versions.node.split('.').map(Number);if(v[0]<24||(v[0]===24&&v[1]<14))process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'FM Scout 24 requires Node.js 24.14 or later.' }
    $scoutHealth = $null
    try { $scoutHealth = Invoke-RestMethod "$scoutUrl/api/health" -TimeoutSec 2 } catch {}
    if ($scoutHealth -and $scoutHealth.app -ne 'fm24-scout') { throw 'Port 4242 is already used by another application.' }
    if (-not $scoutHealth) {
        if (-not (Test-Path -LiteralPath (Join-Path $scoutRoot 'web\dist\client\index.html'))) {
            Push-Location $scoutRoot
            try {
                if (-not (Test-Path -LiteralPath (Join-Path $scoutRoot 'web\node_modules'))) {
                    & npm.cmd --prefix web ci
                    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
                }
                & npm.cmd run build
                if ($LASTEXITCODE -ne 0) { throw 'App build failed. See the output above.' }
            } finally { Pop-Location }
        }
        New-Item -ItemType Directory -Path $scoutData -Force | Out-Null
        $scoutChild = Start-Process -FilePath $scoutNode -ArgumentList @('"' + $scoutEntry + '"') -WorkingDirectory $scoutRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $scoutData 'server.log') -RedirectStandardError (Join-Path $scoutData 'server-error.log')
        Set-Content -LiteralPath $scoutPidFile -Value $scoutChild.Id
        for ($scoutAttempt = 0; $scoutAttempt -lt 40; $scoutAttempt++) {
            try { $scoutHealth = Invoke-RestMethod "$scoutUrl/api/health" -TimeoutSec 1; if ($scoutHealth.app -eq 'fm24-scout') { break } } catch {}
            if ($scoutChild.HasExited) { throw "Server startup failed. See $scoutData\server-error.log" }
            Start-Sleep -Milliseconds 150
        }
        if (-not $scoutHealth -or $scoutHealth.app -ne 'fm24-scout') { throw "The app did not start. See $scoutData\server-error.log" }
    }
    if (-not $NoBrowser) { Start-Process $scoutUrl }
    Write-Host "FM Scout 24 is ready at $scoutUrl"
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
