# Full-data export of the AGE engine's GLOBAL TABLE from a RUNNING process.
# 导出整个 global 表（单一动态数组，mixed types）——本版先按 [From..To] 的 int 解码值导出，int/empty。
# 命中 this 用 Approach-B（dispatch 表 RVA 指纹，只读不改，兼容带壳/去壳）。解码+写文件全部在 C# 内做，快。
#
# Usage:
#   pwsh -File .tmp/extract_global_data.ps1 -ProcId 27848                # 默认导出整个 global 表（到数组区末尾）
#   pwsh -File .tmp/extract_global_data.ps1 -ProcId 27848 -To 5000000 -OutFile out.csv
param(
    [int]$ProcId,
    [string]$ProcessName,
    [int64]$From = 0,
    [int64]$To   = -1,   # <0 => 自动到 global 数组实际长度（其内存区末尾）
    [string]$OutFile
)
$ErrorActionPreference='Stop'
$SCRIPTDIR=Split-Path -Parent $MyInvocation.MyCommand.Path
if(-not $OutFile){ $OutFile=Join-Path $SCRIPTDIR 'global_data.csv' }
$SignatureJson=Join-Path $SCRIPTDIR 'dispatch_signature.json'

Add-Type -TypeDefinition @'
using System; using System.Text; using System.IO; using System.Runtime.InteropServices;
public static class GD {
  [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint a,bool i,int pid);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool ReadProcessMemory(IntPtr h,IntPtr a,[Out] byte[] b,int s,out IntPtr r);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool VirtualQueryEx(IntPtr h,IntPtr a,out MBI m,int l);
  [DllImport("psapi.dll",SetLastError=true)] public static extern bool EnumProcessModules(IntPtr h,[Out] IntPtr[] m,int cb,out int n);
  [DllImport("psapi.dll",SetLastError=true)] public static extern bool GetModuleFileNameEx(IntPtr h,IntPtr m,StringBuilder sb,int size);
  [StructLayout(LayoutKind.Sequential)] public struct MBI { public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect; public IntPtr RegionSize; public uint State; public uint Protect; public uint Type; }
  static uint Rol(uint v,int n){ n%=32; if(n<0)n+=32; if(n==0)return v; return (uint)((v<<n)|(v>>(32-n))); }
  static uint Ror(uint v,int n){ n%=32; if(n<0)n+=32; if(n==0)return v; return (uint)((v>>n)|(v<<(32-n))); }
  public static uint Decode(uint x,uint key){ return Ror(key ^ Rol(x,11),25); }
  public static uint B32(byte[] b,int o){ return (uint)(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24)); }
  public static int ExportInt(string path, byte[] b, uint key, long start){
    int nonEmpty=0;
    using(var w=new StreamWriter(path,false,new UTF8Encoding(false))){
      w.WriteLine("type,index,value");
      long n=b.Length/4, i=0;
      while(i<n){
        uint dec=Decode(B32(b,(int)(i*4)),key);
        if(dec!=0){ long idx=start+i; nonEmpty++; w.Write("int,"); w.Write(idx.ToString("X")); w.Write(','); w.WriteLine(dec); i++; }
        else{
          long runStart=start+i, j=i;
          while(j<n){ if(Decode(B32(b,(int)(j*4)),key)!=0) break; j++; }
          long runEnd=start+j-1;
          w.Write("empty,"); w.Write(runStart.ToString("X"));
          if(runEnd>runStart){ w.Write("~"); w.Write(runEnd.ToString("X")); }
          w.WriteLine(); i=j;
        }
      }
    }
    return nonEmpty;
  }
  public static uint[] Raw(byte[] b){ var a=new uint[b.Length/4]; for(int k=0;k<b.Length;k+=4) a[k/4]=B32(b,k); return a; }
}
'@

$PREFERRED=0x400000; $TBL_OFFSET=0x0A509C
$OFF_INT=0x5D800; $OFF_FLOAT=0x5D808; $OFF_STR=0x5D810; $OFF_PTR=0x5D818; $OFF_FPTR=0x5D820; $OFF_KEY=0x5EC8C

$proc=$null
if($ProcId -gt 0){ $proc=Get-Process -Id $ProcId -ErrorAction SilentlyContinue }
elseif($ProcessName){ $proc=Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1 }
if(-not $proc){ Write-Warning "target not found"; exit 1 }

$h=[GD]::OpenProcess(0x0410,$false,$proc.Id)
if($h -eq [IntPtr]::Zero){ Write-Warning "OpenProcess failed"; exit 2 }
function RegionEnd([int64]$p){ $m=New-Object GD+MBI; if([GD]::VirtualQueryEx($h,[IntPtr]$p,[ref]$m,[Runtime.InteropServices.Marshal]::SizeOf($m))){ return ($m.BaseAddress.ToInt64()+$m.RegionSize.ToInt64()) }; return 0 }
function ReadDword([int64]$a){ $b=New-Object byte[] 4; $r=[IntPtr]::Zero; if([GD]::ReadProcessMemory($h,[IntPtr]$a,$b,4,[ref]$r)){ return ([int64][GD]::B32($b,0)) }; return -1 }

try{
  $mods=New-Object 'System.IntPtr[]' 1024; $need=0
  [void][GD]::EnumProcessModules($h,$mods,($mods.Length*[IntPtr]::Size),[ref]$need)
  $mb=0; $sb=New-Object System.Text.StringBuilder 260
  foreach($m in $mods){ if($m -eq [IntPtr]::Zero){break}; [void]$sb.Clear(); if([GD]::GetModuleFileNameEx($h,$m,$sb,260)){ if([IO.Path]::GetFileName($sb.ToString()) -match [regex]::Escape($ProcessName)){ $mb=$m.ToInt64(); break } } }
  if($mb -eq 0){ $mb=$mods[0].ToInt64() }

  $sig=Get-Content -LiteralPath $SignatureJson -Raw | ConvertFrom-Json
  $sigMap=@{}; foreach($s in $sig.samples){ $sigMap[[int]$s.op]=[Convert]::ToInt64($s.va.Substring(2),16) }
  $ops=@($sigMap.Keys|Sort-Object); $anchor=0x50; $ax=$mb+($sigMap[$anchor]-$PREFERRED)
  $addr=[IntPtr]::Zero; $thisAddr=[int64]0; $stop=$false; $maxR=64MB
  while($true){ if($stop){break}
    $mbi=New-Object GD+MBI; if(-not [GD]::VirtualQueryEx($h,$addr,[ref]$mbi,[Runtime.InteropServices.Marshal]::SizeOf($mbi))){break}
    $rs=$mbi.RegionSize.ToInt64(); $rb=$mbi.BaseAddress.ToInt64(); if($rs -le 0){break}
    $next=$rb+$rs; if($next -le $addr.ToInt64()){ $next=$addr.ToInt64()+0x1000 }
    $prot=($mbi.Protect -band 0x0FF); $noacc=($prot -eq 0x01)
    if($mbi.State -eq 0x1000 -and -not $noacc -and (($mbi.Protect -band 0x100)-eq 0) -and $rs -lt $maxR -and $rs -gt 0x1000){
      $buf=New-Object byte[] $rs; $rd=[IntPtr]::Zero
      if([GD]::ReadProcessMemory($h,[IntPtr]$rb,$buf,[int]$rs,[ref]$rd)){ $nr=$rd.ToInt64()
        for($o=0;$o -le ($nr-4);$o+=4){ if([GD]::B32($buf,$o) -eq $ax){ $ts=$o-4*$anchor; if($ts -lt 0){continue}
          $ok=$true; foreach($op in $ops){ if([GD]::B32($buf,($ts+4*$op)) -ne ($mb+($sigMap[$op]-$PREFERRED))){ $ok=$false;break } }
          if($ok){ $thisAddr=($rb+$ts)-$TBL_OFFSET; $stop=$true; break } } } } }
    if($next -le $rb){break}; $addr=[IntPtr]$next
  }
  if($thisAddr -eq 0){ Write-Warning "this not found"; return }

  $intBase=ReadDword ($thisAddr+$OFF_INT); $fBase=ReadDword ($thisAddr+$OFF_FLOAT); $sBase=ReadDword ($thisAddr+$OFF_STR); $pBase=ReadDword ($thisAddr+$OFF_PTR); $fpBase=ReadDword ($thisAddr+$OFF_FPTR); $key=ReadDword ($thisAddr+$OFF_KEY)
  Write-Host ("this=0x{0:X}  int=0x{1:X}  key=0x{2:X}" -f $thisAddr,$intBase,$key)
  Write-Host ("  non-int bases: float=0x{0:X} string=0x{1:X} ptr=0x{2:X} fptr=0x{3:X}" -f $fBase,$sBase,$pBase,$fpBase)

  $regionEnd = RegionEnd $intBase
  $maxSlots = [int64](($regionEnd - $intBase)/4)            # global 表可用槽数（从 index 0 起）
  if($maxSlots -lt 0){ $maxSlots = 0 }
  if($To -lt 0){ $To = $maxSlots - 1 }
  $count = [int64]($To - $From + 1); if($count -lt 0){ $count=0 }
  if($count -gt $maxSlots){ $count=$maxSlots }
  $bufLen=[int]($count*4)
  Write-Host ("exporting {0} slots (index {1}..{2} hex; region max {3})" -f $count,('{0:X}' -f $From),('{0:X}' -f ($From+$count-1)),$maxSlots)
  if($bufLen -gt 0){
    $buf=New-Object byte[] $bufLen; $got=[IntPtr]::Zero
    if([GD]::ReadProcessMemory($h,[IntPtr]($intBase+$From*4),$buf,$bufLen,[ref]$got)){
      $nonEmpty = [GD]::ExportInt($OutFile,$buf,[uint32]$key,$From)
      Write-Host ("WROTE data -> {1}  (non-empty int slots: {0})" -f $nonEmpty,$OutFile)
    } else { Write-Warning ("bulk read failed: {0}" -f [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
  }
  Write-Host "file head:"; Get-Content $OutFile -TotalCount 6
} finally { [void][GD]::CloseHandle($h) }
