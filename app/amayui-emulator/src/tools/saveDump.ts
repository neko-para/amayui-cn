/**
 * **存档查看器**：读一份 `SAVE.DAT`（引擎格式或本工程格式都能读），打印头、表规模与
 * `INITCONFIG*` 那批配置键（`save-int (global …)` 的持久化结果）；**给 `.DAT` 是存档槽时改打槽状态**
 * （真槽解 `engineSlot`、本工程槽解状态块：`cur` / 逐帧 `index+scriptId+ip+retStack+caller` / 池规模 /
 * 游玩秒数，并顺带统计同名 `.STH` 缩略图的像素 —— 直接回答「这个档存得对不对」）。
 *
 *   node src/tools/saveDump.ts                          # 系统存档目录的 SAVE\SAVE.DAT（overlay → base）
 *   node src/tools/saveDump.ts <文件>                    # 指定文件（`SAVE70.DAT` 这类槽也认）
 *   AMAYUI_SYSTEM_DIR=<game 目录> node src/tools/saveDump.ts   # 换一套系统存档目录
 *   AMAYUI_OVERLAY_DIR=<目录>    node src/tools/saveDump.ts   # 换 overlay 目录
 *
 * 为什么需要它：设置界面的开关**不在 SYS4REG.INI**，而是脚本 `save-int`/`save-string` 登记、
 * 引擎序列化进 `SAVE.DAT`（见 `docs-new/03-engine/save-data.md`）。
 * 这个工具把"玩家到底存了什么"直接打出来，便于对照 `src/INITCONFIG*.txt` 的默认值；
 * 槽分支则是 `tickets/T-0059`（真槽续跑）/`T-0061`（本工程槽退栈）的验收工具。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OverlayDir } from '../arch/overlay.js';
import { SAVE_DAT_REL, describeSystemPaths, resolveSystemPaths } from '../arch/systemPaths.js';
import { decodeSaveData, readSaveHeader } from '../save/saveData.js';
import { parseSlotFile } from '../save/saveSlot.js';
import { decodeEngineSlot } from '../vm/engineSlot.js';
import { decodeBmp } from '../vm/bmp.js';

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

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const system = resolveSystemPaths(REPO);
  const overlay = new OverlayDir(system);
  // 默认：系统存档目录下的 `SAVE\SAVE.DAT`，按 overlay → base 取（并打印实际命中的是哪一份）
  const hit = arg ? { path: arg, side: 'arg' as const } : await overlay.locate(SAVE_DAT_REL);
  if (!hit) {
    console.error(`[err] overlay/base 都没有 ${SAVE_DAT_REL}`);
    console.error(`      ${describeSystemPaths(system)}`);
    process.exit(1);
  }
  const file = hit.path;
  if (!fs.existsSync(file)) {
    console.error(`[err] 没有这个文件：${file}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(fs.readFileSync(file));
  const header = readSaveHeader(bytes);
  console.log(`overlay：${describeSystemPaths(system)}`);
  console.log(`文件：${file}（${hit.side}，${bytes.length} 字节）`);
  console.log(`头：${JSON.stringify(header)}`);

  // ---- 存档槽分支（`SAVE%2.2d.DAT`）：打槽的状态主体 + 同名 `.STH` 的像素统计 ----
  if (/SAVE\d{2}\.DAT$/i.test(file)) {
    const slot = parseSlotFile(bytes);
    if (!slot.ok) {
      console.error(`[err] 槽解析失败：${slot.reason}`);
      process.exit(2);
    }
    const d = slot.data;
    const sh = d.header;
    console.log(
      `\n槽：format=${sh.format}（0 = 本工程槽（带状态块）；3 = 引擎真槽）` +
        ` 游玩秒数=${sh.playSeconds} 日期=${sh.year}-${sh.month}-${sh.day} ${sh.hour}:${sh.minute}:${sh.second}`,
    );
    if (d.engineFormat) {
      const dec = decodeEngineSlot(bytes);
      if (!dec.ok) {
        console.error(`[err] 引擎槽状态主体解析失败：${dec.reason}`);
        process.exit(2);
      }
      const p = dec.payload;
      console.log(`引擎槽状态主体：savedCur=${p.savedCur} savedRet=${p.savedRet}`);
      p.frames.forEach((f, k) => {
        console.log(
          `  帧 ${k}: scriptId=0x${f.scriptId.toString(16)} 返回帧=${f.returnFrame} 返回栈=${f.retIdx.length} 层（值 = 表 C 下标）` +
            ` 消息表下标=${f.messageIdx} call 表下标=${f.callIdx}（落点：${f.callIdx >= 0 ? '0x3 调用点的下一条' : f.messageIdx >= 0 ? '0x71 重放这条消息' : '无'}）`,
        );
      });
      console.log(
        `  池：int=${p.ints.length}（非零 ${p.ints.filter((v) => v !== 0).length}） float=${p.floats.length} string=${p.strings.length}` +
          ` 全局 ip 表 A/B/C=${p.ipTableA.length}/${p.ipTableB.length}/${p.ipTableC.length}`,
      );
    } else if (d.state) {
      const st = d.state;
      console.log(`本工程状态块：cur=${st.cur} 帧记录 ${st.frames.length} 条（key=0x${(st.key >>> 0).toString(16)}）`);
      for (const f of st.frames) {
        console.log(
          `  帧 ${f.index ?? '(无 index ⇒ 数组序)'}: scriptId=0x${f.scriptId.toString(16)}（${f.name}）ip=${f.ip}` +
            ` 返回栈=${f.retStack.length} 层 返回帧=${f.caller ?? '(未存)'}`,
        );
      }
      console.log(
        `  池：int=${st.globals.int.length} float=${st.globals.float.length} string=${st.globals.str.length} 游玩秒数=${st.playSeconds}`,
      );
      if (st.frames.some((f) => f.index === undefined || f.caller === undefined)) {
        console.log('  ★这是**修 T-0061 之前**写的槽：帧号/返回帧链缺失 ⇒ 读档按数组序归位（可能整体错位）');
      }
    } else {
      console.log('（没有状态块：这是早期写的槽 / 只存了两张表）');
    }
    // 同名 `.STH`：320×180 BMP（`0x1AE` 写的）⇒ 统计像素，直接回答"缩略图是不是黑的"
    const sthPath = file.replace(/\.DAT$/i, '.STH');
    if (fs.existsSync(sthPath)) {
      const sth = new Uint8Array(fs.readFileSync(sthPath));
      const bmp = decodeBmp(sth);
      if (!bmp) {
        console.log(`\n缩略图：${path.basename(sthPath)}（${sth.length} 字节）**不是 BMP**（可能是宿主无像素时的自描述空块：${JSON.stringify(new TextDecoder().decode(sth.subarray(0, 24)))}）`);
      } else {
        let nonBlack = 0;
        let opaque = 0;
        let maxSum = 0;
        for (let i = 0; i < bmp.rgba.length; i += 4) {
          const [r, g, b, a] = [bmp.rgba[i]!, bmp.rgba[i + 1]!, bmp.rgba[i + 2]!, bmp.rgba[i + 3]!];
          if (a > 0) opaque++;
          if (r + g + b > 12) nonBlack++;
          maxSum = Math.max(maxSum, r + g + b);
        }
        const px = bmp.width * bmp.height;
        console.log(
          `\n缩略图：${path.basename(sthPath)} ${bmp.width}x${bmp.height} ${sth.length} 字节 —— ` +
            `不透明像素 ${opaque}/${px}、非黑像素 ${nonBlack}/${px}、最亮像素和 ${maxSum}` +
            `${nonBlack === 0 ? ' ⇒ ★全黑（截图链没把画面画进渲染目标槽，见 tickets/T-0062）' : ''}`,
        );
      }
    } else {
      console.log(`\n缩略图：没有 ${path.basename(sthPath)}`);
    }
    return;
  }

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

main().catch((err: unknown) => {
  console.error(`[err] ${(err as Error).message}`);
  process.exit(3);
});