param(
  [int]$TargetPid = 22592,
  [string]$Engine = "0x2FDF020",
  [int]$IntervalMs = 250,
  [int]$Seconds = 180,
  [string]$Out = ".tmp/t0187-recheck/cellk.log"
)
# 只读采样器：每 IntervalMs 读一次若干 Engine 字段，落到 $Out（一行一次采样）。
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RPM2 {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
'@

$fields = @(
  @{ n = 'cellK';   o = 0x692E0 },
  @{ n = 'cellMax'; o = 0x692E4 },
  @{ n = 'tickNow'; o = 0x69210 },
  @{ n = 'tickBase'; o = 0x6921C },
  @{ n = 'tickInt'; o = 0x69220 },
  @{ n = 'flags';   o = 0xAAB44 },
  @{ n = 'mask';    o = 0xAAB48 },
  @{ n = 'shown';   o = 0xCA74 },
  @{ n = 'win';     o = 0x7780C },
  @{ n = 'fill';    o = 0x15280 },
  @{ n = 'follow';  o = 0x152A0 },
  @{ n = 'recBeg';  o = 0x15A54 },
  @{ n = 'recEnd';  o = 0x15A58 },
  @{ n = 'curScr';  o = 0x5D880 }
)

$h = [RPM2]::OpenProcess(0x0410, $false, $TargetPid)
if ($h -eq [IntPtr]::Zero) { Write-Error "OpenProcess(pid=$TargetPid) 失败 err=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"; exit 1 }
$base = [int64]$Engine

$sw = [Diagnostics.Stopwatch]::StartNew()
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("# pid=$TargetPid this=$Engine interval=${IntervalMs}ms fields=" + (($fields | ForEach-Object { "$($_.n)=+0x$('{0:X}' -f $_.o)" }) -join ','))
$i = 0
while ($sw.Elapsed.TotalSeconds -lt $Seconds) {
  $row = New-Object System.Text.StringBuilder
  [void]$row.Append(('t={0,7:N2}s' -f $sw.Elapsed.TotalSeconds))
  foreach ($f in $fields) {
    $buf = New-Object byte[] 4
    $r = [IntPtr]::Zero
    $ok = [RPM2]::ReadProcessMemory($h, [IntPtr]($base + [int64]$f.o), $buf, 4, [ref]$r)
    if ($ok) { $v = '0x{0:X8}' -f [BitConverter]::ToUInt32($buf, 0) } else { $v = '----' }
    [void]$row.Append(('  {0}={1}' -f $f.n, $v))
  }
  $lines.Add($row.ToString())
  $i++
  if ($lines.Count -ge 40) { Add-Content -LiteralPath $Out -Value $lines; $lines.Clear() }
  Start-Sleep -Milliseconds $IntervalMs
}
if ($lines.Count -gt 0) { Add-Content -LiteralPath $Out -Value $lines }
[void][RPM2]::CloseHandle($h)
Write-Output "done: $i samples -> $Out"
