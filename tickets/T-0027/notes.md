# T-0027 · 过程文档（notes.md）

## 2026-09-14

## 结论（定因）

**引擎有「两把输入刷子」，emulator 只有一把，而等待推进泵用的是错的那把。**

| | 引擎函数 | 语义 | 谁用 |
|---|---|---|---|
| 消费刷 | `sub_478090`(raw 92449) | 吸取**挂起事件**（键挂起 `_this[1159]`、手柄按钮挂起 `_this[1158]`、POV、按钮累加器 `_this[1710]`），**读后清零** | 等待推进泵 `sub_411BC0`(raw 20238)、`poll-input`(0x101)、`0x100`、`0xFA`、`sub_4053C0`(eatAllInput) |
| 实时刷 | `sub_4780D0`(raw 92465) | `sub_4770A0`(GetAsyncKeyState 键盘) + `sub_477150`(**鼠标左右键实时按住态**) + `sub_4772E0` | ADV 分支 `sub_411900`(raw 20111)、`0xFF` |

关键点：`sub_478090` 的调用链里**没有** `sub_477150` ⇒ **按住左键不会每帧重新置 bit4**。
鼠标左键的挂起位来自 WndProc：WM_LBUTTONDOWN/WM_LBUTTONUP → `sub_4B8DC0`(raw 140839) → 输入管理器 `[1158]`(=`sub_4B8DC0` 里的 `_this[1416]`，字节 5664 = 1032+4632 = 输入管理器 `[1158]`)，再由 `sub_477280` 消费成掩码位 `4+i`（i=0 即 bit4）并**清掉挂起位**。
⇒ 引擎：**一次按下 = 一次推进**；按住不放 = 只推进一页。

emulator：`InputManager.flush()`（`src/vm/input.ts` 的 `(this.buttons & 1)` / `(this.buttons & 2)`）把 `buttons`（实时按住态）也 OR 进掩码，而等待泵 `serviceAdvanceWait`（`src/vm/engine.ts:788`）正是吃这把刷子 ⇒ 按住期间**每帧** `advancePressed(mask) === true` ⇒ 每帧翻一页。

## 复现（headless，已跑）

按 `repro.md` §A 的模型跑（headless，`StubNative` + `Engine`）：显示面板 `0x94` → `0x6e/0x6f` 一页 → `0x72` 置等待门 → `setCursor` + `pressMouse(0)`（**不松**）→ 每帧「门在则泵一次 + 脚本跑回 `0x72` 重新挂起」，第 3 帧才 `releaseMouse(0)`。
输出：`推进页数 = 3`（期望 1）。⇒ 60Hz 下一次约 50ms 的普通点击天然跨 3 帧 ⇒ 连翻 3 页；松开越晚翻得越多。

## 候选次因（排查记录）

1. **【主因】按住态被当新按下** —— 见上，已定。
2. **【放大因子】释放事件丢失后按钮态无自愈**：`app/amayui-emulator/src/renderer/pixi/inputAttach.ts` 只挂了 `mousemove/mouseleave/mousedown/mouseup/wheel/contextmenu`；`mouseleave` 只把光标置无效（`setCursor(-100000,-100000,false)`），**不清按钮**，也没有 `blur`/`visibilitychange` 兜底。而 `releaseMouse()` 是清 `buttons` 的唯一路径（`src/vm/input.ts:172`）。一旦 mouseup 不成对（指针移出窗口后松开、窗口失焦、系统级拖拽），`buttons` 永久为 1 ⇒ 主因被无限放大成「按一下就一直翻」。这与第二层 `frame-pump-input-refresh` 的 `modeled-unverified` 判定是同一处保真缺口（引擎每帧轮询 OS 真值，emulator 靠 DOM 事件累积）。修主因时必须一并给自愈路径，否则仍能复现「停不下来」。
3. **节拍因子（非根因）**：`message:MessageSpeed` 缺键时 `cfgInt(..., 0)` ⇒ 逐字显现几乎瞬时（`msgwin.ts` 的「0 = 立即全显」/ 预算 `行数 × max(MessageSpeed, 一帧)`）⇒ 没有天然节流，每帧放行就显得「快进非常多个」。修完刷子后此项只影响观感，不影响正确性。
4. **已排除**：批上限 `SAFETY_PER_FRAME=10000` 不是来源 —— 每页都有 `0x72` 门，批派发遇 `awaitingAdvance` 即 break（`src/frame/loop.ts:298`），一帧跑不穿多页。
5. **相关但独立**：等待态里的**悬停派发**（`serviceAdvanceWait` ③）也会清门放行，属 `T-0016`（ADV 侧边栏 hover）/`T-0007`（headless 悬停），不在本票范围。

## 环境（只记录，不归因）

用户环境：macOS + jp 版资源。本票的定因完全落在引擎/emulator 的输入刷子语义上，与平台、资源版本无关；平台/资源只解释「为什么这个环境更容易让人注意到」（macOS 上指针移出窗口/窗口失焦更常见 ⇒ 次因 2 更容易触发）。

## 不在本票范围

- 不实现 panelB / `0x7C` 右键取消跳读通路（见 `adv-advance-route-table` 的登记缺口）。
- 不改逐字显现节拍模型（`adv-text-reveal-progress`）。
- 不做 `--record/--replay` 轨迹格式变更；若刷子拆分影响快照字段（`pressLatch`/`mouseEdge`），只做增量并在 changes.md 记明。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

调查与候选次因见 notes.md；复现步骤见 repro.md；实现级变更见 changes.md。环境（macOS + jp 资源）只记录不归因。
