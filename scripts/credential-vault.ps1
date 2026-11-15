param([switch]$Enroll, [string]$WorkspaceId)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class LV999Vault {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Credential {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob;
    public uint Persist; public uint AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool Write(ref Credential credential, uint flags);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr credential);
}
'@
try {
  if ($Enroll) {
    $parsedId = [guid]::Empty
    if (-not [guid]::TryParse($WorkspaceId, [ref]$parsedId)) { throw 'Invalid workspace ID' }
    $secureToken = Read-Host 'Test Workspace Internal Connection token (hidden)' -AsSecureString
    $blob = [Runtime.InteropServices.Marshal]::SecureStringToCoTaskMemUnicode($secureToken)
    try {
      $credential = New-Object LV999Vault+Credential
      $credential.Type = 1
      $credential.TargetName = 'com.rampageboo.lv999/notion/' + $parsedId.ToString().ToLowerInvariant()
      $credential.CredentialBlobSize = $secureToken.Length * 2
      $credential.CredentialBlob = $blob
      $credential.Persist = 2
      $credential.UserName = 'LV999 test connection'
      if (-not [LV999Vault]::Write([ref]$credential, 0)) { throw 'Vault write failed' }
      Write-Output 'Test token saved in Windows Credential Manager. Run CLI verify to confirm workspace identity.'
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($blob)
      $secureToken.Dispose()
    }
    exit 0
  }
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.operation -eq 'probe') {
    # Perform a read, including the expected not-found outcome, to test access to the current logon vault.
    $probePtr = [IntPtr]::Zero
    $found = [LV999Vault]::Read('com.rampageboo.lv999/vault-probe', 1, 0, [ref]$probePtr)
    $vaultError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($found) { [LV999Vault]::CredFree($probePtr) }
    @{ok=($found -or $vaultError -eq 1168)} | ConvertTo-Json -Compress
    exit 0
  }
  if ($request.operation -ne 'read' -or $request.target -notmatch '^com\.rampageboo\.lv999/notion/[0-9a-f-]{36}$') { throw 'Invalid operation' }
  $pointer = [IntPtr]::Zero
  if (-not [LV999Vault]::Read($request.target, 1, 0, [ref]$pointer)) {
    if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) { throw 'Vault unavailable' }
    @{ok=$false} | ConvertTo-Json -Compress
    exit 0
  }
  try {
    $entry = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][LV999Vault+Credential])
    $secret = [Runtime.InteropServices.Marshal]::PtrToStringUni($entry.CredentialBlob, $entry.CredentialBlobSize / 2)
    @{ok=$true; secret=$secret} | ConvertTo-Json -Compress
  } finally { [LV999Vault]::CredFree($pointer) }
} catch {
  [Console]::Error.WriteLine('Windows credential operation failed.')
  exit 1
}
