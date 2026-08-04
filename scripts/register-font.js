import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

// 会话级注册 cnjp 字体：调用 gdi32 AddFontResourceEx 使字体对当前 Windows 会话可用
// （无需永久安装；重启/注销后需重新运行本脚本，或改为在 Windows 中双击安装字体）。
const FONT = path.join(ROOT_DIR, 'tools', 'SExtractor', 'tools', 'Font', 'Amayui-CN_cnjp.ttf');

const ps = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FontWin {
    [DllImport("gdi32.dll", CharSet=CharSet.Auto)]
    public static extern int AddFontResourceEx(string lpszFilename, int fl, IntPtr pdv);
}
'@
$n = [FontWin]::AddFontResourceEx("${FONT}".Replace("\\", "\\\\"), 0x10, [IntPtr]::Zero)
if ($n -gt 0) { Write-Output "OK: font registered (faces=$n)" } else { Write-Output "FAIL: AddFontResourceEx returned $n" }
`;

try {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  console.log(out.trim());
} catch (err) {
  console.error('[FAIL]', err.stderr?.toString() || err.message);
  process.exit(1);
}
