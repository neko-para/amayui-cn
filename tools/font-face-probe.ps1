# 字体「面」探针 —— 回答两个只能用 GDI 自己回答的问题（T-0035）
#
#   1) `-List`：照抄引擎字体选择器的枚举条件（`EnumFontFamiliesExA` + lfCharSet=0x86 +
#      lfOutPrecision=OUT_TT_ONLY_PRECIS=8；Proc 只收非光栅且 lfCharSet==0x86），列出候选表里
#      某个名字出现几条 —— 用来核对「一个族一条」这件事（引擎 Proc raw 74146-74171）。
#   2) 默认    ：对 face=名字 + lfWeight=400/700 各建一次 HFONT，用 `GetFontData` 把 GDI **实际选中
#      的那份字体数据**取回来 ⇒ sha256 相同 = 同一面（700 被静默退回常体），不同 = 700 落到了另一面；
#      顺带解析 name 表 id1/id2/id4/id6（PostScript 名唯一标识一份文件）当可读证据。
#
# 已核事实（2026-09-15，本机 Win + 两份 TTF 都装好、HKCU 字体项齐全）：
#   · `Amayui CN` 在引擎口径的候选表里**只有 1 条**（另有 '@Amayui CN' 竖排变体，引擎 Proc 会滤掉），
#     但同一台机器上 `lfWeight=700` 经 GetFontData 确证选中的是 `id6=Amayui-CN-Bold`。
#     ⇒ 「选择器里出现一条」**不能**用来判断 Bold 面在不在（全库 2925 条枚举记录里，
#       同一个 face 名从不以两种字重出现 —— GDI 每族每字符集只报一条代表面）。
#   · 对照组 `MS Gothic`（Windows 自带、无 Bold 面）：400/700 的 GetFontData 返回体相同
#     ⇒ 静默退回常体这件事，这条探针**看得见**。
#
# 用法：
#   pwsh -NoProfile -File tools/font-face-probe.ps1
#   pwsh -NoProfile -File tools/font-face-probe.ps1 -Face "Amayui CN" -List
#   pwsh -NoProfile -File tools/font-face-probe.ps1 -Face "MS Gothic" -Weights 400,700 -CharsetProbe 1
param(
  [string]$Face = 'Amayui CN',
  [string]$Weights = '400,700',            # 逗号分隔（-File 传参会吞数组，这里自己拆）
  [int]$Height = -30,
  [byte]$Charset = 134,                    # 0x86 = GB2312_CHARSET（引擎候选表用的就是它）
  [int[]]$CharsetProbe = @(1, 128, 134),   # 选面探针各试哪些字符集
  [switch]$List
)

$code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class FontFaceProbe
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct LOGFONTA
    {
        public int lfHeight, lfWidth, lfEscapement, lfOrientation, lfWeight;
        public byte lfItalic, lfUnderline, lfStrikeOut, lfCharSet, lfOutPrecision, lfClipPrecision, lfQuality, lfPitchAndFamily;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string lfFaceName;
    }
    public delegate int FONTENUMPROCA(IntPtr lpelfe, IntPtr lpntme, uint fontType, IntPtr lParam);

    [DllImport("gdi32.dll", CharSet = CharSet.Ansi)] public static extern int EnumFontFamiliesExA(IntPtr hdc, ref LOGFONTA lpLogfont, FONTENUMPROCA lpProc, IntPtr lParam, uint dwFlags);
    [DllImport("gdi32.dll", CharSet = CharSet.Ansi)] public static extern IntPtr CreateFontIndirectA(ref LOGFONTA lf);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr ho);
    [DllImport("gdi32.dll")] public static extern uint GetFontData(IntPtr hdc, uint dwTable, uint dwOffset, byte[] lpvBuffer, uint cbData);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr ho);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    // Proc 的读法：首参是 ENUMLOGFONTEXA*，首成员即 LOGFONTA（lfFaceName 在 +28，lfWeight 在 +16）
    static string FaceName(IntPtr p) { return Marshal.PtrToStringAnsi(new IntPtr(p.ToInt64() + 28)); }
    static int Weight(IntPtr p) { return Marshal.ReadInt32(p, 16); }
    static byte CharsetOf(IntPtr p) { return Marshal.ReadByte(p, 23); }

    /// <summary>引擎候选表的枚举口径：lfFaceName 空、lfOutPrecision=8、Proc 滤 fontType!=1 且 lfCharSet==charset。</summary>
    public static string[] EnumLikeEngine(byte charset)
    {
        var outp = new List<string>();
        var lf = new LOGFONTA();
        lf.lfCharSet = charset;
        lf.lfOutPrecision = 8; // OUT_TT_ONLY_PRECIS
        lf.lfFaceName = "";
        IntPtr hdc = GetDC(IntPtr.Zero);
        FONTENUMPROCA cb = delegate (IntPtr lpelfe, IntPtr lpntme, uint fontType, IntPtr lParam)
        {
            if (fontType != 1 && CharsetOf(lpelfe) == charset)
                outp.Add(string.Format("{0}\tw={1}\tcharset={2}\tfontType={3}", FaceName(lpelfe), Weight(lpelfe), CharsetOf(lpelfe), fontType));
            return 1;
        };
        EnumFontFamiliesExA(hdc, ref lf, cb, IntPtr.Zero, 0);
        ReleaseDC(IntPtr.Zero, hdc);
        return outp.ToArray();
    }

    /// <summary>GDI 对 (face, weight) 实际选中的那份字体数据（GetFontData 整份）。取不到时返回 null。</summary>
    public static byte[] FontData(string face, int weight, int height, byte charset)
    {
        var lf = new LOGFONTA();
        lf.lfHeight = height; lf.lfWeight = weight; lf.lfCharSet = charset; lf.lfFaceName = face;
        IntPtr hfont = CreateFontIndirectA(ref lf);
        IntPtr hdc = CreateCompatibleDC(GetDC(IntPtr.Zero));
        SelectObject(hdc, hfont);
        byte[] result = null;
        uint size = GetFontData(hdc, 0, 0, null, 0);
        if (size != 0 && size != 0xFFFFFFFF)
        {
            result = new byte[size];
            GetFontData(hdc, 0, 0, result, size);
        }
        DeleteObject(hfont); DeleteDC(hdc);
        return result;
    }

    /// <summary>解析 sfnt 的 name 表（platform 3 / lang 0x409）里的 id1/2/4/6。非单面 TTF（.ttc 系）可能错位，仅作参考。</summary>
    public static string[] NameRecords(byte[] b)
    {
        if (b == null || b.Length < 12) return new string[0];
        int numTables = (b[4] << 8) | b[5];
        int nameOff = -1;
        for (int i = 0; i < numTables; i++)
        {
            int o = 12 + i * 16;
            if (o + 12 > b.Length) break;
            if (Encoding.ASCII.GetString(b, o, 4) == "name")
                nameOff = (b[o + 8] << 24) | (b[o + 9] << 16) | (b[o + 10] << 8) | b[o + 11];
        }
        if (nameOff < 0 || nameOff + 6 > b.Length) return new string[0];
        int count = (b[nameOff + 2] << 8) | b[nameOff + 3];
        int strOff = nameOff + ((b[nameOff + 4] << 8) | b[nameOff + 5]);
        var outp = new List<string>();
        for (int i = 0; i < count; i++)
        {
            int r = nameOff + 6 + i * 12;
            if (r + 12 > b.Length) break;
            int platform = (b[r] << 8) | b[r + 1];
            int lang = (b[r + 4] << 8) | b[r + 5];
            int id = (b[r + 6] << 8) | b[r + 7];
            int len = (b[r + 8] << 8) | b[r + 9];
            int off = (b[r + 10] << 8) | b[r + 11];
            if (platform != 3 || lang != 0x409) continue;
            if (id != 1 && id != 2 && id != 4 && id != 6) continue;
            if (strOff + off + len > b.Length) continue;
            var sb = new StringBuilder();
            for (int k = 0; k + 1 < len; k += 2) sb.Append((char)((b[strOff + off + k] << 8) | b[strOff + off + k + 1]));
            outp.Add("id" + id + "=" + sb.ToString());
        }
        return outp.ToArray();
    }
}
'@
Add-Type -TypeDefinition $code -Language CSharp

if ($List) {
  Write-Output ("== 引擎候选表的枚举口径（lfCharSet=0x{0:X2}={0}，OUT_TT_ONLY_PRECIS）—— 名字含 '{1}' 的条目 ==" -f $Charset, $Face)
  $all = [FontFaceProbe]::EnumLikeEngine($Charset)
  $all | Where-Object { $_ -like "*$Face*" } | ForEach-Object { "  $_" }
  $hit = @($all | Where-Object { $_ -like "$Face`t*" })
  Write-Output ("  候选表条目总数 = {0}；'{1}' = {2} 条（'@{1}' 是竖排变体，引擎 Proc 会滤掉）" -f $all.Count, $Face, $hit.Count)
  Write-Output ""
}

Write-Output "== GDI 实际选中的面（GetFontData 返回体指纹；同 face 名同字符集下两条指纹相同 = 同一面）=="
$weightList = @($Weights -split '[,\s]+' | Where-Object { $_ -ne '' } | ForEach-Object { [int]$_ })
foreach ($cs in $CharsetProbe) {
  $rows = @()
  foreach ($w in $weightList) {
    $data = [FontFaceProbe]::FontData($Face, $w, $Height, [byte]$cs)
    if ($null -eq $data) {
      $rows += [pscustomobject]@{ w = $w; sha = '(取不到)'; size = 0; names = '' }
    } else {
      $sha = [System.Security.Cryptography.SHA256]::Create().ComputeHash($data)
      $names = ([FontFaceProbe]::NameRecords($data) | Where-Object { $_ -like 'id1=*' -or $_ -like 'id2=*' -or $_ -like 'id6=*' }) -join ' | '
      $rows += [pscustomobject]@{ w = $w; sha = (($sha[0..7] | ForEach-Object { $_.ToString('x2') }) -join ''); size = $data.Length; names = $names }
    }
  }
  foreach ($r in $rows) {
    "{0,-28} lfCharSet={1,-4} sha256[:8]={2}  bytes={3,-10} {4}" -f ("face='" + $Face + "' w=" + $r.w), $cs, $r.sha, $r.size, $r.names | Write-Output
  }
  $distinct = @($rows | Where-Object { $_.sha -ne '(取不到)' } | Select-Object -ExpandProperty sha -Unique)
  if ($distinct.Count -eq 1) {
    "  ⇒ 各字重取到**同一面**（700 被静默退回常体 / 该族只有这一面）—— 这正是 T-0035 现象 (a)"
  } elseif ($distinct.Count -gt 1) {
    "  ⇒ 各字重取到**不同面**（700 有落到独立的 Bold 文件）"
  }
  Write-Output ""
}
