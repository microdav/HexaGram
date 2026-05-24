# HexaGram - deploiement build Vite + backend Node sur la VM Freebox Ultra (LAN, :6503).
#
# Usage : pwsh -File D:\_Perso\HexaGram\deploy\deploy.ps1

$ErrorActionPreference = "Stop"

$Remote        = "freebox@192.168.1.141"
$ScriptDir     = $PSScriptRoot
$ProjectRoot   = Split-Path $ScriptDir -Parent
$DistDir       = Join-Path $ProjectRoot "dist"
$ServerDir     = Join-Path $ProjectRoot "server"
$TarballApp    = Join-Path $env:TEMP "hexagram-dist.tar.gz"
$TarballServer = Join-Path $env:TEMP "hexagram-server.tar.gz"
$SyncApp       = Join-Path $ScriptDir "vm\sync-app.sh"
$SyncServer    = Join-Path $ScriptDir "vm\sync-server.sh"
$ServiceFile   = Join-Path $ScriptDir "vm\hexagram-api.service"

$TotalSteps = 7

function Write-Step([string]$Label, [int]$Step) {
    Write-Host ""
    Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] [$Step/$TotalSteps] $Label" -ForegroundColor Cyan
}
function Write-Ok([string]$Msg, [System.Diagnostics.Stopwatch]$sw) {
    Write-Host "[$((Get-Date).ToString('HH:mm:ss'))]   OK ($("{0:N1}s" -f $sw.Elapsed.TotalSeconds)) - $Msg" -ForegroundColor Green
}
function Stream-Ssh([string]$Cmd) {
    ssh $Remote $Cmd 2>&1 | ForEach-Object {
        $line = $_.ToString().Trim()
        if ($line) { Write-Host "[$((Get-Date).ToString('HH:mm:ss'))]   | $line" }
    }
    if ($LASTEXITCODE -ne 0) { throw "Commande SSH echouee (exit $LASTEXITCODE)" }
}

$totalSw = [System.Diagnostics.Stopwatch]::StartNew()
Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] === HexaGram deploy -> $Remote ===" -ForegroundColor White

# ── 1. Build Vite ─────────────────────────────────────────────────────────────
Write-Step "Build Vite" 1
$sw = [System.Diagnostics.Stopwatch]::StartNew()
Push-Location $ProjectRoot
try {
    $ErrorActionPreference = "Continue"
    $out = npm run build 2>&1; $ec = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    $out | ForEach-Object {
        $l = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { $_.ToString() }
        if ($l.Trim()) { Write-Host "[$((Get-Date).ToString('HH:mm:ss'))]   | $l" }
    }
    if ($ec -ne 0) { throw "npm run build echoue" }
} finally { Pop-Location }
Write-Ok "$((Get-ChildItem $DistDir -Recurse -File).Count) fichiers" $sw

# ── 2. Build serveur ──────────────────────────────────────────────────────────
Write-Step "Build serveur (tsc)" 2
$sw.Restart()
Push-Location $ServerDir
try {
    $ErrorActionPreference = "Continue"
    $out = npm run build 2>&1; $ec = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    $out | ForEach-Object {
        $l = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { $_.ToString() }
        if ($l.Trim()) { Write-Host "[$((Get-Date).ToString('HH:mm:ss'))]   | $l" }
    }
    if ($ec -ne 0) { throw "build serveur echoue" }
} finally { Pop-Location }
Write-Ok "dist/ compile" $sw

# ── 3. Tar frontend ───────────────────────────────────────────────────────────
Write-Step "Tar frontend" 3
$sw.Restart()
if (Test-Path $TarballApp) { Remove-Item $TarballApp -Force }
$tarVer = (& tar --version 2>&1 | Select-Object -First 1)
if ($tarVer -match 'bsdtar') { tar -czf $TarballApp -C $DistDir . }
else { tar --force-local -czf $TarballApp -C $DistDir . }
if ($LASTEXITCODE -ne 0) { throw "tar frontend echoue" }
Write-Ok "$([math]::Round((Get-Item $TarballApp).Length/1KB,1)) KB" $sw

# ── 4. Tar serveur (dist + node_modules prod) ─────────────────────────────────
Write-Step "Tar serveur (dist + node_modules prod bundlés localement)" 4
$sw.Restart()

# npm ci --omit=dev dans un dossier temporaire propre
$TmpPkg = Join-Path $env:TEMP "hexagram-server-pkg"
if (Test-Path $TmpPkg) { Remove-Item $TmpPkg -Recurse -Force }
New-Item -ItemType Directory $TmpPkg | Out-Null
Copy-Item (Join-Path $ServerDir "dist")         "$TmpPkg\dist"   -Recurse
Copy-Item (Join-Path $ServerDir "package.json") "$TmpPkg\"
# Copie package-lock.json s'il existe
$lockFile = Join-Path $ServerDir "package-lock.json"
if (Test-Path $lockFile) { Copy-Item $lockFile "$TmpPkg\" }

Push-Location $TmpPkg
try {
    npm ci --omit=dev --silent 2>&1 | ForEach-Object {
        $l = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { $_.ToString() }
        if ($l.Trim()) { Write-Host "[$((Get-Date).ToString('HH:mm:ss'))]   | $l" }
    }
    if ($LASTEXITCODE -ne 0) { throw "npm ci local echoue" }
} finally { Pop-Location }

if (Test-Path $TarballServer) { Remove-Item $TarballServer -Force }
if ($tarVer -match 'bsdtar') { tar -czf $TarballServer -C $TmpPkg . }
else { tar --force-local -czf $TarballServer -C $TmpPkg . }
if ($LASTEXITCODE -ne 0) { throw "tar serveur echoue" }
Remove-Item $TmpPkg -Recurse -Force
Write-Ok "$([math]::Round((Get-Item $TarballServer).Length/1KB,1)) KB" $sw

# ── 5. SCP ────────────────────────────────────────────────────────────────────
Write-Step "SCP vers $Remote" 5
$sw.Restart()
scp $TarballApp  "${Remote}:/tmp/hexagram-dist.tar.gz"
scp $TarballServer "${Remote}:/tmp/hexagram-server.tar.gz"
scp $SyncApp     "${Remote}:/tmp/hexagram-sync-app.sh"
scp $SyncServer  "${Remote}:/tmp/hexagram-sync-server.sh"
scp $ServiceFile "${Remote}:/tmp/hexagram-api.service"
if ($LASTEXITCODE -ne 0) { throw "scp echoue" }
Write-Ok "transferes" $sw

# ── 6. Sync frontend ──────────────────────────────────────────────────────────
Write-Step "Sync frontend (extract + reload Caddy)" 6
$sw.Restart()
Stream-Ssh "sed -i 's/\r$//' /tmp/hexagram-sync-app.sh && sudo bash /tmp/hexagram-sync-app.sh"
Write-Ok "frontend OK" $sw

# ── 7. Sync backend ───────────────────────────────────────────────────────────
Write-Step "Sync backend (extract + restart service)" 7
$sw.Restart()
Stream-Ssh "sed -i 's/\r$//' /tmp/hexagram-sync-server.sh && sudo bash /tmp/hexagram-sync-server.sh"
Write-Ok "backend OK" $sw

Remove-Item $TarballApp    -ErrorAction SilentlyContinue
Remove-Item $TarballServer -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] === Deploy OK en $("{0:N1}s" -f $totalSw.Elapsed.TotalSeconds) -> http://192.168.1.141:6503 ===" -ForegroundColor Green
