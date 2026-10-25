# Montagio on Windows:
#   powershell -ExecutionPolicy Bypass -File .\montagio.ps1 install | start | stop | status | help
# Guide: docs/INSTALL.md. The installer itself is infra/local/src/cli.ts;
# this script only checks that Node.js can run it. Windows PowerShell 5.1 or newer.

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    [Console]::Error.WriteLine('Node.js is missing: Montagio needs Node.js 22.18 or newer. Install it from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then open a new terminal.')
    exit 1
}

$version = "$(& node --version 2>$null)".Trim()
if ($version -notmatch '^v(\d+)\.(\d+)') {
    [Console]::Error.WriteLine("Node.js answered '$version': Montagio needs Node.js 22.18 or newer. Install it from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS).")
    exit 1
}
$major = [int]$Matches[1]
$minor = [int]$Matches[2]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 18)) {
    [Console]::Error.WriteLine("Node.js $version is too old: Montagio needs 22.18 or newer. Update it from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then open a new terminal.")
    exit 1
}

# The arguments go over as JSON: PowerShell 5.1 would split one that starts
# with "-" and holds a space (--dir="D:\Montagio Data") on its way to node.
$env:MONTAGIO_ARGV = ConvertTo-Json -Compress -InputObject @($args)
& node (Join-Path $PSScriptRoot 'infra\local\src\cli.ts')
$code = $LASTEXITCODE
Remove-Item Env:MONTAGIO_ARGV -ErrorAction SilentlyContinue
exit $code
