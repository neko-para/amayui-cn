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

证据图（已归档进本票 `evidence/`）：
`evidence/sn0000-cold-white-nodown.png`（冷启动读 78 = **白旁白、无 ▼**）、
`evidence/sc0000-slot77-avarol-yellow.png`（存档 77 = SC0000 阿瓦罗黄台词）、
`evidence/sn0000-ingame-load78-yellow.png`（游戏内读 78 = **旁白变黄**）。

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

### 修法（未落地，属下一步）+ **真机依据逐条核对**（不照表现倒推）

把 `op_wait_for_input` 里 `e.effectFlags |= CHAR_REVEAL_ACTIVE`（连同 `Engine[107704] = 0` / 重启节拍）
**移出** `revealArmed` 门，只在 `if ((e.effectFlags & CHAR_REVEAL_ACTIVE) === 0)` 下执行；
`markRevealArmed` / `beginReveal` 仍留在门内（那才是 `T-0016` 要挡的东西）。
守卫要加一条：**hover 清 bit30 之后，门指令重跑必须让 ▼ 回来**（`test/char-reveal.test.ts`）。

| # | 命题 | raw 证据（已逐条读体） |
|---|---|---|
| ① | `0x72` 的长度 = **3 dword** | `sub_41EEF0` 首行 `_this[30*cur + 95805] = 3`（raw 28484）；同族印证：1 操作数 = opcode + 2 dword（`0x1A0` argc=9 ⇒ 写 19） |
| ② | 悬浮分支会压返回点、跳 label、清等待位、再清 bit30 | `sub_411BC0` raw 20322-20339：`sub_403E70`(取 label) → `sub_405360(_this, -3)`(20328) → `ip = ipBase + 4*label`(20329-20332) → `effect_flags &= ~0x80000000`(20334) → `sub_4051A0`(20336) |
| ③ | 返回点 = **门指令本身** | `sub_405360` raw 11031-11041 压 `-3 + ((ipEnd-ipBegin)>>2)`；等待期间 ip 停在门**之后**（门长 3 dword）⇒ `-3` 正好退回门的起点 |
| ④ | `sub_4051A0` 清 bit30 | raw 10924-10935：`if (v2 & 0x40000000) { if (!(v2 & 0x100000)) sub_45A940(Font, Engine[122371], -2, 0); _this[174801] &= ~0x40000000; }` |
| ⑤ | `ret` 会跳回返回点 ⇒ 门重跑 | `0x5` = `sub_41A9B0` raw 25704-25727：弹帧返回栈 → `ip = ipBase + 4*v2` |
| ⑥ | 门重跑时**无条件**重新武装 | `sub_41EEF0` LABEL_17 raw 28539-28555：`if ((effect_flags & 0x40000000) == 0) { |= 0x40000000; Engine[107704] = 0; sub_453A90(Engine+107650); }` |
| ⑦ | 「门确实会被重跑」还有既有运行期旁证 | `T-0016` 修的正是同一条重跑（当时表现为「悬停侧边栏后整页文字被重新逐字（重放）」）⇒ 重跑真实发生；本轮只是把「重新武装图标」这一臂从那次加的门里分出来 |

⇒ 修法是 raw 28549-28554 的**忠实移植**（emulator 的 `dispatchWithReturn(label, -3)` 自身也已按 raw 11035-11037
实现成 dword 偏移口径，见 `engine.ts` 的注释）。仍未做的是**把结果钉成守卫**：`bit30 被清 ⇒ ret 回门 ⇒ 重新武装 ⇒
`[cell]` 再次出现` —— 该断言**已落地**（见下节）。

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

### 判定（★2026-09-26 **用户 E4 订正后**）

- ❌ **撤回**「这条黄是忠实的」这一结论：**用户真机核对 = 颜色总是正确恢复成白** ⇒ ② 是**我们要修的缺陷**。
- 我上一轮的解释（「池外全局 `f807b`/`14acda` 沿用旧值 + 脚本自己不复位」）只解释了 emulator **为什么黄**，
  不构成「引擎也黄」的证据 —— 那是**拿 emulator 的表现反推引擎**，属于臆测，已作废。
- **已从 raw 确证的、emulator 缺的那一块**（不是猜测）：
  `sub_410160` 在 `a7 && a4 >= 2`（= `0x1A1` **全量**读档；`0x19F` 短读档没有这一跳）时调用
  **`sub_45F1B0(Font, hFile)`**（raw 19421-19422）：
  - `sub_45EBE0(Font)`（raw 74482）= 清空 `Font+3364` 的 **72B 文本记录表**（与 `0x85` 同一函数）；
  - 再从存档把**文本缓冲记录**灌回去：每条 72B 经 `sub_45D3A0` 推入 `Font[841..843]`（raw 74494/74555-74557），
    另有一批 `{v42, v43}` 进 `Font+3380`（回看页表，`sub_45D240`，raw 74494）。
  ⇒ **全量读档会把「文本缓冲/记录表」从存档那一份恢复回来**，而 emulator 的 `SLOT_GAPS ③` 只承认
  「40 B 消息窗/字体状态未还原」—— 这一整块（`a6/a7`）**从未建模**。这正是「读档后正文/颜色状态该由谁决定」的
  缺口所在，也是本票接下来的主攻点。
- **仍未证的最后一步（不许当结论）**：白具体来自
  (a) 恢复的记录自带原样式/颜色（读档后的正文由恢复的那份渲染）、
  (b) `Font+1360/+1364` 也在该块内被覆盖、
  (c) 还是「父帧 preamble 在引擎里根本不重跑」。
  下一步 = 读完 `sub_45F1B0` 的块格式（`Buffer` 头 12 B、`*v3` 计数、11 dword/页）+ `0x71`/`0x6E` 的次序，
  再决定改 emulator 的哪一层；**在此之前不许再拿「池外全局保留旧值」解释读档后的正文颜色**。

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
- 三份守卫（★本机沙箱下**不要**用 `tsx --test` / `node --test`：node 测试运行器每个文件起子进程 ⇒ `spawn EPERM` 伪红；
  直接执行单个测试文件即可，`capability-ledger` 还需要 `--experimental-transform-types`）：

  ```bash
  cd app/amayui-emulator
  node --import ../../scripts/ts-resolve-hook.mjs test/script-ledger.test.ts          # 6/6 ✔
  node --import ../../scripts/ts-resolve-hook.mjs test/ticket-ledger.test.ts          # 6/6 ✔
  node --experimental-transform-types --import ../../scripts/ts-resolve-hook.mjs test/capability-ledger.test.ts   # 6/6 ✔
  ```

## ① 已修（2026-09-26 落地）

- **代码**：`app/amayui-emulator/src/vm/handlers/msgwin.ts` 的 `op_wait_for_input` ——
  `|= CHAR_REVEAL_ACTIVE` 移出 `revealArmed` 门。**第二轮订正（用户 2026-09-26 反馈「hover 侧栏会让 ▼ 的 loop 刷新到第一帧」）**：
  raw 28549-28554 的**三件事同在一个条件下**（`|= 0x40000000` / `Engine[107704] = 0` / `sub_453A90` 重启节拍），
  因此 `m.cellK = 0` 与 `m.cellNextAt = 0` 也一并收进那个 `if` —— 旧实现把归零放在条件外，**每次门重跑都重启 loop**；
  门内只留 `beginReveal`/`markRevealArmed`（= `T-0016` 那条纪律）。守卫补了第二阶段断言：
  **bit30 已置位时的门重跑不得碰游标/节拍**（变异验证：恢复「无条件归零」⇒ 红）。
- **守卫**：`app/amayui-emulator/test/char-reveal.test.ts` 新增
  「★T-0187：悬停清 bit30 后，门指令重跑必须把 ▼ 重新武装（且不得重播文字）」——
  `finishCharReveal()`（= `sub_4051A0`）清位后重跑 `0x72`，断言 bit30 回来、`isRevealing()` 仍为 false、下一拍贴格 0。
  **变异验证**：把那一行注掉 ⇒ 该用例红（另有 2 例连带红）⇒ 断言是承重的。
  运行（沙箱可用口径）：`node --experimental-transform-types --import ../../scripts/ts-resolve-hook.mjs test/char-reveal.test.ts` ⇒ 20/20 绿。
- **实例实测（`amayui_emulator` 工具，不用自写脚本）**：`action=start` → `action=wait {bin:TITLE}` →
  `action=op load-from-title --slot 78` → `action=capture`：
  - 文字末尾**出现 ▼**（`evidence/fix1-cell-visible-01.png` / `-02.png`，相隔数百 ms 两次都在）；
  - `action=query run` ⇒ `effectFlags=0xc0000000`（**bit30 保持置位**；修前恒 `0x80000000`）；
  - `action=query slot c` ⇒ `texSlots 0x5190`（SO026 由父帧 NOVEL 绑进槽 12）。
- 注：渲染页跑的是构建产物 ⇒ 本次用 **esbuild CLI 直接重建** `dist/web/renderer.js`
  （`./node_modules/@esbuild/win32-x64/esbuild.exe src/renderer/renderer.ts --bundle --platform=browser --format=iife --target=es2022 --sourcemap --outfile=dist/web/renderer.js`；
  `node build-electron.mjs` 在本沙箱里因 esbuild 服务子进程被挡而 EPERM）。

### ★仍未收口：hover 与 ▼ 的 loop（用户真机口径 vs raw）

用户第二轮反馈：「hover 侧栏 ⇒ loop 刷新到第一帧；移开又刷新；**真机上其 loop 不受其它动画效果影响**」。

- emulator 侧实测（本轮，`action=input` + `action=query`）：`[hover-label] hover-enter 0x38f` 之后确实出现
  `[cell] … k=0` ⇒ 游标被归零（loop 重启）；但**只把光标移到侧栏条 `(1250,360)` 时 `effectFlags` 仍为 `0xc0000000`**
  （bit30 没被清）⇒ 重启只发生在**产生 hover 派发**的位移上。
- raw 侧：悬停派发经 `sub_4051A0`（raw 20335-20336 → 10924-10935）清 bit30，门重跑再武装（游标归零）⇒ **按 raw 应当重启**。
  该清位有一道配置门 `!GetConfig(set:ControlDisibleCursor)`；引擎里这个键的注入默认值 = **0**
  （raw 111541-111543 `v13 = 0; sub_434D00(v2, aSetControldisi, &v13)`），而真机两份 SYS4REG.INI
  （`%LOCALAPPDATA%/Eushully/揤寢偄僉儍僢僗儖儅僀僗僞乕/` = 真游戏实际使用的乱码目录，与 `…/天結いキャッスルマイスター/`）
  **都没有这个键** ⇒ 引擎读到 0 ⇒ 按 raw 应当清位。
- ⇒ **两个候选解释**：①真机那次手势没产生 hover 派发（emulator 里也见过这种位移，bit30 保持）；
  ②引擎在某道门（面板已显示 / `sub_403E70` 返回 -1）上比 emulator 少一次派发。
- ★**2026-09-26 第三轮：按用户裁定「不需要为了表现而引入未核实的内容」—— 已完整还原**：
  曾试过一处**按真机观察、无 raw 依据**的改动（`Engine.finishCharReveal(keepIconWhenDone)`：悬停分支在
  文字已显完时不动 bit30），现已回退到 **raw 字面** —— `finishCharReveal()` 无条件收尾（`sub_4051A0`
  只要 bit30 置位就清），悬停分支调用点也回到原样；守卫相应改回「契约 A–D」的 raw 口径（`char-reveal` 20/20 绿）。
  ⇒ 于是本票**保留的只有 raw 推导出来的那一处**：`0x72` 的「置位 / `Engine[107704] = 0` / 重启节拍」
  三件事收进同一个 `if (bit30 == 0)`（旧实现把归零放在条件外 ⇒ 每次门重跑都重启 loop，与 raw 不符）。
- ⇒ **「真机悬停不影响 ▼」与 raw 的冲突仍是未决问题**（只当疑问登记，不再用行为改动去迎合）：
  按 raw，悬停会清 bit30（▼ 停一拍）、门重跑重新武装（游标归零）；真机观察说完全不影响。
  两个候选解释如上（配置门取值 / 派发是否到达）。
- ★**真机取证：`app/amayui-inspector` 这条路先忽略**（用户 2026-09-26 实测：基本采不到本票需要的量）。
  ⇒ 所有「还需要核实的东西」集中到 **`tickets/T-0187/verify.md`**（V1 悬停与 bit30 / V2 读档后的白 /
  V3 emulator 回归 / V4 agent 侧待办），每条写明**判据 / 取证手段（真机只靠肉眼与游戏内操作）/ 结果→动作**。
  本小节以下两条旧清单（`effect_flags` 三条读数、`Font+1360`/`f807b` 六项读数）**作废**，被 verify.md 取代。

## ② 第二轮进展（未定论，按顺序继续）

- **已排除**：「父帧 preamble 在引擎里不重跑」——引擎装脚本时 `sub_40EA00` 把帧 ip 置 0（raw 18427），
  `sub_40F750`/`0xAE` 只补落点槽与返回栈 ⇒ 帧必从入口跑到 `i0ae`；emulator 同构（实例日志有 `[call-script] 0x51db -> CHECKCONFIG.BIN`）。
  另：`CALLBACK_LOAD`/`LOADCHARM`/`DRAWCHARM`/`SETPOLYGON` 里**没有** `i076`/`mov f807b` ⇒ 白不来自被跳过的 CALLBACK_LOAD。
- **已确证 emulator 缺的那一块**：全量读档（`0x1A1`，`a7 && a4 >= 2`）会调 `sub_45F1B0(Font, hFile)`
  （raw 19421-19422）恢复 **Font+3364 的 72B 文本缓冲记录 + 回看页表**（先 `sub_45EBE0` 清，raw 74482；再逐条 `sub_45D3A0`，raw 74494/74555-74557）。
- **分叉点收敛到「值的语义」**：`CHECKCONFIG` 无条件先把 `f807b` 置白（`CHECKCONFIG.txt:48`），
  所以 emulator 的黄只能来自「`adcd[14acda] > 0` 的覆盖命中」；而 `14acda`(0x14ACDA = 1,356,506)
  **远在池分配之外**（池 = 1,015,792 dword + `rand()%0x10000` slack，raw 22278-22283），
  `f807b`(1,015,931) 恰在 slack 内。下一步：把 `CHECKCONFIG` 前后的 `f807b`/`14acda`/`adcd[14acda]` 打出来对账 +
  按体实现 `sub_45F1B0` 的恢复，再判白来自哪一条。**在此之前不动 ② 的代码。**
- ★**② 的真机取证也已改线**（inspector 采不到 ⇒ 不读内存）：**纯肉眼判据 = 回想对照实验** ——
  在 SC0000 里推进到阿瓦罗那句 → 游戏内 LOAD → 存档 78 → 打开**回想**，看里面**有没有** SC0000 那几句：
  有 ⇒ 读档没换 72B 文本缓冲（`sub_45F1B0` 对屏幕内容无影响，② 另找）；没有 ⇒ 读档确实换成了存档那一份
  ⇒ 白的来源就是那块恢复。完整判据/手段/结果映射见 **`tickets/T-0187/verify.md` 的 V2**。

## 真机探针工具：`amayui-inspector` 的「5 秒后采集」（2026-09-26 由子代理实现）

- **动机**：本票的判别实验需要「先点采集，然后在游戏里做动作（悬停侧栏）」——查看器的手动刷新做不到。
- **实现**（只改了 3 个文件，未 `git add`）：`AmayuiInspector.App/ViewModels/MainViewModel.cs`
  （`DelayedCaptureMs = 5000`、`DelayCaptureCommand`、`DelayButtonText`/`DelayCounting`、`DispatcherTimer` 每秒倒计时、
  `ToggleDelayedCapture()`：空闲=开始 / 倒计时中=取消；`RefreshSnapshotAsync(string? captureLabel)` 只是给状态加后缀，
  **采集路径一字未动**）、`Views/MainWindow.xaml`（顶栏「刷新快照」右侧 +1 个按钮）、`README.md`（「WPF 壳用法」补一行）。
- **用法**：选进程 →「扫描 this」→ 点「**5 秒后采集**」（按钮变 `取消（Ns）`，状态栏逐秒递减）→ **马上切回游戏做动作**
  → 第 5 秒自动采集（状态 `快照已刷新（延迟采集） · HH:mm:ss · this=0x…`）；倒计时中再点一次 = 取消。
- **验证**：`pwsh -File app/amayui-inspector/build.ps1` 原样跑通（Core/Cli/App 全 0 warning 0 error + M1 自检 OK，
  主 agent 另行复跑确认）；子代理另做了非静态逻辑验证（反射实例化 VM + 空壳 session 当探针：
  倒计时逐秒、第 5 秒确实走到采集路径、二次点击确实拆掉 timer 且之后不再触发）。
- **未验证**：本机没有真游戏进程 ⇒ **UI 未实机点过**（布局/真 session 成功文案），需用户首次使用时留意。

## 未决 / 下一步

1. ① 的修法（3 行搬位置）+ 守卫——**待用户确认后实施**（本票 acceptance 要求 ▼ 可见且按节拍闪烁）。
2. ② 的 E4 判据（真机截图）——**需要用户提供**，否则只能按「脚本口径的必然结果」收口。
3. 过时注释：`app/amayui-emulator/src/renderer/pixiBackend.ts:1792-1794` 的「序章本来就没有 ▼」需随 ① 的修法一并改
   （该文件被多张票锚定，改前先跑 `tickets.js --anchors-in`）。
4. 本票 evidence 里 `src/*.txt` 的行号已由第三层的 `layout` 段覆盖（`SN0000` 2974-2993、`NOVEL` 119-126、`CHECKCONFIG` 52-82）。

---

## ★2026-09-26 第二轮：引擎代码重新核实（用户指出「前一轮结论与真机表现不符」）

**做法**：把三条链拆成三份**互相独立的只读复核**（子代理只读 `engine/*.c` + `.lst` + `src/*.txt`，**禁止读 emulator**），
结论与逐行证据见 **`recheck.md`**（本轮唯一新增文档）。**本轮不改 emulator 代码**（只登记结构偏离）。

### 结论一：① 的「无条件武装」是硬错（推翻）

- 0x72 的武装有**两道门**：外门 `raw 28540`（bit27 = ADV 显示位）、内门 `raw 28549`（bit30 原本为 0）。
  上一轮把整块读成「无条件重新武装」——**内门被漏掉，外门被写成「只要门重跑就一定武装」**。
- 另有一格**从未建模**的粘滞标志 `Engine[489984]`（`raw 28518` 的 `!_this[122496]`）：唯一置 1 点是 `raw 20274`
  的「滚轮/自动推进」支（门 = `message:AdvanceMesOnWheel & 2`），只在 opcode `0x71`/复位清 0。
  **真机 SYS4REG.INI 实测 `AdvanceMesOnWheel=3`（bit1 已置）** ⇒ 这一支在真机**可达**；一旦为 1，
  门重跑**整块不执行**（bit30 保持 0、格号不归零、节拍不重启）。
- `sub_4051A0` 全库 **5** 个调用点（20198 / 20247 / 20336 / 20433 / 91129），上一轮只写了 2 个。
- `Engine[107706]`（raw 29334 唯一写点）**只写不读**，上一轮叫它「某开关」是错的。

### 结论二：「真机悬停不影响 ▼」的冲突**消解**（上一轮只读了悬停泵，没读脚本的悬停 label）

`src/SN0000.txt`：侧栏条热点的 ENTER label `label_00000c74`(:121) 会 `i093`（**清空整张路由表**）→ 绘制 →
`:147 wait` → `:148 置 global 1399 = 2` → `:151 call label_00000320`；而 `label_00000320` 在 `1399 == 2` 时
（`:50-51`、`:72-73` 两次 `jcc`）**跳过 `:52-66` 的屏幕上热点**，只登记 `:79-114` 那批
**屏幕外 `(-1000,-1000)` 1×1** 条目，其 **ENTER/LEAVE = `ffffffff`** ⇒ `sub_403E70` 恒返回 -1 ⇒
**悬停不再派发** ⇒ `sub_4051A0` 不被调 ⇒ bit30 不被清。**⇒ 不是「与 raw 冲突」，是 raw + 脚本的必然结果。**

（仍然成立的是：**第一次**悬停——路由表里还有 `:52-66` 时——确实会派发一次。）

### 结论三：② 的推导链错、方向对；真正更硬的机制是**记录回写**

- 订正：`adcd` 是**池内数组起始下标常量**（全库 0 处赋值）、`14acda` 才是**索引变量**；
  「池长 1,015,792 ⇒ 池外」这条链本身不自洽（68% 的 `global-int` token 比它大，最大 `0x708ADA`，
  台账已挂账）⇒ **不许再用「池外 ⇒ 不还原」解释现象**。
- 但「`f807b`（1,015,931）不在读档的 memset/memcpy 覆盖范围内」**成立**（save/load 的池数量就是
  `Engine[95738]`，实测 SAVE78 的 int count = 1,015,792）。
- ★**新机制**：72B 文本记录在入队时快照 `Font+1360/+1364`（`sub_45F090` raw 74359-74400 写记录 +20/+24），
  重绘时**回写** `Font+1360`（raw 76940-76962 / 77807-77809 / 78663-78665）⇒ 「读档后白」最可能来自
  `sub_45F1B0` 恢复的那份记录（SAVE78 是白旁白期存的，记录 +20 = 0xFFFFFF）。emulator 完全没实现它。

★★**同日实测订正（实例 `t0187b` 跑通后，见 `recheck.md` §5）——② 的主因不是记录回写**：

| 步骤 | `global f807b` |
|---|---|
| 冷启动读 78 | `0xFFFFFF` **白** ✓ |
| 游戏内读 77（→SC0000，阿瓦罗） | `0xFFE100` **黄** ✓ |
| 游戏内读 78（→SN0000） | `0xFFE100` **仍是黄** ✗（真机 = 白） |

指纹：`a9dd=2`、`a9de=1`、`f807c=0`、`f8079=3`、`f807a=1`、`adcd=0xFFFFFF`、`14acda=0`（**重放之后**）。
⇒ CHECKCONFIG 确实执行了，且按 `jcc` 的既定极性（**v == 0 才跳**）重读 `:50-64`：
**`(a9dd & 2) != 0 且 adcd[14acda] > 0` ⇒ `f807b = adcd[14acda]`**（A3 报告里那条「a9dd=2 ⇒ 钉成白」方向反了）。
既然最终 `f807b = 0xFFE100`（阿瓦罗黄）而 `adcd[0] = 0xFFFFFF` ⇒ **CHECKCONFIG 执行那一刻 `14acda ≠ 0`**
（上一场景的说话人），之后才被 SN0000 的重放改成 0。
⇒ **真因 = 读档时 `14acda`（当前说话人）的重算**：`src/CALLBACK_LOAD.txt:197-227`（读档先跑的那支脚本）
会按 `4fd6`/`14acdc`/`14b0c4` 重算它，随后 SYSTEM4 的 `:84 call-script CHECKCONFIG` 用它取色。
**所以要修的是这条链，不是 `sub_45F1B0`**（后者降为「待核的第二机制」）。
★`14acda`(0x14ACDA)/`14acdc`(0x14ACDC)/`14b0c4`(0x14B0C4) **都大于** SAVE78 实测 int count(1,015,792)
⇒ 不在读档 memcpy 范围内；而 `Engine[382952]`（池容量）与「文件里的 count」是否同一个数，
**正是上一轮出错处，必须先实测再下结论**。

### 结论四：emulator 侧**结构偏离**（本轮只登记，未改代码）

`handlers/msgwin.ts:957` 的 bit30 武装在**所有门之外**；raw 的武装与置 bit31 **同在 `if (bit27 == 0)` 块内**
（28540 包住 28547/28549）⇒ 应把武装移进 `(ADV_ACTIVE) === 0` 那一支，并补 `Engine[489984]` 建模 + 守卫。

### 落库（本轮改了哪些）

- 新增 `tickets/T-0187/recheck.md`（三链复核报告 + 真值表 + 判别量）；
- `analysis/engine-capabilities.json` 的 `msgwin-char-reveal-grid`：note 追加**订正块**（三处旧措辞作废 + 冲突消解 + emulator 偏离）；
- `analysis/scripts.json`：`SN0000` +3 段 layout、+1 gotcha（悬停不派发）；`NOVEL` +1 gotcha（记录回写）；
  `CHECKCONFIG` +1 gotcha（`adcd`/`14acda` 角色 + `a9dd & 3` 门）；
- `analysis/opcodes.json`：`i093` 语料数字订正（334 → **4954 处 / 337 文件**）；重建 `opcode-table.md` 与两份 `opcodes.json`；
- 生成物：`docs-new/03-engine/engine-capabilities.md`、`docs-new/05-scripts/{SN0000,NOVEL,CHECKCONFIG}.md`、`opcode-table.md`。

### 仍未收口（需要真机/实例的一条判别量）

| 判别量 | 取值 ⇒ 动作 |
|---|---|
| ADV 页 ▼ 在闪时读 `Engine[12957]`（消息面 shown）与 `Engine[23008]`（路由条目数） | `12957==0` 或条目只剩屏幕外那批 ⇒ 结论二成立，① 收口；否则回到真值表逐格判 |
| 读档 78 后读 `Font+1360` + `(Font+3368 − Font+3364)/72`（记录条数）+ 记录 `+20` | 记录条数 > 0 且 `+20 == 0xFFFFFF` ⇒ 白来自记录回写 ⇒ 实现 `sub_45F1B0` 是正解 |
