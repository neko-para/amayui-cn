// age_map_src.mjs — 读 py 写出的 proc_state.json，用现有 Node(emulator) 做映射：
//   SYS4INI.BIN(alf.ts) 把 scriptIndex -> 文件名；src/<名字>.txt 定位当前指令行。
// 用法: node age_map_src.mjs
import { readFileSync, existsSync } from 'node:fs';
import { parseSys4Index } from './dist/script/alf.js';
import { OPCODE_TABLE } from './dist/script/bin.js';

const ROOT = 'E:/Games/Eushully/天結';
const state = JSON.parse(readFileSync(ROOT + '/tools/fade_probe_proj/proc_state.json', 'utf8'));

// 1) scriptIndex -> 文件名（SYS4INI 基础索引；APPENDnn 用 pack#<<24 已由 resolveFileEntry 支持）
const base = parseSys4Index(new Uint8Array(readFileSync(ROOT + '/install/SYS4INI.BIN')));
let name = null;
if (state.scriptIndex < base.files.length) name = base.files[state.scriptIndex].name.trim();
console.log(`scriptIndex=0x${state.scriptIndex.toString(16)}  =>  ${name ?? '(未知/APPEND)'}`);
if (!name) process.exit(1);

const srcBase = name.replace(/\.BIN$/i, '');
const srcPath = `${ROOT}/src/${srcBase}.txt`;
console.log(`src 文件: src/${srcBase}.txt  (存在=${existsSync(srcPath)})`);

// 2) 当前指令：opcode(hex) -> 助记符 NAME（与 src 反汇编的助记符一致）
const opName = OPCODE_TABLE.get(state.opcode)?.name ?? `0x${state.opcode.toString(16)}`;

// 3) 在 src 反汇编文本里找与 (opcode+参数) 匹配的那一行（尽力定位"行数"）
if (existsSync(srcPath)) {
  const lines = readFileSync(srcPath, 'utf8').split(/\r?\n/);
  // 由 opcode 值反查助记符；参数用原始 dword 的 16 进制小写/前缀匹配
  const wantArgs = (state.args || []).map(a => {
    // 小值(<0x10)常为 0x 形式；大值也按 16 进制打印。src 里整数大多为 16 进制。
    return a.toString(16).replace(/^0+/, '');
  });
  // 找含 opName 且参数大致吻合的行（无参数指令直接找 opName 行）
  let hit = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) continue;
    if (ln === opName) { hit = i + 1; break; }                     // 无参指令
    if (ln.startsWith(opName + ' ')) {
      const parts = ln.split(/\s+/).slice(1);
      // 参数个数对齐且每个都出现在对应位（宽容：至少前 2 个匹配）
      let ok = parts.length >= 1 && parts.length <= (wantArgs.length + 2);
      if (ok && parts.length && (wantArgs[0] === '' )) hit = i + 1;
      if (parts.length >= 1 && wantArgs.length >= 1 && parts[0].toLowerCase().replace(/^0x/,'') === wantArgs[0]) { hit = i + 1; break; }
    }
  }
  console.log(`当前指令: ${opName} ${(state.args||[]).map(a=>'0x'+a.toString(16)).join(' ')}`);
  console.log(`对应 src 行(尽力): ${hit > 0 ? '第 ' + hit + ' 行' : '未精确匹配（可按上述助记符+参数在 src 文件检索）'}`);
  if (hit > 0) console.log(`  → ${lines[hit - 1].trim()}`);
}
