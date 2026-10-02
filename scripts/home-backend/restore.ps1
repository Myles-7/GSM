#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess = $true)]
param([Parameter(Mandatory)][string]$Backup, [Parameter(Mandatory)][string]$Destination, [string]$Root = "$env:ProgramData\GSM")
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($Destination)) { throw 'Destination must be an absolute NEW file path.' }
if (Test-Path -LiteralPath $Destination) { throw 'Destination already exists; restore never overwrites files.' }
$service = Get-Service -Name GSMBackend -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne 'Stopped') { throw 'Stop GSMBackend before restoring.' }
$configuration = Join-Path $Root 'service\GSMBackend.xml'
[xml]$serviceXml = Get-Content -LiteralPath $configuration -Raw
$node = $serviceXml.service.executable
$module = Join-Path $serviceXml.service.workingdirectory 'dist\services\backups.js'
if ($PSCmdlet.ShouldProcess($Destination, 'Verify SQLite integrity and restore backup to a new file')) {
  & $node --input-type=module -e "import {pathToFileURL} from 'node:url';const m=await import(pathToFileURL(process.argv[1]));m.restoreBackup(process.argv[2],process.argv[3]);" $module (Resolve-Path -LiteralPath $Backup).Path $Destination
  if ($LASTEXITCODE -ne 0) { throw 'Backup restore failed.' }
  Write-Output 'Verified backup restored to the new path. Match its encryption key before selecting it as DB_PATH in private backend.env.'
}
