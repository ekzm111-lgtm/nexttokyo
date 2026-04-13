param(
  [ValidateSet('index','admin','all')]
  [string]$Target = 'all'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$backupDir = Join-Path $root 'backup'
if (!(Test-Path $backupDir)) { throw "backup 폴더가 없습니다: $backupDir" }

function Restore-Latest($pattern, $destName) {
  $file = Get-ChildItem -Path $backupDir -File | Where-Object { $_.Name -like $pattern } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $file) {
    Write-Output "[SKIP] 패턴 '$pattern' 백업이 없습니다."
    return
  }
  Copy-Item -Path $file.FullName -Destination (Join-Path $root $destName) -Force
  Write-Output "[OK] $($file.Name) -> $destName"
}

if ($Target -in @('index','all')) {
  Restore-Latest 'index*.html' 'index.html'
}
if ($Target -in @('admin','all')) {
  Restore-Latest 'admin*.html' 'admin.html'
}
