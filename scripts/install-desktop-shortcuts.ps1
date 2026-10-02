param([string]$DesktopDirectory = [Environment]::GetFolderPath('DesktopDirectory'))
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $PSScriptRoot 'start-desktop.vbs'
$target = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (!(Test-Path -LiteralPath (Join-Path $root 'dist\index.html'))) { throw 'Built desktop files are missing. Run the production build first.' }
$shell = New-Object -ComObject WScript.Shell
$paths = @(Join-Path $DesktopDirectory 'GitHub Stars Manager.lnk')
# Preserve the existing in-folder shortcut name rather than create another entry.
Get-ChildItem -LiteralPath $root -Filter '*.lnk' | ForEach-Object {
    $existing = $shell.CreateShortcut($_.FullName)
    if ($existing.Arguments.Contains('scripts\start-home-desktop.cjs') -or $existing.Arguments.Contains('scripts\start-desktop.vbs')) {
        $paths += $_.FullName
    }
}
foreach ($file in $paths | Select-Object -Unique) {
    $shortcut = $shell.CreateShortcut($file)
    $shortcut.TargetPath = $target
    $shortcut.Arguments = '//nologo "' + $entry + '"'
    $shortcut.WorkingDirectory = $root
    $shortcut.IconLocation = (Join-Path $root 'public\app.ico') + ',0'
    $shortcut.Description = 'GitHub Stars Manager - Personal Desktop'
    $shortcut.Save()
    Write-Output ('Updated shortcut: ' + $file)
}
