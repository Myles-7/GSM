#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess = $true)]
param([ValidateRange(1,65535)][int]$Port = 3000, [string]$TailscalePath = "$env:ProgramFiles\Tailscale\tailscale.exe")
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $TailscalePath)) { throw 'Install Tailscale from its official signed Windows installer, then authenticate interactively before running this script.' }
if ($PSCmdlet.ShouldProcess('Tailscale', "Enable unattended mode and persistent tailnet HTTPS Serve for loopback port $Port")) {
  & $TailscalePath set --unattended=true
  if ($LASTEXITCODE -ne 0) { throw 'Could not enable unattended mode.' }
  & $TailscalePath serve --bg "http://127.0.0.1:$Port"
  if ($LASTEXITCODE -ne 0) { throw 'Serve setup failed. Follow Tailscale HTTPS enablement instructions, then retry.' }
  & $TailscalePath serve status
  if ($LASTEXITCODE -ne 0) { throw 'Could not read Serve status.' }
}
