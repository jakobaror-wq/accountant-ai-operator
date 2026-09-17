<#
  Accountant AI Operator - Local Launcher Uninstall (v1)
  Removes the accountant-ai-operator:// protocol registration for the current user.
  Does not delete config.json or launcher.log.
#>

$ErrorActionPreference = "Stop"
$protocol = "accountant-ai-operator"
$regRoot = "HKCU:\Software\Classes\$protocol"

if (Test-Path $regRoot) {
    Remove-Item -Path $regRoot -Recurse -Force
    Write-Host "Removed the accountant-ai-operator:// protocol registration."
} else {
    Write-Host "No existing registration found."
}
