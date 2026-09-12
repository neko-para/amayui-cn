import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FONTS_DIR } from './config.js';

// 会话级注册 cnjp 字体：调用 gdi32 AddFontResourceEx 使字体对当前 Windows 会话可用
// （无需永久安装；重启/注销后需重新运行本脚本，或改为在 Windows 中双击安装字体）。
//
// ★**两面都要注册**：`Amayui CN` 的 Regular + Bold（脚本 `i2bd/i2be` = `lfWeight 700` 要落到 Bold 面，
//   只装 Regular 时 GDI 找不到粗体面 ⇒ "加粗"看起来没效果）。见 docs/font-build.md §8.7。
const FONTS = ['Amayui-CN_cnjp.ttf', 'Amayui-CN_cnjp-Bold.ttf'];

const missing = FONTS.filter((f) => !fs.existsSync(path.join(FONTS_DIR, f)));
if (missing.length) {
  console.error(`[FAIL] 找不到字体文件：${missing.join(', ')}（应位于 ${FONTS_DIR}）`);
  process.exit(1);
}

const ps = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FontWin {
    [DllImport("gdi32.dll", CharSet=CharSet.Auto)]
    public static extern int AddFontResourceEx(string lpszFilename, int fl, IntPtr pdv);
}
'@
$failed = 0
${FONTS.map(
  (f, i) => `$n${i} = [FontWin]::AddFontResourceEx("${path.join(FONTS_DIR, f)}".Replace("\\", "\\\\"), 0x10, [IntPtr]::Zero)
if ($n${i} -gt 0) { Write-Output "OK: ${f} (faces=$n${i})" } else { Write-Output "FAIL: ${f}"; $failed++ }`,
).join('\n')}
if ($failed -gt 0) { exit 1 }
`;

try {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  console.log(out.trim());
} catch (err) {
  console.error('[FAIL]', err.stderr?.toString() || err.message);
  process.exit(1);
}
