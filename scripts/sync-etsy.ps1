$ErrorActionPreference = "Continue"
Set-Location "C:\Projects\by3dxyz"

$node = $null
if (Test-Path "C:\Program Files\nodejs\node.exe") {
  $node = "C:\Program Files\nodejs\node.exe"
} else {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
}
if (-not $node) {
  Write-Error "Node.js not found"
  exit 1
}

& $node "C:\Projects\by3dxyz\scripts\catalog.mjs" etsy-sync
exit $LASTEXITCODE
