# HexaGram - deploiement de la build Vite sur la VM Freebox Ultra (LAN, :6503).
#
# Pre-requis (one-shot, voir README.md) :
#   - SSH passwordless vers freebox@192.168.1.141, sudo passwordless cote VM
#   - Bloc :6503 ajoute dans /etc/caddy/Caddyfile (voir vm/Caddyfile.hexagram)
#   - /opt/hexagram/ provisionne (mkdir + chown freebox)
#
# Usage : pwsh -File D:\_Perso\HexaGram\deploy\deploy.ps1

$ErrorActionPreference = "Stop"

$Remote      = "freebox@192.168.1.141"
$ScriptDir   = $PSScriptRoot
$ProjectRoot = Split-Path $ScriptDir -Parent
$DistDir     = Join-Path $ProjectRoot "dist"
$Tarball     = Join-Path $env:TEMP    "hexagram-dist.tar.gz"
$SyncScript  = Join-Path $ScriptDir   "vm\sync-app.sh"

function Write-Step {
    param([string]$Label, [int]$Step, [int]$Total)
    $ts = (Get-Date).ToString("HH:mm:ss")
    Write-Host ""
    Write-Host "[$ts] [$Step/$Total] $Label" -ForegroundColor Cyan
}

function Write-Info {
    param([string]$Msg)
    $ts = (Get-Date).ToString("HH:mm:ss")
    Write-Host "[$ts]       $Msg" -ForegroundColor DarkGray
}

function Write-Ok {
    param([string]$Msg, [TimeSpan]$Elapsed)
    $ts = (Get-Date).ToString("HH:mm:ss")
    $s = "{0:N1}s" -f $Elapsed.TotalSeconds
    Write-Host "[$ts]       OK ($s) - $Msg" -ForegroundColor Green
}

$TotalSw = [System.Diagnostics.Stopwatch]::StartNew()
$ts0 = (Get-Date).ToString("HH:mm:ss")
Write-Host "[$ts0] === HexaGram deploy -> $Remote (port 6503) ===" -ForegroundColor White

# --- [1/5] Build Vite ---------------------------------------------------------
Write-Step "Build Vite (npm run build)" 1 5
$sw = [System.Diagnostics.Stopwatch]::StartNew()
Push-Location $ProjectRoot
try {
    npm run build 2>&1 | ForEach-Object {
        $line = $_.ToString()
        if ($line.Trim()) {
            $ts = (Get-Date).ToString("HH:mm:ss")
            Write-Host "[$ts]   | $line"
        }
    }
    if ($LASTEXITCODE -ne 0) { throw "npm run build a echoue." }
} finally {
    Pop-Location
}
if (-not (Test-Path (Join-Path $DistDir "index.html"))) {
    throw "dist\index.html absent apres build."
}
$distSize = (Get-ChildItem $DistDir -Recurse -File | Measure-Object Length -Sum).Sum
$distFiles = (Get-ChildItem $DistDir -Recurse -File).Count
Write-Ok "$distFiles fichiers, $([math]::Round($distSize/1KB,1)) KB" $sw.Elapsed

# --- [2/5] Tar de la build ----------------------------------------------------
Write-Step "Tar de dist\ -> $Tarball" 2 5
$sw.Restart()
if (Test-Path $Tarball) { Remove-Item $Tarball -Force }
# GNU tar a besoin de --force-local pour ne pas parser "C:" comme un host
# distant ; bsdtar (Windows 10+) ne supporte pas ce flag et n'en a pas besoin.
$tarVersion = (& tar --version 2>&1 | Select-Object -First 1)
if ($tarVersion -match 'bsdtar') {
    tar -czf $Tarball -C $DistDir .
} else {
    tar --force-local -czf $Tarball -C $DistDir .
}
if ($LASTEXITCODE -ne 0) { throw "tar a echoue." }
$tarSize = (Get-Item $Tarball).Length
Write-Ok "tarball $([math]::Round($tarSize/1KB,1)) KB" $sw.Elapsed

# --- [3/5] scp tar ------------------------------------------------------------
Write-Step "scp tar -> ${Remote}:/tmp/hexagram-dist.tar.gz" 3 5
$sw.Restart()
scp $Tarball "${Remote}:/tmp/hexagram-dist.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "scp du tar a echoue." }
Write-Ok "transferre" $sw.Elapsed

# --- [4/5] scp sync-app.sh ----------------------------------------------------
Write-Step "scp sync-app.sh -> ${Remote}:/tmp/hexagram-sync-app.sh" 4 5
$sw.Restart()
scp $SyncScript "${Remote}:/tmp/hexagram-sync-app.sh"
if ($LASTEXITCODE -ne 0) { throw "scp sync-app.sh a echoue." }
Write-Ok "transferre" $sw.Elapsed

# --- [5/5] Execution distante -------------------------------------------------
Write-Step "Exec sync-app.sh sur $Remote (extract + reload Caddy)" 5 5
$sw.Restart()
ssh $Remote "sed -i 's/\r`$//' /tmp/hexagram-sync-app.sh && sudo bash /tmp/hexagram-sync-app.sh" 2>&1 | ForEach-Object {
    $line = $_.ToString()
    if ($line.Trim()) {
        $ts = (Get-Date).ToString("HH:mm:ss")
        Write-Host "[$ts]   | $line"
    }
}
if ($LASTEXITCODE -ne 0) { throw "sync-app.sh a echoue sur la VM." }
Write-Ok "VM sync termine" $sw.Elapsed

Remove-Item $Tarball -ErrorAction SilentlyContinue

$TotalSw.Stop()
$totalS = "{0:N1}s" -f $TotalSw.Elapsed.TotalSeconds
$ts1 = (Get-Date).ToString("HH:mm:ss")
Write-Host ""
Write-Host "[$ts1] === Deploy OK en $totalS -> http://192.168.1.141:6503 ===" -ForegroundColor Green
