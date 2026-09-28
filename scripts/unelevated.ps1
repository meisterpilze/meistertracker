<#
.SYNOPSIS
  Runs a cmd.exe command line as this user, but without administrator rights.

.DESCRIPTION
  START.bat hands itself to this script when it finds itself elevated, so that
  pm2 -- its daemon, the daemon's pipe and the server it starts -- never holds
  an administrator token.

  The boot task is why that matters. It runs START.bat through an S4U logon,
  and Windows does not apply a task's RunLevel to S4U: registered Limited, the
  boot run still gets the full administrator token. Everything pm2 starts
  inherits it, so after every restart the next START.bat, from an ordinary
  window, could neither stop the server nor talk to pm2.

  The child gets a restricted copy of this process's token: Administrators set
  to deny-only, every privilege but one removed, medium integrity. It also gets
  the owner and default DACL an ordinary window's token has, and that part is
  what makes the result reachable. A process takes its DACL from the default
  DACL of the token that creates it; a named pipe gives full access to that
  token's owner and read access to everyone else. An administrator token names
  Administrators in both places -- the pipe pm2 opens at boot is owned by
  Administrators -- and an ordinary window holds Administrators only as
  deny-only. It could read pm2's pipe, but not send pm2 a command.

  The command comes from the environment variable UNELEVATED_ARGS, as the
  arguments for cmd.exe. A parameter would not survive: powershell.exe parses
  its own command line first, and the nested quotes of a cmd /c line do not
  come through that intact.

  When rights cannot be dropped, the command runs with them and says so, here
  and in %TEMP%\meistertracker-unelevated.log. A server that starts with the
  wrong rights beats one that does not start after a reboot.

.PARAMETER Force
  Drop rights even when there are none to drop. The tests run unelevated and
  use this to exercise the real path.
#>
param([switch]$Force)

$ErrorActionPreference = 'Stop'

$log = Join-Path $env:TEMP 'meistertracker-unelevated.log'
function Write-Log([string]$Text) {
    try { Add-Content -LiteralPath $log -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Text) } catch { }
}

# Exit codes are 32 bits; an NTSTATUS such as 0xC0000142 does not fit an [int].
function Exit-With([uint32]$Code) {
    exit [BitConverter]::ToInt32([BitConverter]::GetBytes($Code), 0)
}

$cmdArgs = $env:UNELEVATED_ARGS
if (-not $cmdArgs) {
    [Console]::Error.WriteLine('unelevated.ps1: UNELEVATED_ARGS is empty, nothing to run.')
    exit 1
}
$comspec = if ($env:ComSpec) { $env:ComSpec } else { Join-Path $env:SystemRoot 'System32\cmd.exe' }

# Start-Process -Wait is no use here: it waits for every descendant, and pm2's
# daemon is one that never exits.
function Invoke-AsIs {
    $info = New-Object Diagnostics.ProcessStartInfo($comspec, $cmdArgs)
    $info.UseShellExecute = $false
    $process = [Diagnostics.Process]::Start($info)
    $process.WaitForExit()
    return [uint32]$process.ExitCode
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $Force) {
    Exit-With (Invoke-AsIs)
}

$source = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

public static class MeistertrackerUnelevated
{
    [StructLayout(LayoutKind.Sequential)]
    struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

    const uint TOKEN_ASSIGN_PRIMARY = 0x0001, TOKEN_DUPLICATE = 0x0002, TOKEN_QUERY = 0x0008, TOKEN_ADJUST_DEFAULT = 0x0080;
    const uint DISABLE_MAX_PRIVILEGE = 0x1, LUA_TOKEN = 0x4;
    const int TokenUser = 1, TokenGroups = 2, TokenOwner = 4, TokenDefaultDacl = 6, TokenIntegrityLevel = 25;
    const uint SE_GROUP_LOGON_ID = 0xC0000000, SE_GROUP_INTEGRITY = 0x20;
    const int STARTF_USESTDHANDLES = 0x100, HANDLE_FLAG_INHERIT = 0x1;
    const int GENERIC_ALL = 0x10000000;
    const int GENERIC_READ_EXECUTE = unchecked((int)0xA0000000);
    const uint INFINITE = 0xFFFFFFFF;

    // What UAC turns into deny-only for an administrator's ordinary window:
    // Administrators, and "Local account and member of Administrators".
    static readonly string[] AdministrativeGroups = { "S-1-5-32-544", "S-1-5-114" };
    const string MediumIntegrity = "S-1-16-8192";

    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll")] static extern bool SetHandleInformation(IntPtr handle, int mask, int flags);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr info, int length, out int returned);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool SetTokenInformation(IntPtr token, int infoClass, IntPtr info, int length);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool CreateRestrictedToken(IntPtr existing, uint flags,
        int disableCount, SID_AND_ATTRIBUTES[] sidsToDisable,
        int deleteCount, IntPtr privilegesToDelete,
        int restrictCount, IntPtr sidsToRestrict, out IntPtr restricted);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessAsUser(IntPtr token, string application, StringBuilder commandLine,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags,
        IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInfo);

    // Runs application with arguments under a standard-user copy of this
    // process's token, in this console, and returns its exit code.
    public static uint Run(string application, string arguments, string directory)
    {
        IntPtr self = IntPtr.Zero, restricted = IntPtr.Zero;
        var unmanaged = new List<IntPtr>();
        try
        {
            if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT, out self))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcessToken");
            SecurityIdentifier user = ReadUser(self);
            SecurityIdentifier logon = ReadLogonSid(self);

            var disable = new SID_AND_ATTRIBUTES[AdministrativeGroups.Length];
            for (int i = 0; i < disable.Length; i++)
                disable[i].Sid = Copy(new SecurityIdentifier(AdministrativeGroups[i]), unmanaged);
            if (!CreateRestrictedToken(self, DISABLE_MAX_PRIVILEGE | LUA_TOKEN, disable.Length, disable,
                    0, IntPtr.Zero, 0, IntPtr.Zero, out restricted))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateRestrictedToken");

            SetIntegrity(restricted, new SecurityIdentifier(MediumIntegrity));
            // The owner is what pm2's pipe grants full access to.
            SetPointer(restricted, TokenOwner, Copy(user, unmanaged), "TokenOwner");
            SetPointer(restricted, TokenDefaultDacl, Copy(DefaultDacl(user, logon), unmanaged), "TokenDefaultDacl");

            // The child writes to this console and reads this stdin -- which is
            // NUL when the boot task runs START.bat, so its closing pause returns.
            var startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            startup.dwFlags = STARTF_USESTDHANDLES;
            startup.hStdInput = Inheritable(GetStdHandle(-10));
            startup.hStdOutput = Inheritable(GetStdHandle(-11));
            startup.hStdError = Inheritable(GetStdHandle(-12));

            PROCESS_INFORMATION child;
            var commandLine = new StringBuilder("\"" + application + "\" " + arguments);
            if (!CreateProcessAsUser(restricted, application, commandLine, IntPtr.Zero, IntPtr.Zero, true, 0,
                    IntPtr.Zero, directory, ref startup, out child))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessAsUser");
            CloseHandle(child.hThread);
            try
            {
                WaitForSingleObject(child.hProcess, INFINITE);
                uint code;
                if (!GetExitCodeProcess(child.hProcess, out code))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "GetExitCodeProcess");
                return code;
            }
            finally { CloseHandle(child.hProcess); }
        }
        finally
        {
            foreach (IntPtr p in unmanaged) Marshal.FreeHGlobal(p);
            if (restricted != IntPtr.Zero) CloseHandle(restricted);
            if (self != IntPtr.Zero) CloseHandle(self);
        }
    }

    // What LSA gives an ordinary window's token: the user and SYSTEM in full,
    // the logon session read and execute. An administrator token names
    // Administrators where this names the user.
    static byte[] DefaultDacl(SecurityIdentifier user, SecurityIdentifier logon)
    {
        var acl = new RawAcl(GenericAcl.AclRevision, 3);
        acl.InsertAce(acl.Count, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, GENERIC_ALL, user, false, null));
        acl.InsertAce(acl.Count, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, GENERIC_ALL,
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), false, null));
        if (logon != null)
            acl.InsertAce(acl.Count, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, GENERIC_READ_EXECUTE, logon, false, null));
        var bytes = new byte[acl.BinaryLength];
        acl.GetBinaryForm(bytes, 0);
        return bytes;
    }

    static SecurityIdentifier ReadUser(IntPtr token)
    {
        IntPtr buffer = Query(token, TokenUser);
        try { return new SecurityIdentifier(Marshal.ReadIntPtr(buffer)); }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    // The group marked SE_GROUP_LOGON_ID names this logon session.
    static SecurityIdentifier ReadLogonSid(IntPtr token)
    {
        IntPtr buffer = Query(token, TokenGroups);
        try
        {
            // TOKEN_GROUPS: a DWORD count, then the array, aligned to a pointer.
            int count = Marshal.ReadInt32(buffer);
            int size = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
            for (int i = 0; i < count; i++)
            {
                var group = (SID_AND_ATTRIBUTES)Marshal.PtrToStructure(
                    new IntPtr(buffer.ToInt64() + IntPtr.Size + i * size), typeof(SID_AND_ATTRIBUTES));
                if ((group.Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID)
                    return new SecurityIdentifier(group.Sid);
            }
            return null;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    static IntPtr Query(IntPtr token, int infoClass)
    {
        int length;
        GetTokenInformation(token, infoClass, IntPtr.Zero, 0, out length);
        IntPtr buffer = Marshal.AllocHGlobal(length);
        if (!GetTokenInformation(token, infoClass, buffer, length, out length))
        {
            int error = Marshal.GetLastWin32Error();
            Marshal.FreeHGlobal(buffer);
            throw new Win32Exception(error, "GetTokenInformation");
        }
        return buffer;
    }

    // TOKEN_MANDATORY_LABEL, with its SID in the same allocation: the length
    // passed covers both, as the documented example does.
    static void SetIntegrity(IntPtr token, SecurityIdentifier level)
    {
        int size = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
        var sid = new byte[level.BinaryLength];
        level.GetBinaryForm(sid, 0);
        IntPtr buffer = Marshal.AllocHGlobal(size + sid.Length);
        try
        {
            Marshal.Copy(sid, 0, new IntPtr(buffer.ToInt64() + size), sid.Length);
            var label = new SID_AND_ATTRIBUTES();
            label.Sid = new IntPtr(buffer.ToInt64() + size);
            label.Attributes = SE_GROUP_INTEGRITY;
            Marshal.StructureToPtr(label, buffer, false);
            if (!SetTokenInformation(token, TokenIntegrityLevel, buffer, size + sid.Length))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "TokenIntegrityLevel");
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    // TOKEN_OWNER and TOKEN_DEFAULT_DACL are each a single pointer.
    static void SetPointer(IntPtr token, int infoClass, IntPtr value, string what)
    {
        IntPtr holder = Marshal.AllocHGlobal(IntPtr.Size);
        try
        {
            Marshal.WriteIntPtr(holder, value);
            if (!SetTokenInformation(token, infoClass, holder, IntPtr.Size))
                throw new Win32Exception(Marshal.GetLastWin32Error(), what);
        }
        finally { Marshal.FreeHGlobal(holder); }
    }

    static IntPtr Copy(SecurityIdentifier sid, List<IntPtr> unmanaged)
    {
        var bytes = new byte[sid.BinaryLength];
        sid.GetBinaryForm(bytes, 0);
        return Copy(bytes, unmanaged);
    }

    static IntPtr Copy(byte[] bytes, List<IntPtr> unmanaged)
    {
        IntPtr p = Marshal.AllocHGlobal(bytes.Length);
        unmanaged.Add(p);
        Marshal.Copy(bytes, 0, p, bytes.Length);
        return p;
    }

    static IntPtr Inheritable(IntPtr handle)
    {
        if (handle != IntPtr.Zero && handle != new IntPtr(-1))
            SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
        return handle;
    }
}
'@

# STATUS_DLL_INIT_FAILED: the child was created but could not attach to this
# window station or console. Nothing of the command ran, so it is safe -- and
# necessary, at boot -- to run it again with the rights it has.
$initFailed = [uint32]3221225794

try {
    Add-Type -TypeDefinition $source -Language CSharp
    $code = [MeistertrackerUnelevated]::Run($comspec, $cmdArgs, (Get-Location).Path)
    if ($code -ne $initFailed) {
        Write-Log "ran as a standard user, exit $code"
        Exit-With $code
    }
    $reason = 'the child could not start (0xC0000142)'
} catch {
    $reason = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }
}

[Console]::Error.WriteLine("WARNING: could not drop administrator rights: $reason")
[Console]::Error.WriteLine('         Running with them; pm2 will be out of reach of an ordinary window.')
$code = Invoke-AsIs
Write-Log "could not drop administrator rights ($reason); ran with them, exit $code"
Exit-With $code
