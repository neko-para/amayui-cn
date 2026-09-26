# T-0187 分析（2026-09-26）

两个现象**都已用「已测过的 ops 入口」复现**（不自己实现读档）：

```bash
# 实例：t0187（具名实例，base 注入真存档 SAVE76..79）
node app/amayui-emulator/tools/emu.mjs status  --instance t0187
node app/amayui-emulator/tools/ops/load-from-title.mjs --instance t0187 --slot 78 --expect SN0000.BIN   # 冷启动路径
node app/amayui-emulator/tools/ops/load-from-title.mjs --instance t0187 --slot 77 --expect SC0000.BIN   # 上一场景（阿瓦罗黄）
node app/amayui-emulator/tools/ops/load-from-adv.mjs   --instance t0187 --slot 78                        # ★游戏内读档（复现 ②）
node app/amayui-emulator/tools/emu.mjs probe --instance t0187
```

证据图：`.tmp/emudbg/t0187-sn0000-cold-01.png`（冷启动 = 白、无 ▼）、
`.tmp/emudbg/t0187-sc0000-slot77-01.png`（SC0000 存档 77 = 阿瓦罗黄台词）、
`.tmp/emudbg/t0187-sn0000-yellow-01.png`（游戏内读 78 = **旁白黄**）。

---

## ① ▼「点击继续」图标

### 关键运行期事实（推翻了旧口径）

| 观测 | 值 |
|---|---|
| 帧链（`frame`/`probe`） | `SYSTEM4.BIN:372 > NOVEL.BIN:124 > SN0000.BIN:2168` —— **SN0000 是 NOVEL 的子帧** |
| 槽 12 的贴图（宿主日志） | `bindTexture imgid=0x5190 slot=12` → `image 5190 -> SO026.AGF (448x112)` —— **不是** SO000(350×35) |
| 宿主确实发了格 | `[cell] win=8 槽=12 k=0 源=(0,56,56x56) 目标=(730,364)`（**只此一条**） |
| 此后引擎态 | `effectFlags=0x80000000`（**bit30 已清**）、`awaitingAdvance=true`、`charCursor=4 / charModulus=8` |
| 清 bit30 的那一刻 | 紧接着 `[hover-label] hover-enter 0x38f`（读档那几次点击把光标留在窗内 ⇒ 进页第一帧就派发悬浮） |
| 再补两次 hover（`0x30e` / `0x4b0`） | bit30 **仍是 0** |

### 归因（两条，缺一都不成立）

1. **旧口径「序章本来就没有 ▼（槽 12 = SO000 ⇒ y=56 越界被裁空）」是错的。**
   `SO026.AGF` 是 448×112 的两行 8 帧表，由**父帧 NOVEL** 的入口 preamble（`src/NOVEL.txt:6-11` 的
   `set-texture 5190 c`）在页面之前绑进槽 12；SN0000 页末 `i073` 的 `originY = (local-int 1) = 1×0x38 = 56`
   正是「取第 2 行」，源矩形 (0,56,56×56) **在界内**（`src/SN0000.txt:2990-2992`）。
   ⇒ 宿主 `pixiBackend.ts` 的「越界 ⇒ 引擎同样裁空」分支根本不触发（那条注释已过时）。
2. **▼ 只闪一拍就永远消失**：悬浮派发会经 `sub_4051A0`（raw 20335-20336）清 bit30，
   而 `0x72 wait-for-input` 的**门指令重跑**在 emulator 里不再武装它：
   - 引擎（raw 28539-28555，LABEL_17）：`if ((effect_flags & 0x40000000) == 0) { effect_flags |= 0x40000000; Engine[107704] = 0; sub_453A90(Engine+107650); }` —— **无条件**重新武装；
   - emulator（`src/vm/handlers/msgwin.ts` 的 `op_wait_for_input`）：这三行被放在 `if (!m.isRevealing(w) && !m.revealArmed(w))` 里
     —— 那道门是 `T-0016` 为「悬停 ret 回到门指令时别**重播文字**」加的，却把「重新武装图标」一并挡住了。
   ⇒ 悬浮一次（玩家几乎必然发生：鼠标就停在窗内）→ bit30 清零 → 图标再也不回来。

### 修法（未落地，属下一步）

把 `op_wait_for_input` 里 `e.effectFlags |= CHAR_REVEAL_ACTIVE`（连同 `Engine[107704] = 0` / 重启节拍）
**移出** `revealArmed` 门，只在 `if ((e.effectFlags & CHAR_REVEAL_ACTIVE) === 0)` 下执行；
`markRevealArmed` / `beginReveal` 仍留在门内（那才是 `T-0016` 要挡的东西）。
守卫要加一条：**hover 清 bit30 之后，门指令重跑必须让 ▼ 回来**（`test/char-reveal.test.ts`）。

---

## ② 读档后旁白变黄

### 脚本侧口径（钉死）

| 问题 | 答案 | 证据 |
|---|---|---|
| 谁给正文设色 | `i076 (global-int f807b)` / `i077 (global-int f807c)`（全局字体字段 `Font+1360/+1364`） | opcode 表 `0x76`/`0x77`（raw 28662-28682） |
| 谁决定「白还是角色色」 | `CHECKCONFIG` 的 `label_0000028c`：先 `f807b = ffffff`/`f807c = 0`，再按 `a9dd & 1/2` 用 `adcd[14acda]` 覆盖（`a9dd & 2` ⇒ **正文填充随角色**） | `src/CHECKCONFIG.txt:47-81`（票锚点 `:64`） |
| 白是在哪被重置的 | 各帧自己的**场景入口块**：`src/NOVEL.txt:121`、`src/SYSTEM4.txt:272`、每个 SC 脚本的 `1113` 一带 | `src/CHECKCONFIG.txt` 条目 / `NOVEL` 条目 |
| **SN0000 自己设色吗** | **不设**：全文件只有 2 处 `i076/i077`（`:487`/`:3237`），都在侧边栏「文本样式」菜单路径；主路径一处没有 | `grep -n 'i076 \|i077 ' src/SN0000.txt` |

⇒ 「序章旁白 = 白」这条口径的成立**依赖上一场景/场景入口留下的全局状态**，而不是 SN0000 自己的指令。

### 读档侧

- 读档恢复清单（引擎 `sub_410160` a4=3，raw 19703-19927）= 帧镜像 + 三个池（`0..count`）+ 三张全局 ip 表 +
  100 图像槽 + 1000 条记录 + `Engine[698852]` + `Engine+84088` 起 40 B + 面板/消息复位。
  **不含 Font 对象**（`Font+1360` 是引擎内存里的东西，存档里没有）。
- `f807b` / `14acda` 是**池外全局**：`0xF807B` = 1,015,931、`0x14ACDA` = 1,356,506，而 `SAVE78.DAT` 的
  int 池长 = **1,015,792**（`npx tsx src/tools/saveDump.ts …SAVE78.DAT` 实测；raw 19705 的 `memset`
  只盖 `4*capacity+4`、19747 的 `memcpy` 只盖 `4*fileCount`）⇒ 读档**既不还原也不清零**，沿用进程内旧值。
- 于是：上一场景最后一句是阿瓦罗（黄）⇒ CHECKCONFIG/NOVEL 入口都用这个旧值 ⇒ 序章第一页 = 黄。
  实测：`fill = #ffe100`（probe）+ 截图；`global f807b = 16769280`、`global 14acda = 0`、`a9dd = 2`。
- **冷启动同一槽 = 白**（截图 1）：白来自 SYSTEM4 入口块（`:272`）—— 它在 SYSTEM4 的 `i0ae`(line 143) 之后，
  正常进场景时跑、读档续跑时被跳过。

### 判定

- 这条「黄」在**当前 emulator 模型**下是**忠实**的：颜色状态本来就是「进程内旧值 + 脚本自己负责复位」，
  而 SN0000 的复位点在父帧 NOVEL 的入口块里（读档续跑不重跑）。
- **但「真机是否也黄」还没有 E4**：判据 = 存档 77（SC0000 阿瓦罗句）→ 游戏内 LOAD → 存档 78 → 看首句颜色。
  真机若是白，说明引擎在读档路径上还有一处我们没找到的复位/还原点，本票要重开一轮找它；
  真机若同样黄，则 ② 应改成 `dropped` 或「按现状收口」（脚本口径问题，不是重写侧缺陷）。

---

## 与既有票的边界

- `T-0144`（读档后 572B 立绘节点残留）、`T-0102`（进 SC 场景后 ADV 背景白）、`T-0067`（撤幕留帧）：
  这三张都在**绘制项/转场**面，本次两处现象都在**消息窗**面（字格图标 bit30 状态机 / 文本颜色状态），
  **不同源**；`T-0144` 与本票共用同一个读档入口但无共同字段。
- `T-0016`（悬停 ret 回到门指令 ⇒ 重播文字）：本票 ① 的缺陷正是那次修复**顺带挡住**的那一臂，
  属同一条门指令的两个语义被合并，修法要显式拆开。

## 落库清单（本次改了哪些）

- `analysis/scripts.json`：`NOVEL`（+场景入口颜色复位段/+`f807b` 槽/+不变量/+gotcha）、
  `SN0000`（+页块 2974-2993/+`14acda`、`f807b` 槽/+不变量/+2 条 gotcha/+gaps）、
  `CHECKCONFIG`（+读档时机 gotcha/+回链新能力）。
- `analysis/engine-capabilities.json`：`msgwin-char-reveal-grid`（`modeled-verified` → `partial`，note 订正两处）、
  **新增** `adv-text-color-state-carryover`（`modeled-unverified` / E1）。
- 生成物：`docs-new/05-scripts/{NOVEL,SN0000,CHECKCONFIG}.md`、`docs-new/03-engine/engine-capabilities.md`。
- 双向自检：`capabilities.js --validate` / `scripts.js --validate` 全绿。

## 未决 / 下一步

1. ① 的修法（3 行搬位置）+ 守卫——**待用户确认后实施**（本票 acceptance 要求 ▼ 可见且按节拍闪烁）。
2. ② 的 E4 判据（真机截图）——**需要用户提供**，否则只能按「脚本口径的必然结果」收口。
3. 过时注释：`app/amayui-emulator/src/renderer/pixiBackend.ts:1792-1794` 的「序章本来就没有 ▼」需随 ① 的修法一并改
   （该文件被多张票锚定，改前先跑 `tickets.js --anchors-in`）。
4. 本票 evidence 里 `src/*.txt` 的行号已由第三层的 `layout` 段覆盖（`SN0000` 2974-2993、`NOVEL` 119-126、`CHECKCONFIG` 52-82）。
