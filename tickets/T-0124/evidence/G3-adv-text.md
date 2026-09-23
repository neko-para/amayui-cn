# G3 组测试审计（ADV / 消息窗 / 文本管线，24 文件）

只读审计。审计对象：`app/amayui-emulator/test/` 下 G3 组的 24 个 `*.test.ts`。
真值来源：`engine/天结_unpacked.exe_utf8.c`（raw 行号）、`analysis/*.json`、`docs-new/03-engine/*`、`src/*.txt` 语料、`install/*.BIN` 产物、真机 `SAVE.DAT` 调色板/T-0035 的像素实测。
本文件不改任何台账/文档/源码；结论只在此交回。

判据口径（本审计自己用的）：**价值 = 实现改坏时它会不会红、且红的理由正确**。
注释质量、断言条数、覆盖率都不作为价值证据。

## 0. 结论摘要

- **24 个文件全部 `keep` / `keep-ratchet` / `merge`，没有一个整文件 `drop`。** 本组整体质量高于"高风险重复"的预期：真语料 E3（4 个文件）、引擎 raw 独立复现（`text-style-snapshot` 的位表达式、`op-1d0-page-index` 的 `while(v6)` 0-哨兵、`font-bold-face` 的 TTF 二进制）都在。
- **确有的问题集中在 4 类**：
  1. **重复覆盖**：`adv-msgwin` 的 5 组路由用例与 `route-dispatch.test.ts` 逐条重合（外部重复）；`option-font-speed-menu` 有 3 组与 `adv-msgwin` 重合（内部重复）；`char-reveal` 的 `0x300` 闸门循环与 `config1-chain`（E3）重合；`msg-text-range` 的源码棘轮与 `missing-texture-skips-item` 重合。
  2. **同义反复 / 镜像**：`adv-msgwin:679-684`、`option-font-speed-menu:179/:199-206`、`char-reveal:433-455`（注释与断言互相矛盾且没钉节拍）、`op-1d0-1d1-text-metrics:77-93`（文档 lint）、`text-aa:54-65`（钉 `antiAlias===true` 三次）、`op-6-05:62-70`（impl 与 impl 互比）。
  3. **成本**：`adv-name-color-chain` 19.6 s（3 次真链路，其中 **2 次 op ts 完全相同可记忆化**）；`text-style-snapshot` 1 次真链路（实测 4.1 s）；`op-3-004` 3 趟 400 帧真产物帧循环。
  4. **守卫装错地方（1 处，见 2.8）**：`option-font-speed-menu` 的"现象 2"（面板把 `0xb5` 显示成 `0x0b5`）真实修复在 `control/control.ts:42-43`，测试却只断 `OPS`/`NATIVE_OPS` 的成员关系 —— 把 `opHex` 的前导零删掉，本组全绿。
- **E3 产物守卫不一致**（会伪装成回归）：`config1-chain.test.ts:60-68` 有 `localizedConfigMissing()` + `t.skip`，而同样跑 `runConfig1Chain` 的 `text-style-snapshot:139` 与 `adv-name-color-chain:70/:82` **没有**这道守卫。
- **本组 24 文件均无 `t.skip`**；`t.skip` 只出现在组外的 `config1-chain.test.ts`。

## 1. 24 文件判定表

| # | 文件 | 类别 | oracle | 强度 | cost（真语料/skip/慢） | Verdict | 一句话理由（证据） |
|---|---|---|---|---|---|---|---|
| 1 | `adv-msgwin.test.ts` | core | 独立 | 强 | 否 / 无 / 快 | keep（含 1 处 upgrade） | 33 条锁 ADV 状态机主食，raw 锚点密（`:355` `'★按住 10 帧只应推进 1 页'`、`:463` `assert.equal(f.ip, 7, …labelC…)`）；但 `:679-684` 是恒真式。 |
| 2 | `adv-name-color-chain.test.ts` | core | 独立 | 强 | **是**（3×chain≈18 s）/ 无 / **慢** | keep + upgrade | 独立 oracle：`:67` `assert.equal(oracle.get(1), 4, 'CVINIT：`14b0c5` 应为 4（阿瓦罗）')` + 真机调色板 `:103` `'…必须是 `#FFE100`（橘）'`。 |
| 3 | `adv-reveal-under-throttle.test.ts` | core | 独立 | 强 | 否（合成 8 字 + 帧循环）/ 无 / 快 | keep | 先红后绿开关清楚：`:99-103` `middle.length >= 2`、`:131-135` `revealedUnderGate.length >= 1`（修前 0 次）。 |
| 4 | `adv-string.test.ts` | core | 独立 | 中 | 否 / 无 / 快 | **merge**（拆包） | 5 条塞 4 个不相关族（save/load-int、save/load-string、ADV 位、`0x148/0x149`）；`:95` 的 ADV 语义与 `adv-msgwin:180-196` 重复。 |
| 5 | `char-reveal.test.ts` | core | 独立 | 强（1 条弱） | 否 / 无 / 快 | keep + upgrade | 字格/`▼`/不补拍都钉死了：`:101-103` `Math.abs(st!.intervalMs - 1000/60) < 0.01`、`:148` `assert.equal(maxStep, 1, …)`；`:433-455` 注释与断言互相矛盾。 |
| 6 | `msg-text-range.test.ts` | core + tool | 独立（T1）/ **镜像**（T2 源码正则） | 中 / 弱 | 否 / 无 / 快 | keep-ratchet；T2 **merge** | T1 手写真登记区间：`:48` `hit(105000 + 500) === false`；T2 `:65` 与 `missing-texture-skips-item.test.ts` 撞同一条源码分支。 |
| 7 | `msgwin-default-window.test.ts` | core + ratchet | 独立 + 镜像 | 中 | 否 / 无 / 快 | keep-ratchet | 双真源回归：`:62-63` `page.win === 1`（`'修前这里是 0，与页不一致'`）+ `:64-68` `rec.win === page.win`。 |
| 8 | `text-layout.test.ts` | core | 独立 | 强 | 否 / 无 / 快 | keep | 18 条全是手算期望：`:143` `'★ADV（i08b 10 = 16）：行距 = 30 + 16 = 46'`、`:122` `'注音的可见点 = 本文词末字在本行里的序号'`。 |
| 9 | `text-aa.test.ts` | core | 独立（多数）+ **镜像**（`:54-65`/`:110`） | 强 + 弱 | 否 / 无 / 快 | keep | `thresholdAlpha`/`engineGlyphPixel` 手算像素：`:146` `[225,225,225,225]`；`:54-65` 三条 `antiAlias===true` 是"钉裁决"不是推导。 |
| 10 | `text-style-snapshot.test.ts` | core | **独立** | 强 | **是**（1×chain，实测 4.1 s）/ 无 / 中 | keep | **不是**"存快照再比对自己"：`:190-195` 逐字复刻 raw 79666 写入端表达式、`:197-200` 真机 `SAVE.DAT` 调色板外部常量表、`:203` 逐值比对。 |
| 11 | `op-0100-reveal-current-window.test.ts` | core | 独立 | 强 | 否 / 无 / 快 | keep | 只发布当前窗：`:108` `assert.deepEqual([...new Set(synced)], [1])`；`:89-93` 还自证"键确实同时含 1 与 8 ⇒ 旧写法必红"。 |
| 12 | `op-1d0-1d1-text-metrics.test.ts` | **ratchet** | **镜像** | 弱 | 读 `analysis/opcode-gaps.json`+`opcode-table.md` / 无 / 快 | keep-ratchet | 唯一硬价值是"`0x1D1` 不许静默上桩"：`:62` `'…上桩就是造假'`；其余是文档 lint（改实现不会红）。 |
| 13 | `op-1d0-page-index.test.ts` | core | 独立 | 强 | 是（读真 `install/CONFIG.BIN`，秒级）/ 无 / 快 | keep | 引擎语义照抄且逐条给反例：`:257` `'★-2 不得被重复页吃掉一格（漏去重就会得到 3）'`；`:411-418` E3 诚实披露"无前奏 ⇒ 合理地 -1/-1"。 |
| 14 | `op-1b2-text-buffer.test.ts` | core | 独立 | 中 | 否 / 无 / 快 | keep | raw 36550-36558 + `asc_51EE84` 两字节：`:38` `'★0x1B3 追加的是**两字节** CRLF'`、`:73` `'`%d` 是有符号 32 位 ⇒ 0xFFFFFFFF 打成 -1'`。 |
| 15 | `op-2ee-message-fade.test.ts` | core | 独立 | 中 | 否 / 无 / 快 | keep | 双写+落盘通知：`:96` `cfgInt(e.config!, CFG.messageMessageFade, -1) === v`、`:106` `'通知出去的那份配置里要有新值'`。 |
| 16 | `op-6-05-step-slot.test.ts` | ratchet | 独立（raw 20165）/ 镜像（`:62-70` 两条互比） | 弱-中 | 否 / 无 / 快 | keep-ratchet | `:57-58` `ip+1` 且 `vmState` 一格不动；`:62` 的"两条逐字相同"依据是引擎同一函数指针，改坏一边不会红。 |
| 17 | `op-6-09-window-relayout.test.ts` | core | 独立（raw 31553-31566）+ 镜像（`:111`） | 中 | 否 / 无 / 快 | keep（第 3 条 merge） | `:104` `seen[0]!.segments === e.msgwin.slot(1).segments`（活引用）是好判据；`:123-132` "重排≠改内容"几乎不可能失败。 |
| 18 | `op-3-004-furigana-outer-gate.test.ts` | core | 独立 | 强 | **是**（真 `CONFIG1.BIN` + 3 趟 400 帧循环）/ 无 / 中 | keep | 外层门三路 + 节拍代价双向界：`:282-286` `'★每处必须恰好等 3 帧（=50ms…）'`；`:145` `assert.equal(hits, 6341)` 语料棘轮。 |
| 19 | `op-0104-gdi-repaint.test.ts` | core | 独立 | 中-强 | 否 / 无 / 快 | keep | `:92` `'★填充色 = BGR(f807b)'`、`:114` `'★越界 ⇒ 不动颜色（引擎 raw 79502 的门在设色之前）'`；`:118-132` 有死变量。 |
| 20 | `op-10-002-adv-sleep-order.test.ts` | core | 独立 | 强 | 否 / 无 / 快 | keep | `:93` `assert.deepEqual(gates, ['adv','adv'], '★两帧都必须走 ADV 分支')` 是唯一处；`:97-119` 反例保住 sleep 门没被绕掉。 |
| 21 | `draw-string.test.ts` | core | 独立 | 强 | 否 / 无 / 快 | keep | 手算推进/描边副本：`:161-166` `[['A',5,6,'fill',1],['窗',20,6,'fill',1]]`、`:226` `canvasPixelSize(628,360,1.25) === {cw:785,ch:450}`。 |
| 22 | `font-bold-face.test.ts` | core/tool | **独立**（TTF 二进制 + 外部规范） | 强 | 读 2 个大 TTF（遍历 glyf）/ 无 / 中 | keep | `:127` `bold.weightClass === 700`、`:137` `'${tag} 面缺少 Shift-JIS(932) 码页声明'`、`:146` `bold.glyphBBoxArea > regular.glyphBBoxArea * 1.02`。 |
| 23 | `option-font-speed-menu.test.ts` | core | 独立 + **镜像**（`:179`） | 中 | 否 / 无 / 快 | **merge**（拆 3 主题） | 12 条 4 主题；`:167`/`:84`/`:174` 分别与 `adv-msgwin:702`/`:112`/`:616` 重复；`:153-161` 与 `:199-206` 价值偏低。 |
| 24 | `ops-142-12f-306.test.ts` | core | 独立 | 强 | 否 / 无 / 快 | keep | 手算排列 + 残留不变性：`:124` `assert.deepEqual(gotA(e, refA, 5), [1, 3, 4, 2, 0])`、`:138-159` "结果与 A 残留无关"。 |

### 1.1 逐文件补充（类别/oracle/cost 的细化依据）

- **1 `adv-msgwin`**：oracle 全是 raw 行号 + 手算帧数；`0x71`/`0x72`/`0xB5`/`0x1D2` 语义都在。cost 快（纯合成 + `StubNative`/`HeadlessScene`）。
- **2 `adv-name-color-chain`**：oracle 双独立源 —— `src/CVINIT.txt` 文本解析（`:55` `matchAll(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/g)`）与真机调色板；cost 由 `runConfig1Chain` ×3 决定（实测 plain 3.14 s / previewProbe 4.13 s / advReturnProbe 6.00 s ⇒ 6.00+6.00+6.00 ≈ 18 s + 启动）。
- **5 `char-reveal`**：`0x73` = "▼ 图标精灵表（不是文字节拍）"这个结论是 2026-09 用户实测修正的产物，`:176-216` 那一条（断言载荷里**没有** `cell`）是很有价值的"隐性变显性"判据。
- **9 `text-aa`**：`:108-123` 用 `TEXT_FILL_ALPHA` 合成到真机实测 `(233,230,228)`，误差 ≤2 —— 这条把"E4 手工量到的像素"变成了回归；但 `:110` 的 `assert.equal(TEXT_FILL_ALPHA, 225/255)` 本身是镜像常量（好在 225/255 可由 raw 84893 的 15/17 独立推出）。
- **12 `op-1d0-1d1`**：`:113-135` 的"模型守卫"是**结构棘轮**（`Object.keys(TextItemTable)` 必须含 `pages/cursor/baseCursor`）——重命名字段会红，但改坏 `pageAt` 不会红；这是有意的（行为在 #13）。
- **13 `op-1d0-page-index`**：唯一"合成前奏"处做了显式披露（`:12-16`），且 `:411` 用真产物证明"没有前奏时 `-1/-1` 是**合理**的" —— 这是本组最诚实的写法。cost：`realConfig()` 被 3 个用例各读一次 `CONFIG.BIN`（秒级）。
- **18 `op-3-004`**：`:129-147` 的语料计数（6341 处 `display-furigana`）是"防订正被回退"的棘轮；`:184-236` 的帧循环用 `onStepStart` 抓"即将派发"的那条（`:209-211` 注释说明了错位坑）。
- **22 `font-bold-face`**：oracle 完全在 emulator 之外（真实 TTF 的 `name`/`OS/2`/`head`/`glyf`），是"实现改坏必红且理由正确"的模范；代价是解析 ~2 个 CJK TTF 的全部字形外接框（中速）。

## 2. "无意义 / 可疑"清单（逐条：file:line + 反例实验）

排序＝建议处理优先级。**每条都读了断言体，不只看 `it()` 标题。**

### 2.1 恒真式（同义反复）——建议 upgrade

1. **`adv-msgwin.test.ts:679-684`**
   ```ts
   assert.equal(st.intervalMs, revealInterval(5), '逐字节拍 = max(speed, 一帧)');
   assert.equal(st.intervalMs * laid.glyphCount, revealInterval(5) * laid.glyphCount,
     `整段 = 字数(${laid.glyphCount}) × max(speed, 一帧)…`);
   ```
   等式两边都含 `revealInterval(5)`（被测函数），第二条是第一遍乘以同一个数 ⇒ **数学上恒真**。
   反例实验：把 `src/vm/msgwin.ts:253` 改成 `return Math.max(speedMs, 100)`（错的地板）⇒ 这两行**仍然全绿**；只有 `:646`（`fastFrames` 手工区间）、`:657-659`（100 ms 档第 6 帧出第 1 字）会红。
   处置：删掉这两行，改断言 `assert.equal(st.intervalMs, 1000/60)`（手算：speed=5 < 一帧）。

2. **`option-font-speed-menu.test.ts:199-206`**
   ```ts
   const span = (speed: number): number => e.msgwin.beginReveal(0, 40, 0, speed).intervalMs * 40;
   assert.ok(slow / fast > 5, …); assert.equal(slow, 3960, '40 字 × 99ms');
   ```
   `span()` 的期望值就是对被测 `beginReveal` 的返回值做乘法，`:177` 已经钉过 `intervalMs===99`；本条的 `slow===3960` 与 `ratio>5` 都由 `:177` 蕴含。
   反例实验：把 `:177` 删掉、只留本条 ⇒ 任何"每字 99 ms"的实现都绿（含"永远返回 99"的假实现），说明它不提供独立信息。
   处置：与 `:174-182` 合并为一条。

### 2.2 镜像实现（断言被测代码自己的常量/表）——标注即可，部分建议 upgrade

3. **`option-font-speed-menu.test.ts:179``**：`assert.equal(st1.intervalMs, Math.max(1, REVEAL_FRAME_MS))` —— `REVEAL_FRAME_MS` 从 `src/vm/msgwin.js` import（被测常量）。
   反例实验：把 `REVEAL_FRAME_MS` 改成 `1`（"无帧地板"）⇒ 该行仍绿。写成 `1000/60` 才有判别力。

4. **`text-aa.test.ts:54-65`**：三条 `assert.equal(globalTextStyle(e).main.antiAlias, true)`（含字段 0/1 两档）。这是"钉住 T-0042 的裁决"（实测像素优先于字段推导），**不是**推导；`src/vm/handlers/msgwin.ts:184` 就是字面 `antiAlias: true`。
   反例实验：把 `raster.ts:48` 的 `spec.antiAlias ? TEXT_FILL_ALPHA : 1` 改成恒 `1` ⇒ 本文件**全绿**（像素合成那几条是直接调 `engineGlyphPixel`，不走 `antiAlias`）。⇒ 它守不住"压暗路径"。
   处置：keep（便宜且防回退），但要认清它只是"裁决钉子"；真正的像素判据在 `:108-123`（合成到 233/230/228）与 `:139-156`。

5. **`op-6-05-step-slot.test.ts:62-70`**：`assert.deepEqual(b, a)`（`0x1A8` 与 `0xAF` 的实现互比）。依据（引擎里同一函数指针 `sub_419690`）成立，但把其中一个改坏、另一个没改才红；若两个 handler 一起被换成同一个错的实现，仍绿。
   处置：keep-ratchet，价值主要在 `:57-58`（`ip+1` + `vmState` 深比较）。

6. **`op-1d0-1d1-text-metrics.test.ts:77-93`**：`assert.match(a.note, /回看页索引表/)`、`/raw 70629-70724/`、`/route-c-text-metrics-2026-09\.md/` —— 断言的是**台账/文档里自己写的字符串**，`assert.equal(a.handler, 'sub_42D440')` 是镜像台账。
   反例实验：把 `handlers/text-items.ts` 的 `pageAt` 改成恒 `-1/-1`（功能全废）⇒ 本文件**全绿**（`op-1d0-page-index` 才会红）。
   处置：keep-ratchet（`0x1D1` 不许上桩那条有价值），但把 note 正则归到 `scripts/*.js --validate` 的台账校验里更合适。

7. **`op-6-09-window-relayout.test.ts:111`**：`assert.deepEqual(proj(stored), proj(layoutWindow(1, seen[0]!)))` —— 两边都是 `layoutWindow`（宿主 `scMsgWinSync` 内部就调它）。
   反例实验：把 `scMsgWinSync` 里的 `layoutWindow` 删掉（不重排）⇒ 红（`stored` 不会更新）。⇒ 它确实能守"宿主真的重排了"，属于"镜像但可判别"，保留。

8. **`op-6-09-window-relayout.test.ts:123-132`**（"`0x20A` 不改该窗文本内容"）：`segments` 前后深比较 + `seen[0]!.segments.length === before.length`。当前没有任何代码路径会在 emit 时删 segments，属"不可能失败的守卫"。
   反例实验：把 `0x20A` 的 handler 换成"清空 slot 再 emit"⇒ 会红。因此不是恒真，只是低价值。处置：与 `char-reveal.test.ts:261-273`（同一条 `0x20A` 不变量）**合并**。

### 2.3 注释与断言互相矛盾（且断言没钉住它宣称的东西）

9. **`char-reveal.test.ts:433-455`**：注释 `:448` 写
   > `// 0x72 武装后逐步显现：8 格 ⇒ 一步 ceil(10/8)=2 字，节拍 100ms（5 拍显完）`

   而断言是 `:451-454`：`serviceTextReveal(80)` ⇒ `revealedOf === 1`，然后 80 ms × 2..10 ⇒ 10 字。也就是说实际语义是"**一步 1 字**，且节拍**不是** 100 ms"（`:436` 设的是 `messageSpeed = 5` ⇒ `max(5, 16.67ms)`）。
   反例实验：把 `src/vm/msgwin.ts:254` 的 `Math.max(speedMs, REVEAL_FRAME_MS)` 改成 `Math.max(speedMs, 80)` 或 `Math.max(speedMs, 1)` ⇒ 本段断言**全绿**（80 ms 调用点对任何 ≤80 ms 的节拍都只推进 1 字）。
   处置：改注释，并补 `assert.equal(st.intervalMs, 1000/60)`；否则这段宣称的"节拍"无人守。

### 2.4 断言被测实现的日志文本

10. **`op-1b2-text-buffer.test.ts:45-48`**：`logs.some(m => m.includes('0x1B4: 取出文本缓冲') && m.includes('HELLO\r\nWORLD'))` —— 一半是"日志格式"断言（改文案即红），一半（含整段文本）确实防"沉默死写"。
    反例实验：把日志文案改成 `'0x1B4: text buffer drained'` ⇒ 红，但功能没错 ⇒ **假红**。处置：改断言为"日志里出现了整段文本"（不钉前缀），或改为断言宿主收到该文本。

11. **`draw-string.test.ts:207-210`**：`logs.some(l => l.includes('没有 create-texture'))` —— 同类问题（钉中文日志串）。可接受（Node 里没有 canvas，这是唯一可判点），但同样是"改文案即红"。

### 2.5 源码正则棘轮（脆弱，重构即假红）

12. **`msg-text-range.test.ts:59-73`**：
    ```ts
    const at = src.indexOf('const { tex, imgid } = this.textures.resolve(it);');
    const seg = src.slice(at, at + 1400);
    assert.ok(/imgid === undefined && inMsgTextRange\(scene\.msgRanges\.values\(\), it\.handle\)/.test(seg));
    ```
    反例实验 A（假红）：把 `inMsgTextRange(...)` 提取成局部变量 `const inRange = …` 或把 `presenter.ts` 里这一行重排到 1400 字符之外 ⇒ 红，但行为完全正确。
    反例实验 B（假绿）：把这段判据挪到 `#placeholder` 之前的另一处调用（`seg` 窗口之外）⇒ 可能仍绿。
    且这条判据与 **`missing-texture-skips-item.test.ts`（`:70-99`）的函数体解析 + `:84` 起的行为解析）**守的是**同一条源码分支** ⇒ 重复覆盖。
    处置：删除本文件的 T2（保留 T1 的区间判据），或把 `itemSprite` 的"无 tex"分支抽成纯函数后写行为测试。

13. 同类但可接受的源码棘轮：**`msgwin-default-window.test.ts:82-111`**（`defaultWin` 不许再读 `engineValues[defaultWindow]` + 全仓剥注释扫 `textSlotArg`）。它守的是"死字段/双真源复活"，且前面有行为断言（`:49-80`），代价低 ⇒ keep-ratchet。`op-1d0-1d1-text-metrics.test.ts` 的台账正则见第 6 条。

### 2.6 死代码 / 未清理

14. **`op-0104-gdi-repaint.test.ts:119-131`**：`const e = mkWithRecords(8);` 完全没用到，末尾 `void e;` 掩掉 → 删除该行与 `void`。
15. **`op-0104-gdi-repaint.test.ts:136-143`**：`mkWithRecords(8)` 造了 `e`/`frame`，真正断言用的是 `e2` ⇒ 无用脚手架。
16. **`text-layout.test.ts:28`**：`if (!over.style?.main && over.style?.main) throw new Error('unreachable');` —— 恒假分支（`&&` 两侧互斥），是残留；删。
17. **`option-font-speed-menu.test.ts:8` 表格注释**宣称 4 条"守卫"对应 4 个现象，但文件里是 12 条 4 主题混装（见 2.7）——注释本身没错，但文件粒度不合理。

### 2.7 重复覆盖到"应该拆文件"的程度

18. **`option-font-speed-menu.test.ts`**：4 个不相关主题同处：
    - 字体表 `0x2DC/0x2DD/0x2DE`（`:61-97`）↔ `adv-msgwin.test.ts:112-123`（`0x2DE`）重复；
    - 菜单 `0xA1/0xA2/0xA3`（`:126-161`）↔ `op-a2-a3.test.ts:63` 起（同族）重复，`:153-161` 的"闸门 A 计数 0"是把"VM 指令不该调 native"重验一遍；
    - 速度 `0x1B5`（`:167-172`）↔ `adv-msgwin.test.ts:702-719`（后者还多钉了"`0x74` 不得改注册表"）。
    处置：拆成落点（并入 `adv-msgwin` / 并入 `op-a2-a3`），本文件即可删除。

### 2.8 ★守卫装错了地方：`0x5B` 那组的**真实根因无人守**

19. **`option-font-speed-menu.test.ts:103-120`** 对应注释表里的"现象 2"（`:7`
    > `面板说 i05b 是缺口，可它"就是 ne"…面板行只有助记符：i0b5 …被读成 0x05B`

    ）。但断言体只做**表成员关系**：
    ```ts
    assert.equal(OPS.has(0x5b), true, '0x5B 必须走真实现');
    assert.equal(NATIVE_OPS.has(0xb5), true, '0x0B5（DsPlaySound：SE 通道起播）2026-09 起是音频族真实现（native）');
    assert.equal(ENGINE_INTERNAL_OPS.has(0x5b), false, …);
    ```
    而真实根因（**面板不会把 `0xb5` 打成 `0x0b5`**）的修复在别处：`control/control.ts:38-43`
    ```ts
    /** ★为什么必须带 opcode：助记符在缺名时是 `i0b5` 这种"i + 三位十六进制"，极易与别的 opcode 混读 … */
    function opHex(opcode: number): string { return `0x${opcode.toString(16).padStart(3, '0')}`; }
    ```
    反例实验 A：把 `control/control.ts:43` 的 `padStart(3,'0')` 删掉（回到 `0xb5`，症状原文复现）⇒ **本组 24 个文件全绿**（`debug-break.test.ts:189-199` 只守面板"不得硬编码事件类型清单"，不守 `opHex`）。
    反例实验 B：把 `OPS`/`NATIVE_OPS` 的成员关系改回去 ⇒ 会红，但那是否就是当时的修复无法从测试看出。
    ⇒ 结论：这组的 3 条是"注册表分类棘轮"（有轻微价值），但**现象 2 的可见面（面板十六进制格式）没有守卫**。处置：把 `opHex` 抽成可导入的纯函数并加一条 3 用例断言（`0xb5→'0x0b5'`、`0x1fb→'0x1fb'`、`0x5b→'0x05b'`）。

18b. **`adv-string.test.ts`**：`:141-158`（`0x148/0x149` 的"暂无用，仅建模"）本身就是低价值建模测试；`:51-70`（save/load-int 的"真实用法"）用**测试自己手算的 add/mod** 模拟脚本（`:62` `v = (v + 1) % 10;`），其 oracle 是"测试自己写的算术"，与 `:28-49` 覆盖同一族。处置：并成一条，或换真语料（`SC5450` 的计数循环）做 E3。

## 3. 重复覆盖矩阵

### 3.1 本组内部

| 不变量 | 重复处 | 更强的一处 | 建议 |
|---|---|---|---|
| 点击"先贴完整页再放行"（T-0033） | `adv-msgwin:272-299`、`adv-msgwin:687-699`、`char-reveal:245-259` | `adv-msgwin:272-299`（含"不清 bit30 / 消费点击"） | 保留一处，另两处改指针注释 |
| 逐字速度＝每字 × `max(speed, 一帧)` | `adv-msgwin:616-700`、`char-reveal:91-117`、`char-reveal:218-227`、`option-font-speed-menu:174-197` | `adv-msgwin:616`（手算帧数）+ `char-reveal:101`（精确 1000/60） | 删 `option-font-speed-menu:174-197`（镜像版） |
| "不补拍"（一帧最多 1 字） | `char-reveal:129-164`（`:148`）、`option-font-speed-menu:184-197`（`:190`） | `char-reveal:129`（含 5 s 卡顿反例） | 删后者 |
| `revealedOf` 无显现态 = 全部显示 / 门控窗 = 0 | `text-layout:227-237`、`char-reveal:398-420`、`char-reveal:433-455` | `text-layout:227`（含 `-1` 语义） | `char-reveal` 两条可并为一条 |
| `0x300` 闸门循环（贴出→停留→清场→重贴） | `char-reveal:334-366`、`char-reveal:368-389`（关闸） | **`config1-chain:141-161`（E3 真语料）** | 合成版只留"关闸"那条 |
| `0x1B5` 双写字段+注册表 | `adv-msgwin:702-719`、`option-font-speed-menu:167-172` | `adv-msgwin:702` | 删后者 |
| `0x2DE` 字体名→下标（含 `@` 前缀、越界 -1） | `adv-msgwin:112-123`、`option-font-speed-menu:84-93` | `adv-msgwin:112`（多钉 `@` 剥前缀） | 删后者 |
| `0x20A` 重排不动游标/内容 | `char-reveal:261-273`、`op-6-09:95-132` | `op-6-09:95`（含 cell 载荷门） | 保留 `op-6-09`，删 `char-reveal:261` 或合并 |
| `0x1D2` 记录 push（win/字段） | `adv-msgwin:828-855`、`msgwin-default-window:49-80`、`op-1d0-page-index` 前奏 | 各自一处（默认窗口径 / 页表下标 / key 查询） | 分工可接受，不合并 |
| ADV 位（`0x8000000`）由 `0x71/0x88/0x19B/0x19C` 置清 | `adv-msgwin:180-207`、`adv-msgwin:394-406`、`adv-string:83-111`、`op-10-002:41-60` | `adv-msgwin:180-207` | `adv-string:83-111` 可压缩 |
| 悬停两段式 / labelC / 清表 | `adv-msgwin:415-566`（5 组） | **`route-dispatch:109-217`** | 删 `adv-msgwin` 的重复组（见下） |

### 3.2 与全仓其它测试

| 不变量 | 本组 | 组外 | 更强的一处 |
|---|---|---|---|
| 悬停 enter/leave 两段式 | `adv-msgwin:524-552` | `route-dispatch:109-126` | 组外（`pickHoverLabel` + 同源门面，口径更贴产品路径） |
| 点击走 labelC + 返回点 = 门指令 dword | `adv-msgwin:438-477` | `route-dispatch:131-153` | 组外（用真 `stepOnce`，`gateDword===17` 精确） |
| 悬停不推进页 / 重跑门幂等（T-0016） | `adv-msgwin:230-261`、`adv-msgwin:554-566` | `route-dispatch:168-193` | 两者互补：组内是"逐字重放"，组外是"页/文本不变" |
| `0x93` 清路由表 | `adv-msgwin:511-523` | `route-dispatch:198-217` | 组外（多断 `hover`/`hitDone` 语义） |
| 按住左键只推进一页（T-0027） | `adv-msgwin:344-356` | `input.test:76-90`（刷子层） | 层次不同，都留 |
| 逐字期间点击（T-0033） | `adv-msgwin:272-299` | `frame-loop:83-133`（驱动层） | 都留（模型层 vs 帧循环层） |
| `0x300` 闸门循环 | `char-reveal:334-366` | `config1-chain:141-161`（E3） | 组外 |
| 颜色不回溯 / 角色名溢出 | `text-style-snapshot:87-136` | `config1-chain:376-520`（T-0102 真语料） | 都留（E2 精确 + E3 场景） |
| `bgrToRgb` 通道顺序 | `text-style-snapshot:188-215`、`adv-name-color-chain:96-110`、`op-0104:81-94` | — | `text-style-snapshot:188`（raw 位表达式独立复现） |
| `0x82` 重画门/不写操作数 | `op-0104:81-116` | `config1-chain:431-520` | 都留 |
| `0x12F` 排序 | `ops-142-12f-306:119-159` | `config1-chain:302-334` | 都留 |
| `0x2EE→0x2ED` 读写闭环 | `op-2ee-message-fade:90-101` | `op-2ed-and-bit-index:44-54` | 组外更端到端；组内独有"注册表落盘通知" |
| 缺纹理 ⇒ 跳过（不画白块） | `msg-text-range:59-73` | `missing-texture-skips-item:70-99` | 组外（解析 `if (!tex)` 块，覆盖更全） |
| `0x1D2/0x1D3` push/查询 | `adv-msgwin:828-855`、`msgwin-default-window` | `op-a2-a3:240-271` | 组外（key/组首/越界） |
| `0x5B`/`0x0B5` 表分类 | `option-font-speed-menu:103-110` | 无（`operand-plan.test.ts:122` 只有 '0x5b':'ne' 的助记符名） | 组内唯一，但**真实根因 `control/control.ts:42-43` 无人守**（见 2.8） |
| ADV 分支早于 sleep 门 | `op-10-002:70-95` | `frame-loop:245-273`（sleep 门语义）、`op-3-004:87-98` | 都留 |

## 4. 可被新调试能力替代 / 增强的测试

### 4.1 探针型（一次 `dbg` 现场查询即可定位）vs 守卫型（必须留回归）

| 文件 | 探针型部分（dbg 一次即可复现现场） | 建议 |
|---|---|---|
| `op-0100-reveal-current-window` | 「进 SC0000 后点一下 ⇒ 窗 8 被发布回屏」可用 `node tools/dbg.cjs window` / `slot` / `frame` 在活会话里看 `msgWins` 键集与游标 | 现场排查用 dbg；`:96-124` 三条例作为**守卫**保留 |
| `text-style-snapshot` | 「角色名颜色溢出」现场 = `dbg global 21664`（全局色）+ `window`（win9 的 fill） | E3 那两条保留（真语料 + 场景级不变量）；dbg 只用于下次复现 |
| `adv-name-color-chain` | 派生链 `14acdc/14b0c4/14acda/f807b` 全在 global → `dbg global 14acdc 14b0c4 14acda` 一条命令即可 | 保留（它把"探针实测 vs CVINIT oracle"固化成回归，正是探针的替代品） |
| `adv-reveal-under-throttle` | 「屏上停在第 0 字」现场 = 事件断点 + `dbg` 看 `textRevealing`/`reveal.shown`；`diag:text` 也直接打 `[reveal] win=N x/总数` | 两条都保留（它是"发布通路断了"的模型级开关） |
| `op-3-004` / `op-10-002` | 「少等一拍」现场只能靠帧循环日志（`dbg` 查询不是时序工具） | 保留 |
| `adv-msgwin` 的 `0x90/0x93` 路由组 | 现场可用 `dbg` 查 `routes`（cursor/hover/count） | 让位给 `route-dispatch`（见第 5 节第 1 条） |

结论：**探针型用例不需要"因为有了 dbg 就删"** —— dbg 的价值是"下次现场定位更快"，测试的价值是"下次改坏立刻红"。真正该让位的是**重复**，不是探针。

### 4.2 `npm run replay` + `npm run shot` 能否把 E2 合成用例升级成 E3/E4

先说机制（已核对源码）：

- `FrameDigest`（`src/frame/digest.ts:38-58`）的 **engine 段**包含 `gates{waitFlags,awaitingAdvance,advActive,textRevealing,sleepUntil}`、`msgWins`（含逐字游标 `revealed`）、`pages`、`routes{count,cursor,hover,shown}`。`npm run replay` 判据 = **逐帧 engine 段相等**（`src/tools/replay.ts:1-18`），录制端 `npm run record` 走 `webContents.sendInputEvent`（真 DOM 输入链，`tools/record.cjs:1-16`）。
- 因此 **replay 能覆盖的**：`op-10-002`（ADV 门序）、`adv-reveal-under-throttle`（每帧 `revealed` 序列）、`op-0100`（`msgWins` 集合变化）、`char-reveal` 的 `0x300` 循环（`revealed` 序列）、`adv-msgwin` 的点击/悬停组（`routes.cursor/hover` + `pages`）、T-0033/T-0027。
- **replay 不能覆盖的**：任何**像素**问题 —— 文本颜色/AA/粗细/α（T-0035/T-0042/T-0102 的"白底/更粗更亮"）不在 digest 里。这些只能靠 `npm run shot` 的 PNG。

可行的升级路径（按性价比排序）：

1. **可 CI 的 E3（推荐先做）**：`scenario-replay.test.ts` 已经证明"Scenario → TraceRecorder → runReplay ⇒ engine 段逐帧相等"能在 CI 里跑（合成脚本）。把 Scenario 换成**真语料 + 真输入时间线**：`scenarioRun.ts` 在 headless 驱动 `install/*.BIN`，事件按 `atFrame`/`atMs`/`afterMarker` 注入（`tools/scenarios/gamestart.json` 已有 Game Start 链）。这样 `adv-msgwin:209-501` 那一批"手搓 `makeCtx` + 手动 `moveAndClick`"的用例，可以在**真脚本**上重写为"到 ADV 页 ⇒ 在第 N 帧注入点击 ⇒ 断言 digest/状态"。收益：从 E2 升到 E3，且不再依赖"猜引擎在哪一帧做什么"。
2. **本地 E4 闸门（人工触发）**：`npm run record -- --scenario adv-wait.json` → `npm run replay .tmp/adv-wait.jsonl.gz`。★注意 `.tmp/replay-trace.jsonl.gz` 目前只有 20 B（空壳），**没有可作为 fixture 的录制产物**，且 `.tmp/` 不入库 ⇒ 这条**不能当 CI 守卫**，只能当发版前的手工闸门。
3. **像素（只此一途）**：`npm run shot -- --gamestart` 走真链路截 `SN0000` 首文案 / ADV 页，与真机截图（T-0035 evidence 的参照图）做 diff。当前 `text-aa:108-123` 只能把"真机量到的 (233,230,228)"当常量；shot 能把它变成**可重复的 E4**。限制：`shot.cjs` 需要 Electron（`npm run build:electron` + 窗口），不适合 CI；且没有 golden PNG 目录（`.tmp/shot-*.png` 是散落的临时产物）。
4. **`dbg:srv` 的定位**：常驻守护 + 条件断点（`src/vm/debugBreak.ts`）适合"现场抓第一次出错的帧"，不适合做回归 —— 它是**第 1 步的前置工具**（用它确认场景/帧号，再把该帧写成 Scenario 的 `atFrame`）。

## 5. 本组最该改的 3 件事

### ① 去重：`adv-msgwin` 的路由组让位给 `route-dispatch`（外部重复，最大一块）

- **重复对**：`adv-msgwin.test.ts:415-425`（`0x090` 登记形状）、`:427-436`（表满抛错）、`:438-477`（labelC + 返回点）、`:479-501`（右键不派发）、`:511-523`（`0x093` 清表）、`:524-566`（悬停两段式 / 悬停不推进页）
  ↔ `route-dispatch.test.ts:109-126`、`:131-153`、`:168-193`、`:198-217`
- **判据**：`route-dispatch` 用**真 `stepOnce`**（返回点精确到 `gateDword===17`，`:144-146`），`adv-msgwin` 是手搓 `makeCtx`（自己在 `:464-474` 承认"精确断言在 `route-dispatch` 判据②"）⇒ 口径精度：组外 > 组内。
- **动作**：删 `adv-msgwin:415-501` 与 `:511-523`，把 `:524-566` 压成"悬停门面（`pickHoverLabel`）只做判定、不动 ip"一条（该门面的存在理由见 `harness.ts:66-80`）；预计 −5 条用例 / −90 行。
- **收益**：同一不变量只维护一份口径 —— 正是 `harness.ts:1-10` 记录的"漂移病"。

### ② 修同义反复与矛盾断言（4 处，全部带反例实验）

| file:line | 现状 | 反例实验（会不会红） | 改法 |
|---|---|---|---|
| `adv-msgwin.test.ts:679-684` | 两侧同乘 `revealInterval(5)` | `revealInterval → Math.max(speedMs,100)` ⇒ **仍绿** | 改 `assert.equal(st.intervalMs, 1000/60)` |
| `option-font-speed-menu.test.ts:179` | 期望 = `Math.max(1, REVEAL_FRAME_MS)`（import 被测常量） | `REVEAL_FRAME_MS → 1` ⇒ **仍绿** | 写 `1000/60` |
| `option-font-speed-menu.test.ts:199-206` | `span()` 对被测返回值做乘法，与 `:174-182` 同义 | 删掉 `:177` 后任何"恒 99"假实现仍绿 | 删除，只留 `:174-197` |
| `char-reveal.test.ts:448`（注释）vs `:451-454`（断言） | 注释称"2 字/100 ms"，断言实为"1 字/80 ms 调用" | `revealInterval → Math.max(speedMs,1)` ⇒ **仍绿** | 改注释 + 补 `assert.equal(st.intervalMs, 1000/60)` |

### ③ E3 用例的"成本 + 产物守卫"

- **成本**（实测：plain chain 3.14 s / previewProbe 4.13 s / advReturnProbe 6.00 s）：
  `adv-name-color-chain.test.ts` 共 3 次 `runConfig1Chain`，其中 **`:70`（test1）的 opts 与 `:82` 循环里 `msg=1` 的那次完全相同** ⇒ 加模块级 memo（照 `config1-chain.test.ts:27-28` 的 `cached ??=`）即可 3 次 → 2 次，**19.6 s → ≈13.6 s**。`text-style-snapshot:139` 与 `adv-name-color-chain` 也在跑同一份链路，跨文件不共享（各自进程），但同文件内共享是免费的。
- **产物守卫**：`config1-chain.test.ts:60-68` 的 `localizedConfigMissing()` + `t.skip(miss)` 是对的；`text-style-snapshot.test.ts:139` 与 `adv-name-color-chain.test.ts:70/:82` **没有**这道守卫 —— 缺 `install/CONFIG*.BIN` 时它们会以"断言不符"的形式失败（`text-style-snapshot:144` `p!.win9Fills.length > 50`），看起来像回归。把该守卫提到共享 helper（如 `test/e3Artifacts.ts`），三处共用。
- **顺带**（同一改动的范围，若允许第 4 条）：删 `msg-text-range.test.ts:59-73`（与 `missing-texture-skips-item.test.ts:70-99` 守同一条源码分支，且正则窗口重构即假红）；删 `option-font-speed-menu.test.ts` 整文件（内容并入 `adv-msgwin` / `op-a2-a3` / 注册表棘轮，见 2.7）。

## 6. 附：审计用的实测/核对记录

- 24 文件 `wc -l` 合计 5082 行；`grep -c '^test('` 合计 ≈177 处 `test(` 调用（`adv-msgwin` 33 条最多；`op-6-05-step-slot.test.ts` 的 `for (const op of [0x1a8, 0xaf])` 把 1 处调用展开成 2 条 ⇒ 运行期条数略多）。
- 24 文件内 **无 `t.skip`/`test.skip`**（组外 `config1-chain.test.ts:73` 有 `t.skip`）。
- 本轮只读；除本文件外未落任何写：`app/amayui-emulator` 下仅执行了 `import('./src/tools/config1Chain.js')` 计时（无文件写入，`grep -n writeFile tools/config1Chain.ts` 无命中）。
- 未运行 `npm test` / `npm run verify` / `npm run shot`。
