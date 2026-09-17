<#
  Accountant AI Operator - Local Launcher Setup (v1)

  Registers a custom URI protocol (accountant-ai-operator://) under the CURRENT USER
  (HKCU), so no Administrator rights are required. Clicking a link like
  accountant-ai-operator://launch/hisulit in the browser will run launcher.ps1
  with that URI as its argument.

  Run this once per machine/user: right-click -> "Run with PowerShell".
#>

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherScript = Join-Path $here "launcher.ps1"
$configPath = Join-Path $here "config.json"
$examplePath = Join-Path $here "config.example.json"

if (-not (Test-Path $launcherScript)) {
    throw "launcher.ps1 not found next to install.ps1 ($here). Download all files into the same folder first."
}

if (-not (Test-Path $configPath)) {
    if (Test-Path $examplePath) {
        Copy-Item $examplePath $configPath
        Write-Host "Created $configPath from the example file."
    } else {
        '{"connectors": []}' | Out-File -FilePath $configPath -Encoding utf8
        Write-Host "Created an empty $configPath."
    }
    Write-Host "IMPORTANT: edit config.json now and set the real .exe path for each installed program."
}

$protocol = "accountant-ai-operator"
$regRoot = "HKCU:\Software\Classes\$protocol"

New-Item -Path $regRoot -Force | Out-Null
Set-ItemProperty -Path $regRoot -Name "(Default)" -Value "URL:Accountant AI Operator Launcher"
New-ItemProperty -Path $regRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null

New-Item -Path "$regRoot\shell\open\command" -Force | Out-Null
$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherScript`" `"%1`""
Set-ItemProperty -Path "$regRoot\shell\open\command" -Name "(Default)" -Value $command

Write-Host "Installed. The browser will now hand off accountant-ai-operator:// links to launcher.ps1."
Write-Host "Next step: edit $configPath with the real paths to your installed accounting software."
