#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  [Parameter(Mandatory)][ValidateSet('Install','Update','Start','Stop','Restart','Status','Uninstall')][string]$Action,
  [string]$Root = "$env:ProgramData\GSM",
  [string]$ReleasePath,
  [string]$NodePath,
  [string]$ExpectedNodeVersion,
  [string]$NodeSha256,
  [string]$WinSWPath,
  [string]$WinSWSha256,
  [ValidateRange(1,65535)][int]$Port = 3000
)
$ErrorActionPreference = 'Stop'
$serviceId = 'GSMBackend'
if (-not [IO.Path]::IsPathRooted($Root)) { throw 'Root must be an absolute path.' }
$Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
if ($Root -match '["\r\n]') { throw 'Root must not contain quotation marks or newlines.' }
if ($Root -eq [IO.Path]::GetPathRoot($Root).TrimEnd('\')) { throw 'Root must not be a drive root.' }
$wrapper = Join-Path $Root 'service\GSMBackend.exe'
$xmlPath = Join-Path $Root 'service\GSMBackend.xml'
$envPath = Join-Path $Root 'credentials\backend.env'
$existing = Get-CimInstance Win32_Service -Filter "Name='$serviceId'"
if ($existing -and $existing.PathName.Trim('"') -ne $wrapper) { throw 'GSMBackend belongs to another executable. Refusing to modify it.' }
if ($Action -eq 'Status') {
  if ($existing) { $existing | Select-Object Name, State, StartMode, StartName, ProcessId }
  else { Write-Output 'GSMBackend is not installed.' }
  return
}
if (-not $PSCmdlet.ShouldProcess($Root, "$Action GSMBackend (LocalService; persistent data retained)")) { return }
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this service management command from an elevated PowerShell.' }

function Invoke-Wrapper([string]$Command) {
  & $wrapper $Command
  if ($LASTEXITCODE -ne 0) { throw "WinSW $Command failed with exit code $LASTEXITCODE" }
}
function Wait-State([string]$State) {
  (Get-Service $serviceId).WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::$State, [TimeSpan]::FromSeconds(45))
}
function Test-Port([int]$Number) {
  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Number)
  try { $listener.Start() } catch { throw "Loopback port $Number is unavailable. No process was terminated." } finally { $listener.Stop() }
}
function Assert-Hash([string]$File, [string]$Expected) {
  if ($Expected -notmatch '^[a-fA-F0-9]{64}$') { throw 'Provide the SHA-256 from the trusted release manifest for each supplied runtime executable.' }
  if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $Expected) { throw 'Executable SHA-256 mismatch.' }
}
function Protect-Directory([string]$Directory, [string]$ServiceRights) {
  New-Item -ItemType Directory -Path $Directory -Force | Out-Null
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($entry in @(@('S-1-5-18','FullControl'), @('S-1-5-32-544','FullControl'), @('S-1-5-19',$ServiceRights))) {
    $sid = New-Object Security.Principal.SecurityIdentifier($entry[0])
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, $entry[1], 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Directory -AclObject $acl
}
function Protect-File([string]$File) {
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($entry in @(@('S-1-5-18','FullControl'), @('S-1-5-32-544','FullControl'), @('S-1-5-19','ReadAndExecute'))) {
    $sid = New-Object Security.Principal.SecurityIdentifier($entry[0])
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, $entry[1], 'Allow')))
  }
  Set-Acl -LiteralPath $File -AclObject $acl
}
function Read-ServicePort {
  $line = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^PORT=\d+$' } | Select-Object -First 1
  if (-not $line) { throw 'Service PORT missing from private backend.env.' }
  return [int]$line.Substring(5)
}
function Test-Health([int]$Number, [string]$Version = '') {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Number/api/health" -TimeoutSec 2
      if ($health.status -eq 'ok' -and (-not $Version -or $health.version -eq $Version)) { return }
    } catch { }
    Start-Sleep -Seconds 1
  }
  throw 'Service health check failed. Inspect the private service logs; retain the pre-migration backup before rollback.'
}
if ($Action -in @('Start','Stop','Restart','Uninstall')) {
  if (-not $existing) { throw 'GSMBackend is not installed.' }
  if ($Action -in @('Stop','Restart','Uninstall') -and $existing.State -ne 'Stopped') { Invoke-Wrapper 'stop'; Wait-State 'Stopped' }
  if ($Action -eq 'Uninstall') { Invoke-Wrapper 'uninstall'; Write-Output 'Service removed. Releases, logs, credentials, database and backups are retained.'; return }
  if ($Action -in @('Start','Restart')) {
    if ($Action -eq 'Start' -and $existing.State -eq 'Running') { Test-Health (Read-ServicePort); return }
    Test-Port (Read-ServicePort)
    Invoke-Wrapper 'start'; Wait-State 'Running'; Test-Health (Read-ServicePort)
  }
  return
}
if ($Action -eq 'Install' -and $existing) { throw 'Service already installed; use Update.' }
if ($Action -eq 'Update' -and -not $existing) { throw 'Service not installed; use Install.' }
foreach ($required in @($ReleasePath,$NodePath,$ExpectedNodeVersion,$NodeSha256)) { if (-not $required) { throw 'ReleasePath, NodePath, ExpectedNodeVersion and NodeSha256 are required.' } }
$ReleasePath = (Resolve-Path -LiteralPath $ReleasePath).Path
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
if ($ReleasePath.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Release source must be outside the deployment root.' }
foreach ($relative in @('server\dist\index.js','server\package.json','server\node_modules\better-sqlite3\package.json')) {
  if (-not (Test-Path -LiteralPath (Join-Path $ReleasePath $relative))) { throw "Release is incomplete: missing $relative" }
}
if (Get-ChildItem -LiteralPath $ReleasePath -Force -Recurse | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Select-Object -First 1) { throw 'Release artifacts must not contain symlinks or junctions.' }
Assert-Hash $NodePath $NodeSha256
$nodeVersion = (& $NodePath --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne $ExpectedNodeVersion -or $nodeVersion -notmatch '^v(2[2-9]|[3-9][0-9])\.') { throw 'Node version must match the exact expected version and be Node 22 or newer.' }
$package = Get-Content -LiteralPath (Join-Path $ReleasePath 'server\package.json') -Raw | ConvertFrom-Json
if ($package.version -notmatch '^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$') { throw 'Invalid server package version.' }
if ($Action -eq 'Install') {
  if (-not $WinSWPath) { throw 'Install requires a supplied WinSW 2.12.0 executable and its trusted SHA-256.' }
  Assert-Hash $WinSWPath $WinSWSha256
  $wrapperVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo((Resolve-Path -LiteralPath $WinSWPath).Path).ProductVersion
  if ($wrapperVersion -notmatch '^2\.12\.0([.+-]|$)') { throw 'This service configuration is pinned to WinSW 2.12.0.' }
  Test-Port $Port
}
# Executable and credentials directories are immutable to LocalService; only data/logs are writable.
Protect-Directory $Root 'ReadAndExecute'
foreach ($name in @('service','releases','credentials','keys')) { Protect-Directory (Join-Path $Root $name) 'ReadAndExecute' }
foreach ($name in @('data','logs')) { Protect-Directory (Join-Path $Root $name) 'Modify' }
$release = Join-Path $Root ("releases\" + $package.version + '-' + (Get-Date -Format 'yyyyMMddHHmmssfff'))
New-Item -ItemType Directory -Path $release | Out-Null
Copy-Item -Path (Join-Path $ReleasePath '*') -Destination $release -Recurse
New-Item -ItemType Directory -Path (Join-Path $release 'runtime') -Force | Out-Null
Copy-Item -LiteralPath $NodePath -Destination (Join-Path $release 'runtime\node.exe')
# Native bindings must be built on Windows for the exact Node runtime used by the service.
& (Join-Path $release 'runtime\node.exe') -e "const D=require(process.argv[1]);const d=new D(':memory:');d.close()" (Join-Path $release 'server\node_modules\better-sqlite3')
if ($LASTEXITCODE -ne 0) { throw 'Native SQLite binding preflight failed. Build dependencies with the pinned runtime on Windows.' }
if ($Action -eq 'Install') {
  Copy-Item -LiteralPath $WinSWPath -Destination $wrapper -Force
  if (-not (Test-Path -LiteralPath $envPath)) {
    $random = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random); $secret = -join ($random | ForEach-Object { $_.ToString('x2') }); $rng.GetBytes($random); $key = -join ($random | ForEach-Object { $_.ToString('x2') }) } finally { $rng.Dispose() }
    $keyPath = Join-Path $Root 'keys\encryption.key'
    if (-not (Test-Path -LiteralPath $keyPath)) { [IO.File]::WriteAllText($keyPath, $key) }
    # Forward slashes prevent dotenv's quoted-string backslash escape processing.
    $dataValue = (Join-Path $Root 'data').Replace('\','/')
    $keyValue = $keyPath.Replace('\','/')
    $environment = "NODE_ENV=production`nHOST=127.0.0.1`nPORT=$Port`nDATA_DIR=`"$dataValue`"`nENCRYPTION_KEY_FILE=`"$keyValue`"`nAPI_SECRET=$secret`n"
    [IO.File]::WriteAllText($envPath, $environment, (New-Object Text.UTF8Encoding($false)))
    $secret = $null; $key = $null; $environment = $null
  }
}
Protect-File $envPath
$managedKey = Join-Path $Root 'keys\encryption.key'
if (Test-Path -LiteralPath $managedKey) { Protect-File $managedKey }
function Xml([string]$Value) { return [Security.SecurityElement]::Escape($Value) }
$nodeXml = Xml (Join-Path $release 'runtime\node.exe')
$workXml = Xml (Join-Path $release 'server')
$envXml = Xml $envPath
$logsXml = Xml (Join-Path $Root 'logs')
$xml = @"
<service>
  <id>GSMBackend</id><name>GSM Backend</name><description>GSM standalone local backend</description>
  <executable>$nodeXml</executable>
  <arguments>--env-file=&quot;$envXml&quot; dist/index.js</arguments>
  <workingdirectory>$workXml</workingdirectory>
  <serviceaccount><domain>NT AUTHORITY</domain><user>LocalService</user></serviceaccount>
  <startmode>Automatic</startmode><delayedAutoStart>true</delayedAutoStart>
  <stoptimeout>30sec</stoptimeout>
  <onfailure action="restart" delay="15 sec"/><onfailure action="restart" delay="30 sec"/><onfailure action="restart" delay="60 sec"/>
  <resetfailure>1 hour</resetfailure>
  <logpath>$logsXml</logpath><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>8</keepFiles></log>
</service>
"@
if ($Action -eq 'Update') {
  if ($existing.State -ne 'Stopped') { Invoke-Wrapper 'stop'; Wait-State 'Stopped' }
  Test-Port (Read-ServicePort)
  Copy-Item -LiteralPath $xmlPath -Destination ($xmlPath + '.previous') -Force
}
[IO.File]::WriteAllText($xmlPath, $xml, (New-Object Text.UTF8Encoding($false)))
if ($Action -eq 'Install') { Invoke-Wrapper 'install' }
Invoke-Wrapper 'start'; Wait-State 'Running'; Test-Health (Read-ServicePort) $package.version
Write-Output "GSMBackend $($package.version) is healthy on loopback. Credentials are stored privately; no secrets were printed."
