<#
.SYNOPSIS
  Says whether this window can send pm2 a command: ok, denied, none or unknown.

.DESCRIPTION
  Every pm2 command first connects to the daemon over \\.\pipe\rpc.sock. When
  that fails, pm2 starts a daemon of its own -- which cannot take over the pipe
  the old one still holds, so it lingers and does nothing -- and then fails
  with an EPERM stack trace that reads like the application crashing.

  START.bat asks this before its first pm2 command instead:

    ok       the daemon answered; pm2 commands will work
    denied   a daemon is there but refuses this window: it was started with
             administrator rights, so its pipe belongs to Administrators, and
             this window may read it but not write to it
    none     no daemon is running; the first pm2 command starts one
    unknown  the pipe is there but did not answer in time; let pm2 try

  All this does is connect and hang up; pm2 sees a client come and go. pm2
  gives the pipe the same name on every Windows machine, whatever PM2_HOME is.

.PARAMETER PipeName
  The pipe to ask. Only the tests change it.
#>
param([string]$PipeName = 'rpc.sock')

try {
    if (-not ([IO.Directory]::GetFiles('\\.\pipe\') -contains "\\.\pipe\$PipeName")) { 'none'; exit 0 }
} catch {
    # Listing pipes throws on a pipe name .NET takes for an invalid path.
    # Connecting below still gives an answer.
}

$pipe = New-Object IO.Pipes.NamedPipeClientStream('.', $PipeName, [IO.Pipes.PipeDirection]::InOut)
try {
    $pipe.Connect(2000)
    'ok'
} catch [UnauthorizedAccessException] {
    'denied'
} catch {
    'unknown'
} finally {
    $pipe.Dispose()
}
