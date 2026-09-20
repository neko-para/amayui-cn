# T-0100 · 过程文档（changes.md）

## 2026-09-20

## 轮 8 · 修复落地（主 agent 自己实现，按 `design.md` 的最小修复集）

**根因**：帧泵发布了「所有已知窗」而引擎只泵**当前窗**（raw 13943-13945）。三处落点全部收敛：

| # | 文件 | 改动 | 引擎依据 |
|---|---|---|---|
| ① | `src/vm/engine.ts` `serviceRevealAdvanceInput` | 把 `for (const win of [...msgwin.reveal.keys()])` 的全窗发布改为 **`const cur = resolveWin(msgwin.lastArg)` 单窗** | raw 13943-13945（`do sub_45BE20(Font, *(_DWORD*)(_this+489484)); while(!result)`；`489484/4 = 122371` = 当前窗） |
| ② | `src/vm/engine.ts` `serviceTextReveal` | `tickReveal`（全窗）→ `tickRevealWin(cur, …)` **单窗**推进 + 发布 | ADV 支 raw 13907/13920/13944/13962 都只把 `Engine[122371]` 交给 `sub_45BE20`；`0x300` 闸门窗由 `serviceWinReveal` 单独负责（raw 13834-13888） |
| ③ | `src/vm/handlers/msgwin.ts` `0x70` | `emitAllWins(e)` → **`emitWin(e, win)`** | 落点 `sub_45D660`（raw 73133-73193）只写几何 + 回看页，**不重画任何窗的正文行**（同页 `:1339` 已为 `0x74` 做过同样的删除） |

**辅助（防复发，非行为改动）**
- `emitAllWins` 加 ⚠ 文档：**引擎没有任何指令会把文本发布给别的窗**；它历史上造成过两次用户可见缺陷（全局样式糊到已排版的窗 `test/text-style-snapshot.test.ts`；`0x70` 重画已 detach 的窗 = 本票）。自本票起**已无调用者**，保留仅作历史对照（遗留文档仍提到它）。
- `MsgWindow.tickReveal`（全窗版）加 ⚠ 文档：**帧泵不许用**，只作 `tickRevealWin` 的批量包装；自本票起无产品调用者。

**守卫** `test/op-0100-reveal-current-window.test.ts`（**4/4 绿**）
1. **前置 + 辨别力证明**：合成脚本（窗 8 入队并武装逐字 → `0x71` 切到窗 1 → 窗 1 入队并武装）后，断言 `reveal` 的键**确实同时含 1 与 8** ⇒ 旧的全窗发布写法**必然**把 8 一起发布（因此下面三条不是空断言）。
2. **①** 逐字期间点击（`pressMouse(0)` + `serviceRevealAdvanceInput()`）：`msgWinSync` **只收到窗 1**，**不得**含 8；且当前窗被贴满。
3. **②** `serviceTextReveal(later)`：残留窗 8 的 `shown` **不许**被推进、也不许被发布。
4. **③** `0x70 1 …`：只发布窗 1；★此时窗 8 的 `slots` **仍在**（证明修的是"发布"而不是"删数据"）。
★另外断言 `reveal.get(8).active` 仍为 `true` ⇒ **明令禁止**"清 `reveal[8]`/`slots[8]`"那类修法。

**验证（主 agent 自己的运行，非子代理转述）**
- 新守卫 `4/4`；受影响族 12 文件 **124/124**（`adv-msgwin`/`char-reveal`/`op-3-004-furigana-outer-gate`/`op-10-002-adv-sleep-order`/`op-1d0-page-index`/`frame-loop`/`text-style-snapshot`/`transition-render-wiring`/`op-6-09-window-relayout`/`headless-needs-render`/`wait-gate-timer`/`anim-window-done`）；
- 真语料链 5 文件 **45/45**（`config1-chain`（CONFIG 屏的 `0x300` 闸门 + 逐字，最相关）/`game-start-chain`/`scenario-replay`/`stage-loop`/`scene-report`）；
- `npx tsc --noEmit -p tsconfig.json` **exit 0**。
- ⏳ **`npm run verify` 尚未能全绿**：`T-0096`（Live2D）仍在飞，其 4 条自测 `l2d-node-compose` 红 ⇒ 全量门禁等它落地后跑（本票因此暂留 `doing`）。

**未做/未碰（按诊断的"禁止"清单）**：没有在场景边界 `msgwin.reset()`、没有清 `slots[8]`/`reveal[8]`、没有给 `#holdFrames` 打补丁、没有动 `scDetachTexture` 的区间清、没有用"清 DrawItem"修。
**可选第 4 条未做**：把"当前窗"落成解析后的独立字段（`_this[122371]` 同名同义）—— 属清理项，行为无差；`lastArg` 仍是原始操作数，`resolveWin` 在**使用点**求值（与文件其余处一致）。

## 2026-09-20

## 轮 8 · 追加：**本票的改动 ② 自己引入了一个回归**（用户实测发现并已修）+ 一处引擎建模反了

用户实测（轮 8 反馈 1）：「ADV 的逐字渲染逻辑坏了，必须等待逐字完成后才直接展示出来」。
★**根因是我**：改动 ② 把 `serviceTextReveal` 从 `tickReveal`（全窗）收窄成 `tickRevealWin(cur)` 时，
**连带把 `for (const win of dirty) this.#publishReveal(win);` 这一行一起删掉了**。

### 坑 A：推进了游标但不发布（本票引入）

- 后果：游标在 VM 里照常走（`0x6E` 后约 `max(MessageSpeed, 一帧)`/字），但宿主只在 `msgWinSync` 时才重绘 ⇒
  屏上一直停在第 0 个字，直到别的路径（点击/收尾）发布一次 ⇒ 用户看到的是「等逐字完成后一次性出现」。
- **E4 铁证**（`textLayer.ts:104` 只在 `revealed` **变化**时打印 `[reveal] win=N x/总数`）：用户日志里
  ADV 的 `[reveal]` 只有 `0/22` 与最终 `26/26`，中间态一个都没有；而同一份日志里 `win=9`
  （走 `0x300` 闸门泵那条**不经此处**的路）是 `1/10, 2/10, … 10/10` **逐步**的。
- 修法：把那行发布**原样加回**（只发布 `cur`，仍然满足本票"不发布残留窗"的要求）。
- 探针（`.tmp/t0100/probe-adv-reveal.ts`）实测：修前 `msgWinSync` 全程只 1 次（`rev=-1`）；
  修后是 `rev=1,2,3,4,5,6` 的逐步序列。
- **判别力已证明**：临时删掉那行 ⇒ 新守卫 `adv-reveal-under-throttle.test.ts` 两条**全红**；还原 ⇒ 绿。

### 坑 B：节流位置位期间没跑泵（**不是**本票引入，但同批修掉）

引擎主循环 raw **21176-21181**：
```c
if ( (v35 & 0x20000000) != 0 ) {        // ← 节流位（= SLEEP_GATE）
  sub_409400(_this);                   // ★⇒ **调文本泵**：等节拍(sub_453B60) → 推一个字(sub_45BE20)
  if ( *(_DWORD *)(_this + 489860) )   //   只有 0x300 闸门槽活跃时才不派发脚本
    goto LABEL_215;
}
```
即**节流位不是「空等」，而是「按节拍继续推进并重画」**。而 `frame/loop.ts` 的 `sleep` 分支修前
**什么都不做** ⇒ 门内既不推进也不重绘。★`0x6E` 在轮 6 就置了节流位，而 **轮 7 的 `T-0094` 把它加到了
`0x196 display-furigana`**（语料 **6341 处**、且是在一句**中间**追加文本）⇒ 门内停顿的频率在轮 7 之后
明显上升 —— 这解释了用户「逐字坏掉可能更早」的直觉。
- 修法：`sleep` 分支里加 `e.serviceTextReveal(nowMs)`（忠实于 raw 21178），门仍然照旧阻塞脚本派发。
- **判别力已证明**：临时删掉该调用 ⇒ 守卫的「坑 B」一条**变红**；还原 ⇒ 绿。

### 本轮追加的守卫与验证

- 新增 `test/adv-reveal-under-throttle.test.ts`（2 条）：坑 A = 「0 < revealed < total 的中间态 ≥2 个」；
  坑 B = 「**门还置着的时候**必须收到过发布」（首版守卫只断言"门后还有新中间态"，**撤销修复后仍绿 =
  假守卫**，已改成按 `waitFlags & SLEEP_GATE` 当场打点的精确判据）。
- 两条修复的判别力都用 `.tmp/t0100/prove-guards.mjs` **机械证明**过（撤销→红、还原→绿，并用 sha256
  自检还原成功）。
- `npm run verify` 在本轮结算时复跑（见结算记录）。
