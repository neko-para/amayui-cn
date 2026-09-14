# T-0016 · 过程文档（changes.md）

## 2026-09-14

## 第 1 次变更（2026-09）：修「ADV 页右侧悬停 ⇒ 中间的 ADV 文字不断被重放（页不推进）」

### 现象与复现（真实语料，E3）

链路：GAME START → … → SN0000 首文案（`SN0000.txt:1224`）的等待态；把光标移到**右侧侧边栏**的
`i090 4ce e9 32 104 …`（= `SN0000.txt:74` 展开态那条热点，矩形 1230,233–1280,493）。
修复前逐帧观测（临时脚本 `.tmp/t16-repro2.mts`，400 帧）：

```
f=26501 ip=104 await=0 routes=7/0/0   disp=hover-enter:0x30e   ← 悬停进入 ⇒ 派发 c74（展开侧边栏）
f=26502 ip=122 … routes=0/-1/-1                                ← 走 i093（清热点表）→ 16 个 i220 平移窗 → wait
★显现在 f=26516 被重置 52→0（ip=917）                          ← ★ret 回到门指令重跑 0x72 ⇒ 整页文字从头重放
★显现在 f=26570 被重置 52→0（ip=917）                          ← 第二次（表重登记后光标换项、又一次 hover-enter）
页计数 0→1→2（每次重跑都记一页）
```

### 定因（引擎真值）

1. 悬停/点击派发的 label **带返回点 -3**（`sub_405360` raw 11030-11041：`retStack[top] = a2 + (ip-ip_base)>>2`），
   而 `0x72 wait-for-input` 长 3 dword ⇒ label 体末尾的 `ret` **正好回到门指令重跑**。
2. 引擎的 `0x72` 尾段（raw 28539-28555）只做三件事：`Engine[122371] = 窗`、查字格数（`sub_45A940(..., -1, 107705)`）、
   置 bit31；bit30 未置时置 `0x40000000` + `Engine[107704] = 0` + 重启 **▼ 字格节拍**。
   **文字逐字游标 `FontVWindow+132` 由 `sub_45BE20` 泵推进、由 `0x71`/`sub_45EC60` 复位，`0x72` 一概不动。**
3. emulator 把"启动逐字"放在 `0x72` 里、且只判"当前是否在显现"（`!isRevealing`）⇒ **重跑即重放**；
   `finishPage()` 也被重跑多次计数。

### 改了什么

| 文件 | 改动 |
|---|---|
| `src/vm/msgwin.ts` | 新增**内容版本号** `contentRevOf(win)`（`appendText`/`addRuby`/`endLine`/`beginNewMessage` 各 +1）与 `revealArmed(win)`/`markRevealArmed(win)`；`finishPage(win)` 按同一键**一页只记一次** |
| `src/vm/handlers/msgwin.ts` | `0x72` 只在「这一页的内容还没武装过显现」时 `beginReveal`（`!isRevealing(w) && !revealArmed(w)`），并记 `markRevealArmed(w)`（跳读的 `finishReveal` 分支同样记）；`finishPage(w)` 传窗号。注释订正：`0x72` 尾段武装的是 **▼ 字格**、不是文字 |
| `src/tools/gameStartChain.ts` | 结果新增 `revealRestarts`（内容版本不变而显现游标变小 = 重放一次）⇒ 真实语料上的可数指标 |
| `test/adv-msgwin.test.ts` | ★新守卫：重跑 `0x72` 不得重启已显完的显现；两条正对照（`0x71`+新文本 / 追加 show-text 必须重新逐字） |
| `test/route-dispatch.test.ts` | 判据③加强：`ret` 回到门指令后**再跑一次门指令**，页计数与文本都不得变 |
| `test/game-start-chain.test.ts` | E3：整条真实链路 `revealRestarts === 0`（修前实测 = 2） |

### 判据（先红后绿，逐条实测）

- 不修时：`adv-msgwin` 新守卫红（`7 !== 0` 那类）、`route-dispatch` 判据③红（页计数变）、E3 红（`实际重放 2 次`）。
- 修后：`npm run verify` 全绿（499/499 + 无新增死写）；E3 复现脚本 400 帧内 `reveal 重置 = 0`、页计数只记一次。
- 断言 `0x72` 重跑**不改变文本**（`textOf(8)` 不变）⇒ 满足本票验收 2 的"页不前进"。
