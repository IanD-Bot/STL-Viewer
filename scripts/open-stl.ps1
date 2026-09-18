param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$StlPath,
  [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$StlPath = (Resolve-Path -LiteralPath $StlPath).Path
if (-not (Test-Path -LiteralPath $StlPath -PathType Leaf)) {
  throw "STL not found: $StlPath"
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not (Test-Path (Join-Path $Root "index.html"))) {
  throw "STL Viewer root not found: $Root"
}

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $py) { throw "Python is required to serve the viewer locally." }

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("stl-viewer-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
Copy-Item -Recurse -Force (Join-Path $Root "*") -Destination $tmp -ErrorAction SilentlyContinue
# Ensure model name is stable for ?file=
Copy-Item -Force $StlPath -Destination (Join-Path $tmp "model.stl")

$url = "http://127.0.0.1:$Port/index.html?file=model.stl"
Write-Host "Serving viewer + STL from $tmp"
Write-Host "Opening $url"
$proc = Start-Process -FilePath $py.Source -ArgumentList @("-m","http.server","$Port","--bind","127.0.0.1") -WorkingDirectory $tmp -PassThru
Start-Sleep -Seconds 1
Start-Process $url
Write-Host "Close this window or stop PID $($proc.Id) when finished."
Wait-Process -Id $proc.Id
