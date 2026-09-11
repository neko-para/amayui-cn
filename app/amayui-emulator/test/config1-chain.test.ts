/**
 * **CONFIG1 链路端到端回归**（E3：真实脚本 + 模拟输入 + 真实 SYS4REG.INI）。
 *
 * 链路：`SYSTEM4 → … → LOGO → TITLE →（点菜单第 3 项 CONFIG）→ CONFIG.BIN → CONFIG1.BIN`
 * 目标：CONFIG1 打开后会显示一个**ADV 样例文案窗口**（给玩家预览字体渲染效果），
 *       其内容是 `i071 9` → `display-furigana 0 "天結" "あまゆ"` → `show-text 0
 *       "いキャッスルマイスターＳＡＭＰＬＥ"` → `end-text-line 0` → `i301 9`（CONFIG1.txt:2916-2932）。
 *
 * 本测试锁三件事：
 *  1. 链路能走到 CONFIG1，且**没有任何未实现 opcode**（此前 `0x090`/`0xC5`/`0xC7`/`0x1B8`/`0x2CC`/
 *     `0x2E6`/`0x2EA`/`0x194` 都在 CONFIG1 路径上，分别会硬报错或静默写错操作数）；
 *  2. ADV 状态机把样例文案**内容与注音**记下来了（文本槽模型）；
 *  3. 消息窗字段被脚本写对（`0x80` → `_this[21631] = 9`、`0x261` → `_this[80101]`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { Engine, SLEEP_GATE } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { loadScriptData, stepOnce, NotImplementedOp } from '../src/vm/interpreter.js';
import { ExitScript, ScriptReset } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { parseIni, applyConfigToEngine } from '../src/engineConfig.js';
import { dec } from '../src/vm/bits.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RAW = path.join(ROOT, 'raw');
const INI = path.join(HERE, '..', 'SYS4REG.INI');

/** TITLE 菜单「CONFIG」项的命中点（由 i12e 的 baseX/baseY 数组算出：第 3 项 rect [729,885]×[543,699]）。 */
const CONFIG_XY: [number, number] = [807, 621];

async function runChain(): Promise<{
  script: string;
  unimplemented: string[];
  text: string;
  ruby: string[][];
  pane: number | undefined;
  msgField: number | undefined;
}> {
  const src = new NodeFileSource({ rawDir: RAW });
  const input = new InputManager();
  const e = new Engine(new StubNative(() => {}), input);
  e.fileSource = src;
  e.config = parseIni(fs.readFileSync(INI, 'utf8'));
  applyConfigToEngine(e.config, e.engineValues);
  const boot = await src.readScript(0);
  assert.ok(boot, '应能读到 index 0 = SYSTEM4.BIN');
  loadScriptData(e, boot.data, boot.name);

  const unimplemented: string[] = [];
  let clock = 0;
  /**
   * 跑到 `until()` 为真或达到帧上限。
   * ★不要用「固定跑 N 帧」——那会在已经到达目标后继续空转，把测试拖到几十秒。
   */
  const run = async (maxFrames: number, until?: () => boolean): Promise<number> => {
    for (let i = 0; i < maxFrames; i++) {
      if (until?.()) return i;
      e.nowMs = clock;
      if (e.waitFlags & 0x400) e.waitFlags &= ~0x400;
      else if (e.waitFlags & SLEEP_GATE) {
        if (clock >= e.sleepUntil) e.waitFlags &= ~SLEEP_GATE;
      } else if (e.awaitingAdvance) e.forceAdvance();
      else if (e.advActive) {
        e.serviceAdv();
        try {
          await stepOnce(e);
        } catch {
          /* ADV 分支的异常按"本帧无进展"处理 */
        }
      } else {
        for (let k = 0; k < 5000; k++) {
          const f = e.curScript();
          if (!f.script || f.ip >= f.script.instructions.length) return i;
          try {
            await stepOnce(e);
          } catch (err) {
            if (err instanceof ExitScript || err instanceof ScriptReset) return i;
            if (err instanceof NotImplementedOp) {
              // ★不登记用户桩：未实现 opcode 必须让测试失败，而不是被静默放行
              uninplementedPush(unimplemented, err);
              return i;
            }
            throw err;
          }
          if (e.waitFlags & (0x400 | SLEEP_GATE) || e.awaitingAdvance) break;
        }
      }
      clock += 1000 / 60;
    }
    return maxFrames;
  };

  const onTitle = () => e.curScript().name.startsWith('TITLE');
  const onConfig1 = () => e.curScript().name.startsWith('CONFIG1');
  // 启动 → LOGO → TITLE。★帧上限只是兜底：`until` 命中即返回（实测到 TITLE 只需 ~20 帧，
  //   但 TITLE 的 `sleep 1` 让步使 1 帧≈1 条指令，所以补一段固定帧让它把菜单/hover 状态初始化完）。
  assert.ok((await run(4000, onTitle)) < 4000, '应在帧上限内到达 TITLE');
  assert.ok(onTitle(), `应停在 TITLE，实际 ${e.curScript().name}`);
  await run(4000); // TITLE 初始化（与 title-exit.test.ts 同口径）
  const hover = (): number => dec(e.key, e.curScript().locals.int.get(0x3f7) ?? 0);
  input.setCursor(...CONFIG_XY);
  await run(2000, () => hover() === 3);
  assert.equal(hover(), 3, '悬停点应命中 TITLE 菜单第 3 项（CONFIG）');
  input.pressMouse(0);
  await run(400); // 按住期间让 VM 轮询到
  input.releaseMouse(0);
  await run(4000, onConfig1); // CONFIG.BIN → CONFIG1.BIN
  assert.ok(onConfig1(), `应进入 CONFIG1，实际 ${e.curScript().name}`);
  // CONFIG1 里继续跑到"ADV 样例窗口"被执行（文本槽被写入）
  await run(4000, () => e.msgwin.slots.size > 0);

  const m = e.msgwin;
  const out = {
    script: e.curScript().name,
    unimplemented,
    text: m.textOf(0),
    ruby: m.slot(0).segments.flatMap((s) => s.ruby) as unknown as string[][],
    pane: e.engineValues.get(21631),
    msgField: e.engineValues.get(80101),
  };
  await src.dispose?.();
  return out;
}

function uninplementedPush(list: string[], err: NotImplementedOp): void {
  list.push(`0x${err.opcode.toString(16)} ${err.name} @${err.scriptName}`);
}

/** 链路很重（数百万条指令）⇒ 两个用例共享同一次运行结果。 */
let cached: ReturnType<typeof runChain> | null = null;
const chain = (): ReturnType<typeof runChain> => (cached ??= runChain());

test('★CONFIG1 链路：LOGO → TITLE → CONFIG → CONFIG1，无未实现 opcode', async () => {
  const r = await chain();
  assert.deepEqual(r.unimplemented, [], 'CONFIG1 路径上不应有未实现 opcode');
  assert.match(r.script, /^CONFIG/, `应进入 CONFIG 系列脚本，实际 ${r.script}`);
});

test('★CONFIG1 的 ADV 样例窗口：文案与注音被正确记录', async () => {
  const r = await chain();
  assert.equal(r.text, 'いキャッスルマイスターＳＡＭＰＬＥ', 'show-text 写入的样例文案');
  assert.deepEqual(r.ruby, [['天結', 'あまゆ']], 'display-furigana 写入的注音对');
  assert.equal(r.pane, 9, 'i080 9 → 消息窗当前窗格 _this[21631] = 9');
  assert.equal(r.msgField, 1, 'i261 1 → 消息窗配置 _this[80101] = 1');
});
