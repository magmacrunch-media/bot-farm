# install.ps1 -- a token, and a logon task that keeps the MCP server up.
#
# Run it from anywhere; it locates the app from its own path. No elevation
# needed: the task runs as the logged-on user, which is also the only account
# that can see %APPDATA%\com.magmacrunch.bot-farm and the gh keyring the
# readings depend on. (A LocalSystem task would authenticate as nobody and
# report a farm of UNKNOWNs -- the same trap that stopped Ollama running as a
# service.)
#
#   .\install.ps1              install, loopback only
#   .\install.ps1 -Tailnet     install and expose it on the tailnet
#   .\install.ps1 -Uninstall   remove the task (the token file stays)

[CmdletBinding()]
param(
    [switch]$Tailnet,
    [switch]$Uninstall,
    [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'

$TaskName = 'MagmaCrunchBotFarmMCP'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Vbs = Join-Path $Here 'serve.vbs'
$ConfigDir = Join-Path $env:APPDATA 'com.magmacrunch.bot-farm'
$TokenFile = Join-Path $ConfigDir 'mcp-token'

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "removed $TaskName"
    } else {
        Write-Host "$TaskName was not registered"
    }
    Write-Host "the token file is left at $TokenFile"
    return
}

# ── the token ───────────────────────────────────────────────
#
# Beside herd.json and webhooks.json, for the same reason they are there: it is
# a credential, it is this machine's, and it does not belong in the repo. The
# server picks it up on its own, so it never appears on a command line where
# another process could read it off the process list.

if (-not (Test-Path $ConfigDir)) { New-Item -ItemType Directory -Path $ConfigDir | Out-Null }
if (-not (Test-Path $TokenFile)) {
    # RNGCryptoServiceProvider rather than RandomNumberGenerator::Fill, which
    # is .NET 5+ and absent from the .NET Framework behind Windows PowerShell.
    $bytes = New-Object byte[] 32
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    Set-Content -Path $TokenFile -Value $token -Encoding ascii -NoNewline
    Write-Host "wrote a new token to $TokenFile"
} else {
    $token = (Get-Content $TokenFile -Raw).Trim()
    Write-Host "keeping the token already in $TokenFile"
}

# ── the task ────────────────────────────────────────────────

$host4 = if ($Tailnet) {
    $ts = & 'C:\Program Files\Tailscale\tailscale.exe' ip -4
    if (-not $ts) { throw 'could not read the Tailscale address; is Tailscale up?' }
    $ts.Trim()
} else { '127.0.0.1' }

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f $Vbs) -WorkingDirectory $Here
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
# No ExecutionTimeLimit: OllamaServe had PT72H and Task Scheduler duly killed
# the model server every three days. Runs on battery for the same reason.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'BOT//FARM readings over MCP' | Out-Null

# The task sets nothing itself; serve.bat reads these.
[Environment]::SetEnvironmentVariable('BOT_FARM_MCP_HOST', $host4, 'User')
[Environment]::SetEnvironmentVariable('BOT_FARM_MCP_PORT', "$Port", 'User')

Write-Host ""
Write-Host "registered $TaskName -> $host4`:$Port"
Write-Host "start it now with:  Start-ScheduledTask -TaskName $TaskName"
Write-Host ""
Write-Host "the token, for the Mac's opencode.json:"
Write-Host "  $token"
if ($Tailnet) {
    Write-Host ""
    Write-Host "serving the tailnet directly needs an inbound firewall rule; run elevated:"
    Write-Host "  New-NetFirewallRule -DisplayName 'BOT FARM MCP' -Direction Inbound -Action Allow ``"
    Write-Host "    -Protocol TCP -LocalPort $Port -RemoteAddress 100.64.0.0/10"
}
