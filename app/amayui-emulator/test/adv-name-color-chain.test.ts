/** @tier T1 @kind core @subsystem adv */

/**
 * **ADV 角色名颜色的派生链**（`tickets/T-0102` 判据 4/5 —— 用户实测「阿瓦罗的名字是青色，预期橘色」）。
 *
 * ## 这条链（全部在脚本侧，emulator 只提供操作数/字段语义）
 *
 * ```text
 * 3f37（当前消息号，旁白 = -1）
 *   └─ CONFIG.txt:226-241 / 各 SC 脚本同一段：
 *        旁白            ⇒ 14acda = 0
 *        有发言人        ⇒ via = 14acdc[3f37]
 *                          idx = 14b0c4[via]
 *                          idx != 0 ? 14acda = idx
 *                                   : 14acda = (52a49c[3f37] == 1 ? 1 : == 2 ? 2 : 3)
 *   └─ CONFIG.txt:372-407（label_00001ae8）：f807b = adcd[14acda]（`a9dd&2` 门控）
 *   └─ i076(f807b) ⇒ Font+1360 = engineValues[21664]（`bgrToRgb`），i077 同法写描边
 * ```
 *
 * ## 本测试钉什么（以及**不**钉什么）
 *
 * 钉：
 *  1. **`14b0c4` 的取值来自角色数据脚本 `src/CVINIT.txt`**（逐元素名 `14b0c5`/`14b0c6`/…）——
 *     用**独立 oracle**（读脚本正文）与探针实测的 `derivation.idx` 逐值比对；
 *  2. 消息表 `f612[3f37]` 里那条消息**确实有发言人**（名字非空）—— 这是"判据 5 取样点存在"的证明；
 *  3. `f807b == adcd[14acda]`（原值）且 `fill == bgrToRgb(f807b)`：取色与通道转换**逐环自洽**。
 *
 * **不**钉：「阿瓦罗应该是橘色」——那取决于 `i076` 操作数的通道约定（COLORREF/BGR vs RGB），
 * 是判据 4 遗留的开放项，见 `tickets/T-0102/evidence/name-color-chain.md`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runConfig1Chain } from '../src/tools/config1Chain.js';
import { globalTextStyle } from '../src/vm/handlers/msgwin.js';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { StubNative } from '../src/vm/stubNative.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/**
 * 从角色数据脚本 `src/CVINIT.txt` 里读 `14b0c4` 的逐元素表（独立 oracle，不依赖运行态）。
 *
 * 该脚本用**逐元素名**写数据：`mov (global-int 14b0c5) 4` 即 `14b0c4[1] = 4`
 * （阿瓦罗那一块；菲亚是 `14b0c6 = 5`）—— 见同块的 `set-string "アヴァロ|阿瓦罗"`。
 */
function cvinitColorIndexTable(): Map<number, number> {
  const text = fs.readFileSync(path.join(ROOT, 'src', 'CVINIT.txt'), 'utf8');
  const table = new Map<number, number>();
  const BASE = 0x14b0c4;
  // 元素名是**基址 + 偏移的十六进制和**：`14b0c5` = BASE+1、`14b0d0` = BASE+12（高位会进位）
  // ⇒ 必须按数值相减，不能只截后缀（`14b0c5` 的后缀是 `5`，不是偏移 `1`）。
  for (const m of text.matchAll(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/g)) {
    const idx = parseInt(m[1]!, 16) - BASE;
    if (idx < 0 || idx >= 64) continue;
    table.set(idx, parseInt(m[2]!, 16));
  }
  return table;
}

test('★T-0102：`14b0c4` 的逐元素值 == `src/CVINIT.txt` 的角色数据（探针实测 vs 脚本 oracle）', async () => {
  const oracle = cvinitColorIndexTable();
  assert.ok(oracle.size >= 10, `CVINIT 的 14b0c4 表样本太少（${oracle.size}）`);
  // 阿瓦罗：`14b0c5 = 4`（同块的 `14a8f5 = ffe100`）；菲亚：`14b0c6 = 5`
  assert.equal(oracle.get(1), 4, 'CVINIT：`14b0c5` 应为 4（阿瓦罗）');
  assert.equal(oracle.get(2), 5, 'CVINIT：`14b0c6` 应为 5（菲亚）');

  const r = await runConfig1Chain({ previewProbe: true, advReturnProbe: { g0: 1, g1397: 1, msg: 1 } });
  const d = r.advReturn?.derivation;
  assert.ok(d, '应产出 derivation 快照');
  assert.equal(d.via, 1, '`14acdc[1]` 应为 1（消息 1 → 角色 1）；实测 ' + d.via);
  assert.equal(d.idx, oracle.get(d.via), `\`14b0c4[${d.via}]\` 应与 CVINIT 一致`);
  assert.equal(d.idx, 4, '阿瓦罗那一格：`14b0c4[1] = 4`');
  // 消息表里这条消息**有发言人**（判据 5 的取样点存在）：文本非空
  assert.ok(d.text.length > 0, '`f612[1]` 应有消息文本（否则"有发言人"这个取样点无从证明）');
});

test('★T-0102：取色三环自洽 —— `14acda == 14b0c4[14acdc[msg]]`、渲染色 == 脚本原色（两条不同角色）', async () => {
  for (const msg of [1, 2]) {
    const r = await runConfig1Chain({ previewProbe: true, advReturnProbe: { g0: 1, g1397: 1, msg } });
    const p = r.advReturn;
    assert.ok(p, `msg=${msg} 应产出探针结果`);
    const d = p.derivation;
    // ① `14acda` 就是脚本算出来的那个下标，且 `f807b`（脚本写的 COLORREF）等于 `adcd[14acda]`
    assert.equal(p.after.c14acda, d.idx, `msg=${msg}：14acda 应等于 14b0c4[14acdc[msg]]`);
    assert.equal(p.after.f807b, d.palette[1], `msg=${msg}：f807b 应等于 adcd[14acda] 的原值`);
    // ② **屏幕上的颜色 = 脚本原值**（字段是 COLORREF，取用时再翻一次；`tickets/T-0102` 判据 4 的修复）
    //    阿瓦罗（msg 1）= `0xffe100` ⇒ `#ffe100` 橘；菲亚（msg 2）= `0x84b1ff` ⇒ `#84b1ff`
    const want = '#' + (p.after.f807b & 0xffffff).toString(16).padStart(6, '0');
    assert.equal(p.after.fill, want, `msg=${msg}：渲染填充色应为脚本原色（不是 R/B 互换后的色）`);
  }
});

test('★T-0102 判据 4 修复：`globalTextStyle` 必须把 COLORREF 字段翻回 RGB（阿瓦罗 = 橘，不是青）', () => {
  const e = new Engine(new StubNative(() => {}), new InputManager());
  // 引擎 `0x76` 的产物：脚本 `0xffe100`（阿瓦罗，CVINIT）经字节序翻转 ⇒ COLORREF `0x00E1FF`
  e.engineValues.set(21664, 0x00e1ff);
  e.engineValues.set(21665, 0x000000);
  const style = globalTextStyle(e);
  // ★这一条就是用户看到的颜色：COLORREF `0x00E1FF` ⇒ R=0xFF/G=0xE1/B=0x00 ⇒ `#FFE100`（橘）
  assert.equal(style.main.fill, '#ffe100', '阿瓦罗的名字颜色必须是 `#FFE100`（橘），不是 `#00E1FF`（青）');
  // 角色设定页残留色（`0xff90b6` ⇒ COLORREF `0xB690FF`）⇒ `#FF90B6`，不是紫 `#B690FF`
  e.engineValues.set(21664, 0xb690ff);
  assert.equal(globalTextStyle(e).main.fill, '#ff90b6', '残留色必须是 `#FF90B6`，不是紫 `#B690FF`');
  // 白色不受影响（对合：白在两读法下相同）
  e.engineValues.set(21664, 0xffffff);
  assert.equal(globalTextStyle(e).main.fill, '#ffffff');
});
