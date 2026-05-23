#!/usr/bin/env pwsh
# Usage: .\push.ps1 [branch]    (default: current branch)
# Reads GITHUB_PAT/GITHUB_USER/GITHUB_REPO from .secrets.local and pushes
# without leaving the token in git config or in the Windows credential store.

$ErrorActionPreference = "Stop"

$secretsPath = Join-Path $PSScriptRoot ".secrets.local"
if (-not (Test-Path $secretsPath)) {
    Write-Error ".secrets.local introuvable à coté de push.ps1"
    exit 1
}

$secrets = @{}
foreach ($line in Get-Content $secretsPath) {
    if ($line -match "^\s*([^#=]+?)\s*=\s*(.+?)\s*$") {
        $secrets[$matches[1]] = $matches[2]
    }
}

$pat  = $secrets["GITHUB_PAT"]
$user = $secrets["GITHUB_USER"]
$repo = $secrets["GITHUB_REPO"]

if (-not $pat -or -not $user -or -not $repo) {
    Write-Error "GITHUB_PAT, GITHUB_USER ou GITHUB_REPO manquant dans .secrets.local"
    exit 1
}

$branch = if ($args.Count -gt 0) { $args[0] } else { git rev-parse --abbrev-ref HEAD }

$url = "https://${pat}@github.com/${user}/${repo}.git"

# credential.helper= → empêche git de demander/cacher dans le Windows Credential Manager
git -c credential.helper= push $url "${branch}:${branch}"
