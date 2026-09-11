/**
 * **CONFIG1 链路端到端回归**（E3：真实脚本 + 模拟输入 + 真实 SYS4REG.INI）。
 *
 * 链路：`SYSTEM4 → … → LOGO → TITLE →（点菜单第 3 项 CONFIG）→ CONFIG.BIN → CONFIG1.BIN`
 * 目标：CONFIG1 打开后会显示一个**ADV 样例文案窗口**（给玩家预览字体渲染效果），
 *       其内容是 `i071 9` → `display-furigana 0 "天結" "あまゆ"` → `show-text 0
 *       "いキャッスルマイスターＳＡＭＰＬＥ"` → `end-text-line 0` → `i301 9`（CONFIG1.txt:2916-2932）。
 *
 * 链路跑手在 `src/tools/config1Chain.ts`（与排查工具 `npm run diag:text` **共用同一份**，
 * 避免"测试说对、工具说不对"）。本文件只放断言。
 *
 * 本测试锁四件事：
 *  1. 链路能走到 CONFIG1，且**没有任何未实现 opcode**；
 *  2. ADV 状态机把样例文案**内容与注音**记下来了（文本槽模型）；
 *  3. 消息窗字段被脚本写对（`0x80` → `_this[21631]`、`0x261` → `_this[80101]`）；
 *  4. ★**排版结果进入渲染模型**，且**层序正确、不被任何图元盖住**
 *     —— 这是"跑起来看不到字"那条静默缺陷的回归闸。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_XY, runConfig1Chain, type ChainResult } from '../src/tools/config1Chain.js';

/** 链路很重（数百万条指令）⇒ 所有用例共享同一次运行结果。 */
let cached: Promise<ChainResult> | null = null;
const chain = (): Promise<ChainResult> => (cached ??= runConfig1Chain());

test('★CONFIG1 链路：LOGO → TITLE → CONFIG → CONFIG1，无未实现 opcode', async () => {
  const r = await chain();
  assert.deepEqual(r.unimplemented, [], 'CONFIG1 路径上不应有未实现 opcode');
  assert.match(r.script, /^CONFIG/, `应进入 CONFIG 系列脚本，实际 ${r.script}`);
  assert.equal(CONFIG_XY[0], 807, 'TITLE 菜单 CONFIG 项命中点');
});

test('★CONFIG1 的 ADV 样例窗口：文案与注音被正确记录', async () => {
  const r = await chain();
  // 正文 = 「天結」(display-furigana 的本文词) + 「いキャッスルマイスターＳＡＭＰＬＥ」(show-text)
  assert.equal(r.text, '天結いキャッスルマイスターＳＡＭＰＬＥ', '样例文案（注音词的本文也算正文）');
  assert.deepEqual(r.ruby, [['天結', 'あまゆ']], 'display-furigana 写入的注音对');
  assert.equal(r.pane, 9, 'i080 9 → 消息窗当前窗格 _this[21631] = 9');
  assert.equal(r.msgField, 1, 'i261 1 → 消息窗配置 _this[80101] = 1');
});

test('★CONFIG1 的 ADV 样例窗口：排版结果进入渲染模型（一行横排 / 30px / 注音 10px）', async () => {
  const r = await chain();
  const w = r.sampleWin;
  assert.ok(w, '窗 9 应产生过排版结果（脚本的 ADV 样例文案）');
  // 几何：CONFIG.txt:37 `i070 9 338 78 144 23a` = 824×120 @ (324,570)
  assert.deepEqual(w.rect, { x: 324, y: 570, w: 824, h: 120 });
  // 样式：`i075 1e`(30px) + `i197 a`(注音 10px) + `i2bd 1`(加粗) + `i261 1`(竖排)
  assert.equal(w.mainSize, 30);
  assert.equal(w.rubySize, 10);
  // `i261 1` 写的 `Font+235108` **不参与排版**（引擎排版例程不读它，只改绘制期源矩形）
  assert.equal(w.vertical, true, 'i261 1 写进模型（供诊断），但不得改变流向');
  // ★正文 = `display-furigana` 的本文词「天結」+ `show-text` 的「いキャッスルマイスターＳＡＭＰＬＥ」
  //   （引擎把 0x196 的 op2 也当要铺排的文本：sub_46BE30(obj, part, op2, op3, flag)）
  //   19 字 × 30px = 570px ≤ 824 ⇒ **一行横排**，注音「あまゆ」在「天結」上方。
  assert.deepEqual(
    w.lines.map((l) => l.text),
    ['天結いキャッスルマイスターＳＡＭＰＬＥ'],
  );
  assert.equal(w.lines[0]!.width, 570);
  assert.equal(w.glyphCount, 19);
  // ★默认（无逐字显现状态）必须"全部显示"：曾因把模型的 -1 当 0 处理，导致所有窗口空白
  assert.equal(w.revealed, 19, '无显现状态 ⇒ 全部显示（否则画面空白）');
  assert.equal(w.lines[0]!.ruby, 3, '注音 あまゆ 三个字');
  assert.equal(w.vertical, true, '标志在模型里，但流向仍是横向（见下一条用例）');

  // ★快照里能看见文字本身 —— "让文本可观测"的验收点
  assert.match(r.snapshotText, /text win=9 rect=\(324,570,824,120\)/);
  assert.match(r.snapshotText, /天結いキャッスルマイスターＳＡＭＰＬＥ/);
});

test('★文本不会被图元盖住：层序取引擎的 DrawItem id 起点（0x213 写的 win+104）', async () => {
  const r = await chain();
  const w = r.sampleWin;
  assert.ok(w, '应有样例窗');
  // CONFIG.txt:39 `i213 9 2c114 1f4` ⇒ 正文行 id 起点 = 0x2c114 = 180500。
  // ★若用固定小层序（曾用 `20+win` = 29），会被 key 100 量级的整屏 UI **完全盖掉**
  //   —— 这正是"模拟器跑起来看不到字"的根因（视觉上没有任何报错）。
  assert.equal(w.itemId, 0x2c114, '文本层序 = 0x213 写的 win+104');
  assert.ok(w.itemId > 1000, '层序必须高于普通 2D 图元（key 100 量级）');
  assert.deepEqual(r.coveredBy, [], '有层序更高且与文本框相交的图元 ⇒ 文字会被盖住');
});

/**
 * ★2026 实测反馈的回归闸：「CONFIG1 打开后样例文案似乎只逐字展示了一次，实际会不断循环」。
 *
 * 引擎侧：`CONFIG.txt:171 i300 9 1 3e8` 把 win 9 的**逐行贴出闸门**打开（bit0）+ 延时 1000ms 写进
 * `Engine[122476+9]`；`sub_409400` 的第一循环（raw 13838-13888）于是每帧从 `win+132` 贴出一行，
 * 整段贴完后记完成时刻，过 `op3` ms 调 `sub_404F80`（清绘制项 + `win+132 = 0`）——
 * **闸门位仍是 1** ⇒ 下一帧又从头贴一遍，**无限循环**（设置界面的"消息显示预览"）。
 */
test('★CONFIG 消息预览的 0x300 闸门：贴出 → 停留 1000ms → 清场 → 重新贴出（不断循环）', async () => {
  const r = await chain();
  const g = r.gateLoop;
  assert.ok(g, '应采到闸门状态与循环序列');
  assert.equal(g!.enabled, true, 'i300 9 1 3e8 ⇒ 闸门 bit0 = 1');
  assert.equal(g!.autoHideMs, 0x3e8, '停留时长 = op3 = 1000ms');
  const seq = g!.shown;
  const full = Math.max(...seq);
  assert.equal(full, 19, `观察窗内应看完整段贴出（19 字），实际序列 ${seq.join(',')}`);
  const firstFull = seq.indexOf(19);
  const afterFull = seq.slice(firstFull);
  const firstZero = afterFull.indexOf(0);
  assert.ok(firstZero > 0, `整段贴出后应出现清场（revealed=0），实际序列 ${seq.join(',')}`);
  assert.ok(
    Math.max(...afterFull.slice(firstZero)) > 0,
    `清场后应重新贴出（循环演示），实际序列 ${seq.join(',')}`,
  );
});
