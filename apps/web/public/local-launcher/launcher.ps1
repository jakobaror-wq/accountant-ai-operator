<#
  Accountant AI Operator - Local Launcher (v1)

  Invoked automatically by Windows when the user clicks a link of the form:
    accountant-ai-operator://launch/<connectorId>

  Security note: the incoming URI is NEVER trusted to contain a file path.
  It only carries a connectorId. The actual executable path is looked up in
  the LOCAL config.json (a whitelist edited by hand on this machine), so a
  malicious web page cannot use this handler to launch an arbitrary program.
#>

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Uri
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $here "config.json"
$logPath = Join-Path $here "launcher.log"

function Write-Log {
    param([string]$Message)
    "$(Get-Date -Format o)  $Message" | Out-File -FilePath $logPath -Append -Encoding utf8
}

Write-Log "Received URI: $Uri"

try {
    if (-not (Test-Path $configPath)) {
        Write-Log "ERROR: config.json not found at $configPath. Run install.ps1 first and edit it."
        exit 1
    }

    if ($Uri -notmatch '^accountant-ai-operator://launch/([a-zA-Z0-9_-]+)') {
        Write-Log "ERROR: URI does not match the expected format: $Uri"
        exit 1
    }
    $connectorId = $Matches[1]

    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    $entry = $config.connectors | Where-Object { $_.id -eq $connectorId }

    if (-not $entry) {
        Write-Log "ERROR: no config entry for connector '$connectorId'. Add it to config.json."
        exit 1
    }

    $exePath = $entry.executablePath
    if ([string]::IsNullOrWhiteSpace($exePath) -or -not (Test-Path $exePath)) {
        Write-Log "ERROR: configured executablePath for '$connectorId' does not exist: $exePath"
        exit 1
    }

    Write-Log "Launching '$connectorId' -> $exePath"
    Start-Process -FilePath $exePath
}
catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
