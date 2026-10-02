#Requires -Version 5.1
param([Parameter(Mandatory)][string]$UpgradeScript)
$ErrorActionPreference='Stop'
$scriptPath=(Resolve-Path -LiteralPath $UpgradeScript).Path
if($scriptPath.Contains('"')){throw 'Invalid upgrade script path.'}
try {
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$scriptPath+'"')) -Wait
  $result=Get-Content -LiteralPath (Join-Path (Split-Path -Parent $scriptPath) 'mobile-simplified-upgrade-result.json') -Raw | ConvertFrom-Json
  Write-Host $result.state
  if($result.state -ne 'complete'){throw $result.error}
} catch {Write-Host $_.Exception.Message;exit 1}
