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
import { itemRenderPlacement, makeItem } from '../src/renderer/drawItem.js';

/** 链路很重（数百万条指令）⇒ 所有用例共享同一次运行结果。 */
let cached: Promise<ChainResult> | null = null;
const chain = (): Promise<ChainResult> => (cached ??= runConfig1Chain());

test('★CONFIG1 链路：LOGO → TITLE → CONFIG → CONFIG1，无未实现 opcode', async () => {
  const r = await chain();
  assert.deepEqual(r.unimplemented, [], 'CONFIG1 路径上不应有未实现 opcode');
  assert.match(r.script, /^CONFIG/, `应进入 CONFIG 系列脚本，实际 ${r.script}`);
  assert.equal(CONFIG_XY[0], 807, 'TITLE 菜单 CONFIG 项命中点');
});

/**
 * ★样例文案为什么长这样（**汉化版的编码机制**，不是乱码）：
 *
 * 资源根默认是 `install/`（汉化版），译文在 `src/CONFIG1.txt` 里是
 * `display-furigana 0 @"天结" @"天结"` + `show-text 0 @"神缘ＳＡＭＰＬＥ"`。
 * 汇编时 `scripts/lib/sjis-encode.js` 会把**简体译文映射成"cp932 可编码的日文写法"占位**
 * （字典 `res/subs_cn_jp.json`：结→俟、缘→俣），真机上再由 **cnjp 字体**把该码位的字形还原成简体字
 * （`res/fonts/Amayui-CN_cnjp.ttf`；见 `src/text/fontSet.ts` 的字体策略）。
 *
 * ⇒ 脚本层（解析器 + 排版模型）看到的就应该是**占位码位**，字形还原是字体的事。
 * 断言用占位串，若哪天换了字典/译文，这条会失败并提示需要同步（E3 的金标准）。
 */
const CN_SAMPLE = '天俟神俣ＳＡＭＰＬＥ'; // 简体原文「天结神缘ＳＡＭＰＬＥ」

test('★CONFIG1 的 ADV 样例窗口：文案与注音被正确记录', async () => {
  const r = await chain();
  // 正文 = 《天结》(display-furigana 的本文词) + 《神缘ＳＡＭＰＬＥ》(show-text)
  assert.equal(r.text, CN_SAMPLE, '样例文案（注音词的本文也算正文）');
  assert.deepEqual(r.ruby, [['天俟', '天俟']], 'display-furigana 写入的注音对（汉化版把注音也改成同文）');
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
  // ★正文 = `display-furigana` 的本文词 + `show-text` 的文本
  //   （引擎把 0x196 的 op2 也当要铺排的文本：sub_46BE30(obj, part, op2, op3, flag)）
  //   10 字 × 30px = 300px ≤ 824 ⇒ **一行横排**，注音在本文词上方。
  assert.deepEqual(
    w.lines.map((l) => l.text),
    [CN_SAMPLE],
  );
  assert.equal(w.lines[0]!.width, w.glyphCount * w.mainSize, '一行宽 = 字数 × 字高（全角 1em）');
  assert.ok(w.glyphCount >= 4, `字数应不少于 4，实际 ${w.glyphCount}`);
  // ★默认（无逐字显现状态）必须"全部显示"：曾因把模型的 -1 当 0 处理，导致所有窗口空白
  assert.equal(w.revealed, w.glyphCount, '无显现状态 ⇒ 全部显示（否则画面空白）');
  assert.equal(w.lines[0]!.ruby, 2, '注音与本文词同长（汉化版把 あまゆ 改成了 天结）');
  assert.equal(w.vertical, true, '标志在模型里，但流向仍是横向（见下一条用例）');

  // ★快照里能看见文字本身 —— "让文本可观测"的验收点
  assert.match(r.snapshotText, /text win=9 rect=\(324,570,824,120\)/);
  assert.ok(r.snapshotText.includes(CN_SAMPLE), '快照文本应含样例文案');
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
  // ★不写死字数：语料是 install/（汉化版），译文长度会随翻译更新而变
  const want = r.sampleWin?.glyphCount ?? 0;
  assert.ok(want > 0, '应采到样例窗的字数');
  assert.equal(full, want, `观察窗内应看完整段贴出（${want} 字），实际序列 ${seq.join(',')}`);
  const firstFull = seq.indexOf(want);
  const afterFull = seq.slice(firstFull);
  const firstZero = afterFull.indexOf(0);
  assert.ok(firstZero > 0, `整段贴出后应出现清场（revealed=0），实际序列 ${seq.join(',')}`);
  assert.ok(
    Math.max(...afterFull.slice(firstZero)) > 0,
    `清场后应重新贴出（循环演示），实际序列 ${seq.join(',')}`,
  );
});

/**
 * ★2026 实测反馈的回归闸：「CONFIG1 **右侧滚动条的中间部分没有渲染出来，只有上下两部分**，
 * 但滚动条功能正常」。
 *
 * 引擎侧（`src/CONFIG1.txt:2934-2971`）：拇指是**三段式**拼出来的 ——
 *   上盖 `27×23` → 中段 **`27×1`**（`draw-texture` 只给 1px 源高，随后
 *   `i217 <obj> <dstX> <dstY> 0` 设 pivot + `i1fd <obj> 64 <h·64> 64` 纵向放大到 `h`）→ 下盖 `27×24`。
 *
 * ⇒ 只要 `0x1FD`（立即缩放）没落到渲染，中段就退回 1px 高（看不见），
 *   而**拖动/滚轮逻辑完全正常**（几何量都写在脚本局部变量里）—— 正是该症状。
 * 本用例断言三段**首尾相接**：这是"中段真的被撑开了"的不变量，比断言具体像素值稳。
 */
test('★CONFIG1 滚动条拇指：上盖 / 中段(0x1FD 撑开) / 下盖 首尾相接', async () => {
  const r = await chain();
  const t = r.scrollThumb;
  assert.ok(t, 'CONFIG1 帧里应能取到滚动条拇指三段（handle = 0x1d4c0 + 0x776/0x777/0x778）');
  assert.equal(t!.top.handle + 2, t!.bottom.handle, '三段 handle 连续（上盖 +0、中段 +1、下盖 +2）');
  assert.deepEqual([t!.top.srcW, t!.middle.srcW, t!.bottom.srcW], [27, 27, 27], '同宽 27');
  assert.equal(t!.middle.srcH, 1, '★中段的源只有 1px 高 —— 不靠 0x1FD 撑开就看不见');
  assert.ok(t!.middle.scaleY > 1, `中段必须被 0x1FD 纵向放大，实际 scaleY=${t!.middle.scaleY}`);
  assert.equal(t!.top.scaleY, 1, '上/下盖没有 0x1FD（也不该被世界矩阵影响）');
  assert.equal(t!.bottom.scaleY, 1, '上/下盖没有 0x1FD');
  // 首尾相接：上盖底边 = 中段顶边；中段底边（含缩放）= 下盖顶边
  assert.equal(t!.top.dstY + t!.top.srcH, t!.middle.dstY, '上盖底边应接上中段顶边');
  assert.equal(
    t!.middle.dstY + t!.middle.srcH * t!.middle.scaleY,
    t!.bottom.dstY,
    '中段（放大后）底边应接下盖顶边 —— 断开即说明缩放或 pivot 又错了',
  );
  // pivot 与描画位置同坐标空间（`i217 <obj> <dstX> <dstY> 0`）⇒ Pixi 相对量必须为 0
  assert.deepEqual([t!.middle.pivotRelX, t!.middle.pivotRelY], [0, 0], '中段 pivot == 描画位置 ⇒ 以左上角为基准拉伸');
});

/**
 * ★2026-09 实测反馈：「**打开字体选择框 → 右键退出 → 再滚动列表**，滚动条中间 scale 出来的区域
 * 会漂到左边」。
 *
 * 根因链（全部可在本链路里观测）：
 *  1. `CONFIG1.txt:1045` 在打开字体选择器（`call-script 51dd`）前把脚本全局 `707ffa/707ffb`
 *     （**弹窗原点**，`CONFIG1.txt:1046-1048` 按行号算）置成 `0x348/0x78+0x32·n`，**从不复位**；
 *  2. 滚动条中段的 `0x217` pivot 被算成 `707ffa + 32e`（`CONFIG1.txt:2960`、`CONFIG2.txt:1424`），
 *     而它的**描画位置**是 `32e` ⇒ `pivot ≠ pos`（本例实测 pivotRel = 0x348 = 840）；
 *  3. 引擎把 pivot **原样**存进 DrawItem`+24/+28/+32`（`sub_4ACF20`，新建项默认 0 —— `sub_49A300`），
 *     渲染是 `v' = S·R·(v − pivot) + t + pivot`。Pixi 侧必须**同时**取
 *     `position = pivot`、`pivot = pivot − pos`；只改后者而位置用 `pos` 时，中段会整体平移
 *     `pivot − pos`（scaleX = 1 ⇒ 左移 840px）—— 这正是用户看到的"漂到左边"。
 *
 * 断言口径：**渲染出来的左边缘**（用渲染器同一份映射 `itemRenderPlacement` 算）必须与上/下盖的
 * `dstX` 一致。修前会差 `pivotRel`（840），修后为 0。
 */
test('★字体选择器开关过之后滚动：拇指中段的**渲染位置**不得漂移（pivot ≠ pos 的映射回归）', async () => {
  const r = await runConfig1Chain({ fontPickerProbe: true, fontPickerCloseThenScroll: true });
  const fp = r.fontPicker;
  assert.ok(fp?.opened, '应先打开字体选择器（$1$SELFONT）');
  assert.ok((fp?.names.length ?? 0) >= 9, `选择器应列出候选面名（实际 ${fp?.names.length}）`);
  assert.equal(fp?.scriptAfterClose, 'CONFIG1.BIN', '右键退出后应回到 CONFIG1');
  const origin = fp?.popupOrigin;
  assert.ok(origin && origin.x !== 0, `弹窗原点 707ffa 应仍是脚本留下的非零值（实际 ${JSON.stringify(origin)}）`);

  const t = fp?.afterCloseScroll;
  assert.ok(t, '关闭选择器并滚动后应能取到拇指三段');
  assert.equal(t!.middle.pivotRelX, origin!.x, '★中段 pivot 被算成「弹窗原点 + 轨道 x」⇒ pivotRel = 弹窗原点（本回归的前提）');

  // 渲染器同一份映射：走世界矩阵的段 = `position = pivot (+t)`、`pivotLocal = pivot − pos`；
  // 不走世界矩阵的段是纯 2D（`position = pos`，pivot/scale/rot/trans 一律不参与）。
  const renderedLeft = (seg: NonNullable<typeof t>['top']): number => {
    if (!seg.useWorld) return seg.dstX;
    const it = makeItem({
      handle: 1,
      layer: 1,
      tex: 0,
      srcX: 0,
      srcY: 0,
      srcW: seg.srcW,
      srcH: seg.srcH,
      dstX: seg.dstX,
      dstY: seg.dstY,
    });
    it.pivotX = seg.dstX + seg.pivotRelX;
    it.pivotY = seg.dstY + seg.pivotRelY;
    it.scaleTarget = { x: seg.scaleX, y: seg.scaleY, z: 1 };
    const pl = itemRenderPlacement(it, 0);
    return pl.position.x + pl.scale.x * (0 - pl.pivot.x);
  };
  assert.equal(t!.top.useWorld, false, '上/下盖没有变换指令 ⇒ 纯 2D 路径');
  assert.equal(t!.middle.useWorld, true, '中段有 `0x1FD` ⇒ 走世界矩阵');
  assert.equal(renderedLeft(t!.top), t!.top.dstX, '上盖（纯 2D）渲染位置 = dstX（回归基准）');
  assert.equal(
    renderedLeft(t!.middle),
    t!.middle.dstX,
    `★中段渲染左边缘必须回到轨道 x（实际 ${renderedLeft(t!.middle)} vs ${t!.middle.dstX}）` +
      '—— 修前会左移 pivotRel（= 弹窗原点）',
  );
  assert.equal(renderedLeft(t!.middle), t!.top.dstX, '三段必须同列');
});

/**
 * ★2026 实测反馈的回归闸：「设置界面**中间的项目的文字没有渲染**，并且**两侧的按钮只渲染了第一行**」。
 *
 * 两条独立成因（都在本链路里可观测）：
 *  1. **`0x204` draw-string 未实现** ⇒ `create-texture 196 628 360` 出来的离屏槽永远是空的，
 *     宿主只能把它当程序化纹理画成白块 ⇒ 中间一片纯白。这里断言**每行的项目名/数值确实被直绘进槽 196**。
 *  2. **`0x12F` 三数组排序双重 DEC/ENC** ⇒ 可见行序表变成 `[0,14·16384,…]`，
 *     `描述符表[i] = 源表[序列表[i]]` 只有第 0 行读到正确值、其余行读成 0 ⇒
 *     数值贴片的源 Y = `(type−1)×31` 变成 **−31（越界）**、◀▶/ON-OFF 控件也不再画
 *     ⇒ 表现成"只有第一行有数值和按钮"。这里断言**每一行的数值贴片源 Y ≥ 0 且都有控件**。
 */
test('★CONFIG1 设置列表：每一行都拿到自己的描述符（0x12F 排序）+ 项目文本被直绘进槽 196（0x204）', async () => {
  const r = await chain();
  const rows = r.configRows;
  assert.ok(rows.length >= 9, `应至少画出 9 行设置项，实际 ${rows.length}`);
  for (const row of rows) {
    assert.ok(row.hasBand, `第 ${row.i} 行应有背景带`);
    assert.ok(
      row.value.srcY >= 0,
      `第 ${row.i} 行的数值贴片源 Y 必须 ≥ 0（负值 = 该行描述符读成 0，` +
        `即 0x12F 排序/搬运出错）：${JSON.stringify(row.value)}`,
    );
    assert.ok(row.controls >= 1, `第 ${row.i} 行应画出数值控件（◀▶/ON-OFF 族），实际 ${row.controls}`);
  }
  // 直绘文本：`0x204` 往槽 196 写"项目名 + 数值"，每行一条（外加说明行）
  const st = r.slotText.find((s) => s.slot === 196);
  assert.ok(st, `槽 196 上应有 draw-string 直绘的文本，实际 ${JSON.stringify(r.slotText)}`);
  assert.ok(st!.count >= rows.length, `槽 196 上的文本条数应 ≥ 行数（${rows.length}），实际 ${st!.count}`);
  assert.ok(st!.sample.length > 0, '抽样文本不应为空');
});

/**
 * ★2026 实测反馈的回归闸：「**第一次进入配置时，字体系列选项被前置了**，
 * 事实上应该放到第一页的最后面；在左侧切换 tab 再切回来，顺序就正确了」。
 *
 * 现场：`CONFIG1` 的可见行序完全由 `i12f (7ff) (179f) (273f) (561f)` 决定 ——
 * **按 `B[x] + C[x]` 升序排出索引数组 A**（B/C 用 A 里存的索引去查）。本条锁三件事：
 *  1. `A` 必须是 `0..n−1` 的一个排列；
 *  2. `A` 必须等于**独立复算**（对同一份 B/C 做稳定排序）的结果 —— 真脚本数据上的判据；
 *  3. **顺序依赖关系只剩 B/C**：`CONFIG1` 在**同一帧里反复重排**，而 A 是同一个局部数组，
 *     每轮带着上一轮结果进来。旧实现用"位置上的值"当键 ⇒ 顺序跟着历史漂移
 *     （首次进入「字体系列」被排到最前，切一次 tab 又"看起来对了"）。
 */
test('★CONFIG1 列表顺序：按 B[x]+C[x] 排序的索引序（与独立复算一致；不依赖 A 的残留）', async () => {
  const r = await chain();
  const s = r.sort12f;
  assert.ok(s, '链路里应抓到一次 0x12F（i12f）的输入/输出');
  const n = s!.n;
  assert.ok(n >= 9, `应至少有 9 个设置项，实际 n=${n}`);
  assert.deepEqual([...s!.a].sort((x, y) => x - y), [...Array(n).keys()], 'A 必须是 0..n−1 的一个排列');
  // 独立复算：按 (B+C) 稳定升序（key 相同保持原索引序）
  const expect = [...Array(n).keys()].sort((x, y) => s!.b[x]! + s!.c[x]! - (s!.b[y]! + s!.c[y]!) || x - y);
  assert.deepEqual(s!.a, expect, `A 应等于按 (B+C) 排序的索引序（B=${JSON.stringify(s!.b)}）`);
  // 描述符序（= 每行实际拿到的项）必须与序列表一致：用它反查"字体系列是否被前置"
  const rows = r.configRows;
  assert.equal(rows.length, Math.min(9, n), '第一页应铺满 9 行（项数不足时更少）');
  // 前 9 行的数值贴片源 Y 由描述符的 type 决定 ⇒ 至少每行都有效（顺序错时这里会先崩）
  for (const row of rows) assert.ok(row.value.srcY >= 0, `第 ${row.i} 行源 Y 应 ≥ 0`);
});

/**
 * ★2026 实测反馈的回归闸：「**切换页面时，第一页滚到底，切到第二页滚动条会溢出范围**」。
 *
 * 根因不在滚动条本身（它的数学是对的）：`CONFIG1` 的"切左侧分类"是
 * **置 `7dd=1` → 脚本 `exit` → CONFIG.BIN 重新 `call-script` 调回来**，
 * 而重入时**帧槽被复用** ⇒ 一旦脚本载入没有重建帧局部池，
 * 上一页的滚动起点 `local5620` 就会漏进新一页（新页最大起点更小）：
 *
 * ```
 * 上一页滚到底 start=6；新一页 12 项 ⇒ maxStart=3
 * 拇指顶 = 106 + (428 − 拇指高)·6/3 → 320  ← 轨道只有 106..534 ⇒ 拇指溢出轨道
 * ```
 *
 * 本用例按用户的操作顺序复现（滚到底 → 切分类 → 再切回来），断言**每一步**都满足
 * `0 ≤ start ≤ maxStart` 且拇指完整落在轨道内（106..534）。
 */
test('★CONFIG1 滚动条：滚到底后切分类，滚动位置必须随新页重置（拇指不得溢出轨道）', async () => {
  const r = await runConfig1Chain({ scrollProbe: true });
  const steps = r.scrollSteps;
  assert.ok(steps && steps.length >= 4, `应采到 4 个滚动状态，实际 ${JSON.stringify(steps)}`);
  const TRACK_TOP = 106;
  const TRACK_BOTTOM = 106 + 428;
  for (const s of steps) {
    assert.ok(s.start >= 0, `[${s.tag}] 滚动起点不得为负：${s.start}`);
    assert.ok(s.start <= s.maxStart, `[${s.tag}] 滚动起点不得超过最大起点：${s.start} > ${s.maxStart}`);
    if (s.maxStart === 0) continue; // 该页不需要滚动条（引擎也不画）
    assert.ok(
      s.thumbTop >= TRACK_TOP - 0.5 && s.thumbTop + s.thumbH <= TRACK_BOTTOM + 0.5,
      `[${s.tag}] 拇指必须落在轨道内：top=${s.thumbTop} h=${s.thumbH}（轨道 ${TRACK_TOP}..${TRACK_BOTTOM}）`,
    );
  }
  // 具体现场：第一页确实滚到了底，切页后回到顶部（否则就是"局部量泄漏"又回来了）
  const [enter, bottom, switched] = steps!;
  assert.equal(enter!.start, 0, '刚进入时应停在列表顶部');
  assert.ok(bottom!.maxStart > 0 && bottom!.start === bottom!.maxStart, `第一页应能滚到底：${JSON.stringify(bottom)}`);
  assert.equal(switched!.start, 0, `切到新分类后滚动位置应重置为 0（实际 ${switched!.start}）`);
  assert.ok(
    switched!.thumbTop + switched!.thumbH <= TRACK_BOTTOM + 0.5,
    `切页后拇指不得溢出轨道：top=${switched!.thumbTop} h=${switched!.thumbH}`,
  );
});
