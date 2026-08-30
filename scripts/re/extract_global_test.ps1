# Approach-B prototype: locate the Command VM `this` object in a RUNNING process via
# the opcode dispatch-table fingerprint at `this + 0x0A509C`, then read global data.
#
# 依赖「相对关系」(RVA)，不写死绝对地址：signature 用 handler 的 RVA (VA - preferred_base 0x400000)，
# 运行时用 module_base + RVA 算出期望指针值 → 兼容 ASLR；若加壳进程解包后布局不变也可复用。
#
# 只「检查」已运行的进程，不自动启动游戏。用 -Pid 指定目标进程，或用 -ProcessName 按名字找。
#
# Usage:
#   pwsh -File .tmp/extract_global_test.ps1 -ProcId 1234                   # 检查指定 PID
#   pwsh -File .tmp/extract_global_test.ps1 -ProcId 1234 -Unit 140         # 解码 unitId=140 的掉落 rate/item
#   pwsh -File .tmp/extract_global_test.ps1 -ProcessName 天结_unpacked     # 按进程名找
param(
    [int]$ProcId,
    [string]$ProcessName,
    [int]$Unit = 140,
    [int]$To = -1,   # if >0, dump drop data for units [Unit..To]
    [string]$SignatureJson = '.tmp/dispatch_signature.json'
)

$ErrorActionPreference = 'Stop'

# ---- Win32 P/Invoke ----
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32Mem {
    [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, [Out] byte[] buf, int size, out IntPtr read);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool VirtualQueryEx(IntPtr h, IntPtr addr, out MEMORY_BASIC_INFORMATION mbi, int len);
    [DllImport("psapi.dll", SetLastError=true)] public static extern bool EnumProcessModules(IntPtr h, [Out] IntPtr[] mods, int cb, out int needed);
    [DllImport("psapi.dll", SetLastError=true)] public static extern bool GetModuleFileNameEx(IntPtr h, IntPtr mod, StringBuilder sb, int size);
    [StructLayout(LayoutKind.Sequential)]
    public struct MEMORY_BASIC_INFORMATION {
        public IntPtr BaseAddress;
        public IntPtr AllocationBase;
        public uint AllocationProtect;
        public IntPtr RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }
}
'@

# ---- Constants ----
$PROCESS_QUERY_INFORMATION = 0x0400
$PROCESS_VM_READ           = 0x0010
$MEM_COMMIT  = 0x1000
$PREFERRED   = 0x400000
$TBL_OFFSET  = 0x0A509C   # this + 0x0A509C = dispatch table start (opcode 0)
$BASE_INT    = 0x5D800    # this + 0x5D800 = global_int base pointer
$KEY_OFF     = 0x5EC8C    # this + 0x5EC8C = decode key
$RATE_BASE   = 0x53E104   # VM index of rate array base (drop data)
$ITEM_BASE   = 0x53CD7C   # VM index of item array base (drop data)
$SLOTS       = 5

# ---- Rotation helpers (DEC for 32-bit reads) ----
# NOTE: use the Int64 literal 0xFFFFFFFFL, NOT [int64]0xFFFFFFFF (that becomes -1 and breaks the -band mask)
$M32 = 0xFFFFFFFFL
function ROL4([int64]$v,[int]$n){ $v=($v -band $M32); $n=$n%32; if($n -lt 0){$n+=32}; if($n -eq 0){return $v}; $r=(($v -shl $n) -band $M32); $r=$r -bor ($v -shr (32-$n)); return ($r -band $M32) }
function ROR4([int64]$v,[int]$n){ $v=($v -band $M32); $n=$n%32; if($n -lt 0){$n+=32}; if($n -eq 0){return $v}; $r=($v -shr $n); $r=$r -bor ((($v -shl (32-$n))) -band $M32); return ($r -band $M32) }
function DEC([int64]$x,[int64]$key){ $a = (($key -bxor (ROL4 $x 11)) -band $M32); return (ROR4 $a 25) }
function U32([byte[]]$b,[int]$off){ return ([int64]$b[$off] -bor ([int64]$b[$off+1] -shl 8) -bor ([int64]$b[$off+2] -shl 16) -bor ([int64]$b[$off+3] -shl 24)) }

# ---- Load signature ----
$sig = (Get-Content -LiteralPath $SignatureJson -Raw | ConvertFrom-Json).samples
$sigMap = @{}   # op -> handler VA
foreach($s in $sig){ $sigMap[[int]$s.op] = [Convert]::ToInt64(($s.va.Substring(2)),16) }
$sampleOps = @($sigMap.Keys | Sort-Object)
$anchorOp = 0x50
$anchorExpected = $null  # module_base + (VA - PREFERRED)

# ---- Resolve target process (by -ProcId, or by -ProcessName) ----
$proc = $null
if($ProcId -gt 0){ $proc = Get-Process -Id $ProcId -ErrorAction SilentlyContinue }
elseif($ProcessName){ $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1 }
if(-not $proc){
  Write-Warning "Target process not found. Provide -ProcId <id> or -ProcessName <name> of a RUNNING process."
  exit 1
}
$pidv = $proc.Id
Write-Host "Target process : $($proc.ProcessName)  PID=$pidv"

$hProc = [Win32Mem]::OpenProcess(($PROCESS_QUERY_INFORMATION -bor $PROCESS_VM_READ), $false, $pidv)
if($hProc -eq [IntPtr]::Zero){ Write-Warning "OpenProcess failed (error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"; exit 2 }
try{

  # ---- Enumerate modules, find module base for the main image ----
  $mods = New-Object 'System.IntPtr[]' 1024
  $needed = 0
  if(-not [Win32Mem]::EnumProcessModules($hProc, $mods, ($mods.Length*[IntPtr]::Size), [ref]$needed)){ Write-Warning "EnumProcessModules failed"; }
  $moduleBase = [IntPtr]::Zero
  $sb = New-Object System.Text.StringBuilder 260
  $modBases = [System.Collections.Generic.List[System.IntPtr]]::new()
  foreach($m in $mods){
    if($m -eq [IntPtr]::Zero){ break }
    $modBases.Add($m)
  }
  # pick the one whose name matches our target, else the first
  foreach($m in $modBases){
    [void]$sb.Clear()
    if([Win32Mem]::GetModuleFileNameEx($hProc,$m,$sb,260)){
      $name = [System.IO.Path]::GetFileName($sb.ToString())
      if($name -match [regex]::Escape($ProcessName)){ $moduleBase = $m; Write-Host "Module base : 0x$('{0:X}' -f $m.ToInt64())  ($name)"; break }
    }
  }
  if($moduleBase -eq [IntPtr]::Zero){ $moduleBase = $modBases[0]; Write-Host "Module base (first) : 0x$('{0:X}' -f $moduleBase.ToInt64())" }
  $mb = $moduleBase.ToInt64()
  if($mb -eq 0){ Write-Warning "Could not determine module base"; exit 3 }

  $anchorExpected = $mb + ($sigMap[$anchorOp] - $PREFERRED)
  Write-Host ("Anchor (op 0x50 add) expected ptr = 0x{0:X}" -f $anchorExpected)

  # ---- Scan readable committed regions for the signature ----
  $addr = [IntPtr]::Zero
  $foundThis = [int64]0
  $regionCount = 0
  $stop = $false
  $maxRegion = 64MB
  $inModuleLo = $mb + 0x1000
  $inModuleHi = $mb + 0x100000   # .text span; anchors point into module -> quick reject
  while($true){
    if($stop){ break }
    $mbi = New-Object Win32Mem+MEMORY_BASIC_INFORMATION
    $len = [Runtime.InteropServices.Marshal]::SizeOf($mbi)
    if(-not [Win32Mem]::VirtualQueryEx($hProc, $addr, [ref]$mbi, $len)){ break }
    $regionSize = $mbi.RegionSize.ToInt64()
    $regionBase = $mbi.BaseAddress.ToInt64()
    if($regionSize -le 0){ break }
    $nextAddr = $regionBase + $regionSize
    if($nextAddr -le $addr.ToInt64()){ $nextAddr = $addr.ToInt64() + 0x1000 }  # guard against non-advancing
    $regionCount++
    $prot = $mbi.Protect -band 0x0FF
    $isNoAccess = ($prot -eq 0x01)
    if($mbi.State -eq $MEM_COMMIT -and (-not $isNoAccess) -and (($mbi.Protect -band 0x100) -eq 0) -and $regionSize -lt $maxRegion -and $regionSize -gt 0x1000){
      $buf = New-Object byte[] ($regionSize)
      $read = [IntPtr]::Zero
      if([Win32Mem]::ReadProcessMemory($hProc, [IntPtr]$regionBase, $buf, [int]$regionSize, [ref]$read)){
        $nRead = $read.ToInt64()
        for($o=0; $o -le ($nRead-4); $o+=4){
          if((U32 $buf $o) -eq $anchorExpected){
            $tableStart = $o - 4*$anchorOp
            if($tableStart -lt 0){ continue }
            $ok = $true
            foreach($op in $sampleOps){
              $e = $mb + ($sigMap[$op] - $PREFERRED)
              if((U32 $buf ($tableStart + 4*$op)) -ne $e){ $ok = $false; break }
            }
            if($ok){
              $absTable = $regionBase + $tableStart
              $thisAddr = $absTable - $TBL_OFFSET
              Write-Host ("  [MATCH] dispatch table at region 0x{0:X} this=0x{1:X}" -f $absTable,$thisAddr)
              if($foundThis -eq 0){ $foundThis = $thisAddr; $stop = $true; break }   # singleton: first full match is enough
            }
          }
        }
      }
    }
    if($nextAddr -le $regionBase){ break }
    $addr = [IntPtr]$nextAddr
    if($regionCount -gt 200000){ Write-Host "  (scan cap reached)"; break }
  }
  Write-Host "Scanned $regionCount regions"
  if($foundThis -eq 0){ Write-Warning "Dispatch-table signature not found. Is the interpreter initialized / is this the right build?"; return }

  # ---- Follow the pointers ----
  function ReadP([int64]$a){
    $b = New-Object byte[] 4
    $r = [IntPtr]::Zero
    if([Win32Mem]::ReadProcessMemory($hProc, [IntPtr]$a, $b, 4, [ref]$r)){ return (U32 $b 0) }
    return -1
  }
  $globalIntBase = ReadP ($foundThis + $BASE_INT)
  $key = ReadP ($foundThis + $KEY_OFF)
  Write-Host ("this            : 0x{0:X}" -f $foundThis)
  Write-Host ("global_int_base : 0x{0:X}" -f $globalIntBase)
  Write-Host ("decode key      : 0x{0:X}" -f $key)

  # ---- Decode drop data (units in [Unit..To], default one unit) ----
  $last = if($To -ge $Unit){ $To } else { $Unit }
  Write-Host ("---- drop data (rate index=0x{0:X}, item index=0x{1:X}; unitId x {2} slot; rate_value/100 = count) ----" -f $RATE_BASE,$ITEM_BASE,$SLOTS)
  for($u=$Unit; $u -le $last; $u++){
    $line = ("unit {0,4}: " -f $u)
    for($slot=0; $slot -lt $SLOTS; $slot++){
      $idx = $u*$SLOTS + $slot
      $rateRaw = ReadP ($globalIntBase + ($RATE_BASE + $idx)*4)
      $itemRaw = ReadP ($globalIntBase + ($ITEM_BASE + $idx)*4)
      $rate = if($rateRaw -eq -1){ -1 } else { DEC $rateRaw $key }
      $item = if($itemRaw -eq -1){ -1 } else { DEC $itemRaw $key }
      $line += ("  S{0}:{1}/{2}" -f $slot, $item, $rate)
    }
    $line
  }
  Write-Host "NOTE: item = item id, rate = 100x drop count (per docs/re/src/03-掉落数据.md). Negative => read failed."
} finally {
  [void][Win32Mem]::CloseHandle($hProc)
}
