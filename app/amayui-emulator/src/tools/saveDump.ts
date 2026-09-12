/**
 * **存档查看器**：读一份 `SAVE.DAT`（引擎格式或本工程格式都能读），打印头、表规模与
 * `INITCONFIG*` 那批配置键（`save-int (global …)` 的持久化结果）。
 *
 *   node src/tools/saveDump.ts                          # 仓库内 app/amayui-emulator/SAVE/SAVE.DAT
 *   node src/tools/saveDump.ts <文件>                    # 指定文件（如真游戏存档）
 *   AMAYUI_SAVE_DIR=<真游戏 SAVE 目录> node src/tools/saveDump.ts
 *
 * 为什么需要它：设置界面的开关**不在 SYS4REG.INI**，而是脚本 `save-int`/`save-string` 登记、
 * 引擎序列化进 `SAVE.DAT`（见 `docs-new/03-engine/save-data.md`）。
 * 这个工具把"玩家到底存了什么"直接打出来，便于对照 `src/INITCONFIG*.txt` 的默认值。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSaveDataPath } from '../arch/resourceDir.js';
import { decodeSaveData, readSaveHeader } from '../vm/saveData.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// src/tools -> app/amayui-emulator/src/tools ⇒ 上 4 级 = 仓库根（与 config1Chain.ts 同口径）
const REPO = path.resolve(HERE, '..', '..', '..', '..');

/** `INITCONFIG0..5` 里 `save-int (global X)` 登记的键（对照默认值用）。 */
const CONFIG_GLOBALS: [number, string][] = [
  [0x5, '「已初始化」标志（SYSTEM4.txt:71）'],
  [0xa9ce, 'INITCONFIG0'],
  [0xa9cd, 'INITCONFIG0'],
  [0xa9d5, 'INITCONFIG0'],
  [0xa9d0, 'INITCONFIG0'],
  [0xa9cb, 'INITCONFIG0'],
  [0xa9cc, 'INITCONFIG0'],
  [0xb1b6, 'INITCONFIG1'],
  [0xa9e4, 'INITCONFIG1'],
  [0x139b, 'INITCONFIG1'],
  [0xa9d6, 'INITCONFIG1'],
  [0xa9de, 'INITCONFIG2'],
  [0xa9dd, 'INITCONFIG2'],
  [0xa9db, 'INITCONFIG2'],
  [0xa9df, 'INITCONFIG2'],
  [0xa9e0, 'INITCONFIG2'],
  [0xa9e1, 'INITCONFIG2'],
  [0xa9e2, 'INITCONFIG2'],
  [0xa9dc, 'INITCONFIG3'],
  [0xa9d4, 'INITCONFIG3'],
  [0xa9d9, 'INITCONFIG3'],
  [0xa9da, 'INITCONFIG3'],
  [0xa9e3, 'INITCONFIG5'],
  [0xa9d2, 'INITCONFIG5'],
];
const FONT_GLOBALS = [0xbbb, 0xbbc, 0xbbd, 0xbbe, 0xbbf];

function main(): void {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const file = arg ?? resolveSaveDataPath(REPO);
  if (!fs.existsSync(file)) {
    console.error(`[err] 没有这个文件：${file}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(fs.readFileSync(file));
  const header = readSaveHeader(bytes);
  console.log(`文件：${file}（${bytes.length} 字节）`);
  console.log(`头：${JSON.stringify(header)}`);
  const r = decodeSaveData(bytes);
  if (!r.ok) {
    console.error(`[err] 解析失败：${r.reason}`);
    process.exit(2);
  }
  const { ints, strings } = r.data.tables;
  console.log(
    `\nformat=${r.data.format}（0 = 本工程明文，1..3 = 引擎的 Crypt/LZSS 格式）` +
      `  int 记录 ${ints.size} 条 / string 记录 ${strings.size} 条`,
  );
  console.log('\n配置键（`\\x03` + hex8(global)）：');
  for (const [g, where] of CONFIG_GLOBALS) {
    const key = '\x03' + g.toString(16).padStart(8, '0');
    console.log(`  global ${g.toString(16).padStart(6, '0')} = ${String(ints.get(key) ?? '（无）').padStart(6)}   ${where}`);
  }
  console.log('\n字体面名（`\\x05` + hex8(global)）：');
  for (const g of FONT_GLOBALS) {
    const key = '\x05' + g.toString(16).padStart(8, '0');
    console.log(`  global ${g.toString(16)} = ${JSON.stringify(strings.get(key) ?? null)}`);
  }
  // 抽样：前 10 条 int / string 记录（了解存档里还存了什么）
  console.log('\n抽样（前 10 条 int 记录）：');
  for (const [k, v] of [...ints.entries()].slice(0, 10)) {
    console.log(`  ${JSON.stringify(k)} = ${v}`);
  }
  console.log('抽样（前 5 条 string 记录）：');
  for (const [k, v] of [...strings.entries()].slice(0, 5)) {
    console.log(`  ${JSON.stringify(k)} = ${JSON.stringify(v).slice(0, 80)}`);
  }
}

main();
