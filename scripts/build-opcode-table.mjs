#!/usr/bin/env node
/**
 * **opcode 全表**的人可读渲染（生成物）—— `docs-new/03-engine/opcode-table.md`。
 *
 *   node scripts/build-opcode-table.mjs [--check]
 *
 * 真源：`analysis/opcodes.json`（★2026-09 从本 md 迁出 —— 迁移时做过**往返逐字节比对**：
 * 574 行中仅 2 行补了缺失的收尾 ` |`、45 行的空名称格被归一为两空格，其余逐字节一致）。
 * 此后本 md 与 `scripts/asm/opcodes.json` 都是它的**生成物**。
 *
 * 为什么翻转真源方向（原来 md 是真源、JSON 由它生成）：表里 574 行的「已知语义」与
 * `analysis/functions.json.purpose` 同源，而「分析状态」可由 `semantics` 是否为空派生；
 * 真源留在 md 里意味着**每次改一个 opcode 都要在 228 KB 的表格里手改一格**，
 * 且没有守卫能发现"md 与 JSON 不一致"（因为 JSON 是从 md 生成的）。
 *
 * 守卫：`app/amayui-emulator/test/doc-model.test.ts`（front-matter + 生成物一致性）、
 *       `app/amayui-emulator/test/op-1d0-1d1-text-metrics.test.ts`（逐行锚点）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_PATH = path.join(ROOT, 'analysis', 'opcodes.json');
const MD_PATH = path.join(ROOT, 'docs-new', '03-engine', 'opcode-table.md');

const FRONT_MATTER = [
  '---',
  'kind: generated',
  'state: live',
  'home: analysis/opcodes.json',
  'generated_by: scripts/build-opcode-table.mjs',
  '---',
  '',
].join('\n');

/** 表前导语（原 md 的正文，逐字节保留）。 */
const NOTE = [
  '>',
  '> ★**本文件是生成物**：真源 = `analysis/opcodes.json`（2026-09 从本表迁出，往返比对见该文件的 `_doc`），',
  '> 由 `scripts/build-opcode-table.mjs` 渲染。**改语义请改 JSON 再重跑**，直接改这里会被 `test/doc-model.test.ts` 打回。',
].join('\n');

const PRE = "# 03-engine · opcode→handler 全表（引擎位置 / 语义 / 分析状态）\n\n> 本文档列出**全部指令**在引擎中的位置、已知语义与分析状态。数据来自对引擎 dispatch 表（`this+0x0A509C`）的实读 + age-shared 助记符对照。\n>\n> - **opcode**：dispatch 表数组下标；`opcode = (offset − 0x0A509C) / 4`，上限 `0x400`（越界落默认 `sub_418E30`）。\n> - **引擎位置**：该 opcode 在本引擎 dispatch 表中的 handler（`engine/天结_unpacked.exe_utf8.c` 的 `sub_XXXXXX`）。\n> - **名称（age-shared）**：引擎家族另一构建的助记符/函数地址，`u00xxxxxx` 不含语义，跨构建交叉引用、与本引擎地址**不对齐**。\n> - **分析状态**：`已核对`（读了 handler 体确证，附 raw .c 行号）/ `推测`（仅凭名称推断、handler 未读体、**可能失真**）/ `未解`（无表征）/ `仅映射`（仅知 opcode→handler，语义未读）。\n> - **操作数编号**：语义列用 **op1 / op2 / op3…（1-based）= 该指令的第 1 / 第 2 / 第 3… 个参数**（等价 args[0]/args[1]/args[2]…），**不含 opcode**，个数与 `argc` 一致。\n> ⚠️ AGE 助记符不可靠（`exit`≠程序退出，是跨脚本返回；`ret`≠跨脚本返回，是同脚本子程序返回）。凡`推测`/未读体一律不可当定论。\n>\n> **效果相关指令已语义化命名**（版权页/淡入淡出等）：`create-mesh`(0x320)、`set-vertex-color`(0x322)、`set-vertex-color-alpha`(0x323)、`set-draw-color`(0x202)、`set-draw-color-alpha`(0x203)、`draw-texture`(0x1FB)、`set-texture`(0x1F9)、`create-texture`(0x1F8)、`release-texture`(0x1FA)、`play-movie`(0x20F)、`wait`(0x21C)、`float-mov`(0x2D5)、`poll-input`(0x101)、`detach-texture`(0x1F7)。旧的 `u00xxxxxx` 保留为**别名**（汇编器同时接受），源脚本已批量替换为主标签。这些的完整机制见 `./copyright-effect.md`。\n>\n> **算术/字符串/内存指令接口（2025-09 确证）**：本表所列纯数值/字符串/内存指令均已**逐一读体、确认接口**，结论写入数据层 `analysis/functions.json`（`ANALYZED`/`PARTIAL` + `purpose`/`sub_behaviors`/`fields_used`/`evidence`）与 `analysis/fields.json`（操作数池基址 `pool_int/float/string/…`、`local_*`）。类别：运算 `0x50-0x5F`、位 `0x135-0x13F`、浮点 `0x2D5-0x2E4`、字符串 `0x192/193/1C8/2C5/1A6/1A3`、数组/索引/lea `0x61/63/64/6C/12C/1B0/2D8`。\n>\n> **状态判定走引擎分析技能规则**：`已核对` = 读 handler 体确证（附 raw .c 行号）；`推测`/`仅映射` = 未读体，不一定可靠。函数含未建模数值偏移或调用未分析函数的记 **`PARTIAL`**，否则 **`ANALYZED`**（如 `random`/0x60 的共用格式化助手 `sub_408050`→`StringFormat`（安全有界 sprintf）确证后转 ANALYZED）。\n>\n> **信息源**：本工程的分析结论**唯一数据层** = `analysis/` 下的三层（① `functions.json` + `fields.json` 函数/偏移「是什么」；② `engine-capabilities.json` 引擎**常态能力**；③ `scripts.json` **脚本台账**），原始只读基准 = `engine/天结_unpacked.exe_utf8.c`。`opcode-table.md` 只列**映射 / 语义**，分析结论以数据层为准。\n>\n> **参考**：`analysis/functions.json`、`analysis/fields.json`（+ `engine-capabilities.json` / `scripts.json`）；报表工具 `.agents/skills/amayui-engine-analysis/scripts/report.js`（读数据层打印进度/字段清单）、`sort-fields.js`（字段排序）、`capabilities.js`（第二层）、`scripts.js`（第三层）；跨脚本的脚本层结论见 `docs-new/05-scripts/`。\n> **功能方向粗分类**（指令→声音/渲染/消息UI/输入/字符串/数据等簇）见 [`./instruction-directions.md`](./instruction-directions.md)。\n> **音频族**（`0xB4`..`0xC7`、`0x1BD`、`0x2BF`/`0x2C0`、`0x2F4`..`0x302`）的整体机制——设备 / SE / Voice / Music 三模块、15 条通道、`sound:Volume0..4` 路由、ADV 文本↔语音联动——见 [`./sound-system.md`](./sound-system.md)。\n\n## 全部 544 个已映射 opcode\n";
/** 主表表头 + 分隔行。 */
const MAIN_HEAD = "| opcode | argc | 名称（age-shared） | 引擎位置（handler） | 分析状态 | 已知语义 |\n|---|---|---|---|---|---|";
/** 主表与「回退默认」节之间的过渡（水平线 + H2 + 说明）。 */
const MID = "\n---\n\n## 回退默认 `sub_418E30` 的 opcode（age-shared 已定义，本引擎未实现）\n\n> 这些条目在 dispatch 表里**没有被覆盖**（`rep stosd` 填充后保持默认 `sub_418E30`），多为引擎家族其它作品的专属 opcode。\n";
/** 「回退默认」表表头 + 分隔行。 */
const FB_HEAD = "| opcode | argc | 名称 | 归属作品（age-shared 注释） |\n|---|---|---|---|";
/** 文件收尾。 */
const END = "\n";

const hex = (n) => '0x' + n.toString(16).toUpperCase();

/** 渲染（纯函数，便于测试断言"文件是最新的"）。 */
export function renderOpcodeTable(doc) {
  const rows = doc.entries.map(
    (e) => `| ${hex(e.opcode)} | ${e.argc ?? ''} | ${e.mnemonic} | ${e.handler} | ${e.status} | ${e.semantics} |`,
  );
  const fb = doc.fallbackDefault.entries.map(
    (e) => `| ${hex(e.opcode)} | ${e.argc ?? ''} | ${e.mnemonic} | ${e.owner} |`,
  );
  return [FRONT_MATTER, PRE, NOTE, MAIN_HEAD, ...rows, MID, FB_HEAD, ...fb, END].join('\n');
}

function main() {
  const doc = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const md = renderOpcodeTable(doc);
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(MD_PATH) ? fs.readFileSync(MD_PATH, 'utf8') : '';
    if (cur !== md) {
      console.error('✗ opcode-table.md 不是最新的（跑 node scripts/build-opcode-table.mjs）');
      process.exit(1);
    }
    console.log('✓ opcode-table.md 是最新的');
    return;
  }
  fs.writeFileSync(MD_PATH, md, 'utf8');
  console.log(
    `[ok] docs-new/03-engine/opcode-table.md ← analysis/opcodes.json（${doc.entries.length} + ${doc.fallbackDefault.entries.length} 条）`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
