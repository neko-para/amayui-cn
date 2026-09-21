# 下一轮可执行性分诊（ANALYSIS-ONLY，只读）

> 角色：ANALYSIS-ONLY 子代理。**未写任何台账/文档/代码**，中间产物只落 `.tmp/triage/`。
> 未跑 `npm run verify` / `npm run shot`。技能 `amayui-engine-analysis` 已加载，其「落库」步骤按指示跳过。
>
> **证据等级图例**（本节每条结论都标了其一）：
> - `[体]` = 我亲自打开 `engine/天结_unpacked.exe_utf8.c` 读了那几行（引行号）；
> - `[码]` = 我亲自 grep/读了 `app/amayui-emulator/**` 的当前代码（引文件:行，仅用于 B 段「现状」判定）；
> - `[台账]` = `docs-new/03-engine/*.md` / `analysis/opcode-gaps.json` 说的，**我没有复核**；
> - `[未读]` = 我没读到。

---

## 0. 先说计数口径（★这一条会改变排序，必须先看）

`analysis/opcode-gaps.json` 的 `mnemonic` 是**不补零**的（`i28`/`i86`/`i25`/`i36`/`i87`），
但 `src/*.txt` 里助记符是 **`i` + 三位补零十六进制**（`i028`/`i086`/`i025`/`i036`/`i087`；≥0x1000 时不补）。
我用 `grep -c i28 src/*.txt` 式统计时，这 **9 条会被算成 0 处**（我第一遍就踩了：28 条总语料只有 222，而 `handoff` 写的是 292）。
按「两种写法都数」重算后总数 = **292**，与 `handoff.md:27` 的 292 一致 ⇒ 口径确认。
（脚本 `$N$SCxxxx.txt` 主循环用的是「名字形式」的指令，如 `mov`/`jcc`/`local-ret`，不影响本节。）

---

## A. `deferred` 28 条：按语料命中数重排 + 逐条分诊

### A.0 全表（语料量我自己从 `src/*.txt` 统计，941 个文件）

| # | opcode | mnemonic | handler | argc | 语料 | 文件 | 类别 | 一句话卡点 |
|---|---|---|---|---|---|---|---|---|
| 1 | 0x140 | i140 | sub_42FBC0 | 4 | **181** | 181 | ③ DEBUG + ② AGERC 宿主 | 门 = `global 708ad6 == 1` |
| 2 | 0x28 | i028 | sub_41D860 | 4 | **32** | 15 | ② DDraw/2D | `sub_441060`/`sub_443B20`（Engine+7912） |
| 3 | 0x86 | i086 | sub_41FA20 | 1 | **16** | 5 | ② 宿主光标 | `sub_4B8C70` = `SetCursor` |
| 4 | 0x222 | i222 | sub_423EC0 | 2 | **10** | 10 | ② Scene 拾取层 | `sub_4B4460` 键区间 + `~0x10000` |
| 5 | 0x87 | i087 | sub_418F80 | 0 | **9** | 5 | ② 宿主光标 | `sub_4B8660` = `SetCursor` |
| 6 | 0x236 | i236 | sub_4246B0 | 4 | **6** | 3 | ② mesh 对象族 | `Engine[4*op2+378688]` + LoadMesh |
| 7 | 0x1d0 | i1d0 | sub_42D440 | 3 | **5** | 3 | **① 可做** | 页表读端（**零 GDI**）；缺写端模型 |
| 8 | 0x36 | i036 | sub_41E7E0 | 3 | **5** | 5 | ② DDraw/2D + 输入刷 | 同 `0x28` 族 |
| 9 | 0x2fd | i2fd | sub_431CF0 | 6 | **4** | 4 | ② 输入点击队列 | `sub_477A60` + `ScreenToClient` |
| 10 | 0x32c | i32c | sub_426FC0 | 6 | **4** | 1 | **① 登记即可** | 3D 相机 + Effect3D；体内无操作数写 |
| 11 | 0x25 | i025 | sub_41D590 | 3 | **4** | 1 | ② DDraw/2D + 输入刷 | 同 `0x36` |
| 12 | 0x23a | i23a | sub_4306F0 | 2 | **1** | 1 | ② 模型未确证 | `Engine[idx+91322]` 表 + `+1068` |
| =12 | 0x241 | i241 | sub_424FA0 | 5 | 1 | 1 | ② mesh 对象族 | 同 `0x236`（`Engine[4*v2+378688]`） |
| =12 | 0x2cf | i2cf | sub_4263D0 | 1 | 1 | 1 | ② 宿主窗口 | `sub_413DD0` = 全屏/窗口切换 |
| =12 | 0x147 | i147 | sub_42FD60 | 6 | 1 | 1 | **① 可做** | `CreatePolygonRgn`+`PtInRegion` → `op1` |
| =12 | 0x1c4 | i1c4 | sub_42E8A0 | 1 | 1 | 1 | ② 音频回读缝 | `sub_404CB0(Engine+84128)` 语音总线 |
| =12 | 0x1d1 | i1d1 | sub_420310 | 5 | 1 | 1 | ② GDI 文本 | `sub_4675A0(Font, …)` |
| =12 | 0x2f2 | i2f2 | sub_4318A0 | 6 | 1 | 1 | **① 可做** | `CreateEllipticRgnIndirect`+`PtInRegion` |
| =12 | 0x144 | i144 | sub_433AB0 | 2 | 1 | 1 | ② AGERC（**cmd 10**） | `dword_55E1B4(10, …)` |
| =12 | 0x327 | i327 | sub_426E70 | 1 | 1 | 1 | **① 登记即可** | `sub_453280(Engine[93384])` Effect3D |
| =12 | 0x329 | i329 | sub_426EB0 | 2 | 1 | 1 | **① 登记即可** | mesh 装载（同 `0x236`） |
| =12 | 0x32e | i32e | sub_427110 | 11 | 1 | 1 | **① 登记即可** | ARGB 归一化 → `sub_49A080(Scene,…)` |
| =12 | 0x328 | i328 | sub_432300 | 3 | 1 | 1 | **① 登记即可** | DEC 数组 → `sub_4183F0(Scene,…)` |
| 23 | 0x24d | i24d | sub_4255E0 | 12 | **0** | 0 | ③ 语料 0 | 转场类别 1 写入端 |
| 23 | 0x82 | i082 | sub_41F720 | 5 | 0 | 0 | ③ 语料 0 | DDraw 族 |
| 23 | 0x85 | i085 | sub_418F50 | 0 | 0 | 0 | ③ 语料 0 | `sub_45EBE0` 清页表 |
| 23 | 0x26 | i026 | sub_41D6A0 | 4 | 0 | 0 | ③ 语料 0 | DDraw 族 |
| 23 | 0x2b | i02b | sub_41DA20 | 5 | 0 | 0 | ③ 语料 0 | DDraw 族 |

> 总数校验：181+32+16+10+9+6+5+5+4+4+4 + 12×1 + 9×0 = **292** ✓

**★「0 处」怎么证的**：用「两种助记符写法 + `opcodes.json` 的 `name`/`aliases`」四种 token 各扫一遍 941 个 `src/*.txt`，
`i24d`/`i082`/`i085`/`i026`/`i02b`（含 `i24d` 的补零形式 `i24d` 本身就是三位）全部 0 命中。
`0x82/0x85/0x26/0x2b` 我**没有读体**（语料 0 ⇒ 读体无收益）。

---

### A.1 ★榜首 `0x140`（181 处）的门 —— 读体 + 追门，确认「不是关键路径」

- **进这条分支的门我亲自核过**（这是任务书要求的那一课）：
  - `src/$1$SC0330.txt:46 jmp label_000037f0` → `:1004 eq (local-int 0) (global-int 708ad6) 1` →
    `:1005 jcc (local-int 0) label_0000383c ffffffff` → `:1007 label_0000382c / call label_000047c4 / exit`、
    `:1011 label_0000383c` → `:1012 jcc 1 ffffffff label_000047b0` → `:1015 i140 …`。
  - `jcc` 语义见 `docs-new/03-engine/opcode-table.md:149`（`op1≠0 → 跳 op2`；`op2 == 0xFFFFFFFF` ⇒ **落下句**）。
    ⇒ `1005` 的条件是 `local0 = (708ad6 == 1)`：**只有 `708ad6 == 1` 才进 i140 块**；否则走 `call label_000047c4; exit`。
  - `1012` 的 `jcc 1 ffffffff <label>` = 常量真 + 目标 `0xFFFFFFFF` ⇒ **落下句**，所以进了块就一定撞上 `1015 i140`。
- **门的写点我数过**（全语料 941 文件）：
  - `mov (global-int 708ad6) 0` × **181**、`mov (global-int 708ad6) 1` × **1**；
  - 写 1 的那个文件**只有** `src/TITLE.txt`，就是 `TITLE.txt:462`（`label_00001c84` 调试菜单分支，`menu-bind*` 之后）；
  - `i140` 出现在 **181 个文件**里：180 个是 `src/$N$SCxxxx.txt`（都在上述 1004-1005 门后），第 181 个是 **`TITLE.txt:466`**（紧跟 `:462 mov 708ad6 1`）。
- **体** `[体]`：`raw 39591`（arity=9 ⇒ argc 4）→ `raw 39594/39611` op2/op3 有界拷进 256B 栈缓冲 → `raw 39630` op4 读 int →
  `raw 39633 v14 = dword_55E1B4(8, _this[96981], v16)` → `raw 39634 op1 = v14`。
  `dword_55E1B4` 的类型注解就在 `raw 39641`：`int (__stdcall *)(_DWORD,_DWORD,_DWORD)` ✓。
- **判定：③（全在 DEBUG 路径）**，且即使进得去也还有 **②（AGERC 对话框宿主 + 返回值只能由真人点选）** 两个卡点并存。
  ⇒ **181 处 = 正常剧情零影响**，与 `handoff §5` 一致（但我在它的「角标」之外独立复核了门的方向）。

---

### A.2 逐条：top 11（正文）

**#2 `0x28 i028`（32 处 / 15 脚本）—— ② DDraw/2D 子系统**
- 体 `[体]` `raw 27509-27531`：`op4<0 || op4>4` ⇒ `sprintf(aComefbl2Type01)`+`sub_4034D0`；
  否则 `op3<1 || (effect_flags(699204) & 0x8000000)` ⇒ `sub_441060(_this+7912, op1, 0)`；
  否则 `sub_443B20(_this+7912, *(float*)&op1, *(float*)&op3, op4+8)`，成功则 `effect_flags |= 0x10` + `sub_453A60(Engine+429872, op2)`。
- 被调体 `[体]`：`sub_441060 raw 50741-50800`（读 `dword_55E1BC+667856` = 显示/绘制模式，走 `sub_4A6D60`/`sub_49DFD0`/`sub_49ED60` 的 2D 对象路径）；
  `sub_443B20 raw 52623-52680`（`_this+8208/8212/8216/8196..8220` 一组矩形/裁剪格 + 同样的 `sub_49ED60`/`sub_43B1A0` 分派）。
- **门**：语料形态高度一致（`i028 2 10 40 0` 等），入口**没有门**——`src/SC0000.txt:21116-21126` 的上下文是
  `draw-texture 30d40 … / i028 2 10 40 0 / detach-texture 30d40 1 / release-texture`，是真实的「画一张图 + 加个效果 + 撤」序列。
- **可执行判据**：前置 = 先定 `Engine+7912`（`[体] sub_4B7D60` 定义在 `raw 139976`、`raw 139980` 就是 `*_this = &Sys3Draw___vftable_;`
  —— 「`Engine+7912` 就是这个对象」是按 `0x87` 的调用点 `sub_4B7D20(_this+1978)` 推断的）这条 **2D 缓冲/合成缝的形状**：
  哪张 surface、混合怎么做。建议先读 `sub_441060` 的 else 支与 `sub_443B20` 全文，再决定「接宿主缝」还是登记。**不建议当下一轮首选**（它是 45 处 DDraw 族里最大的，但是入口最深的）。

**#3 `0x86 i086`（16 处 / 5 文件：HIDEWIN **12**、FIELD 1、ALLMAP 1、CGVIEWER 1、REIGN 1）—— ② 宿主光标**
- 体 `[体]` `raw 28953-28961`：op1 → `sub_4559C0(FileDB=Engine+680092, …, id, &size)` → `sub_455560` 取字节 →
  **`sub_4B8C70(_this+696548, id, bytes, size)`** → `_this[18652]` 非 0 再 `sub_4B7D20(_this+7912)`。
- 被调体 `[体]`：**`sub_4B8C70 raw 140780-140795` = `sub_4B8A80(...)` → `_this[259] = 句柄` → `SetCursor(v5)`**，
  失败打 `aSetcursor` 串；`sub_4B8A80 raw 140643+` 把资源写成临时文件（`GetTempPathA`/`GetTempFileNameA`）再建光标。
  ⇒ **这条就是「换鼠标指针形状」**（HIDEWIN 用 `i086 51e6..51ed` 换不同窗的指针）。
- **可执行判据（两条路，都不大）**：
  ① 建最小宿主缝 `native.setCursor?(imgid)`（五处同步：`native.ts` + `headlessScene.ts` + `pixiBackend.ts` + `stubNative.ts` + `nativeTap`），
     FileDB 读取那条链 emulator 已有（`0x1F9` 就在 `markFileUsed`），Pixi 侧直接映射成 CSS cursor；
  ② 若判定「指针外观不算可见行为」，就**按 `engine-internal` 有据 no-op 登记**（理由是 `SetCursor` 只碰宿主，不回写操作数 —— 我读体确认无 `sub_42B4B0`）。
  **不要**留着零注册：`interpreter.ts:61-68` 查不到 ⇒ `NotImplementedOp`，HIDEWIN/FIELD/ALLMAP/CGVIEWER 直接硬停。

**#4 `0x222 i222`（10 处 / 10 文件，INFOxx 9 + SETPOLYGON 1）—— ② Scene 拾取层**
- 体 `[体]` `raw 31930-31933` → `sub_4B4460((int)(_this+80708), op1, op2)`。
- `sub_4B4460` `[体]` `raw 136968` 起（320 行）：先整屏渲染（`sub_498B60` 清目标 / `sub_49DFD0` / `sub_4A1E90` / `sub_4B06D0`），
  然后对 `Scene+1036` / `Scene+1068` / `Scene+1100` 三张表按**键区间 `[op1, op1+op2)`** 求并集（`raw 137057-137160`），逐个键：
  `sub_4535F0(Scene[12676], key)`（raw 137169/137208/137218）+
  **`*sub_4AAD40(Scene+0x408, &key) &= ~0x10000u`**（raw 137212-137213；`Scene+0x408` = `Scene+1032` = 绘制项 map，`raw 130039` 的 `v3 = (_DWORD*)(_this+1032)` 同一对象）。
- **卡点（不是「找不到」而是「没模型」）**：emulator 的 `KNOWN_DRAW_ITEM_FLAGS = 0b111`（`src/vm/native.ts:24`）**没有 bit 0x10000**；
  且 `Scene[12676]` 那个对象（"已选/已绘集合"？）在 emulator 完全不存在 —— 我 grep 到的 0x10000 命中全是别的字段（`Scene+46528`、`Engine[122466+win]`）。
- **可执行判据**：前置 = 先读 `sub_4535F0(Scene[12676], …)` 到底改什么（那决定 0x10000 是不是"渲染过"标记）；
  确认后 = 给 `Item.flags` 加 bit 0x10000 到 `KNOWN_DRAW_ITEM_FLAGS`（否则 `check:dead-writes`/`UnknownFlagError` 会红）+ 新 handler。**不建议现在动**。

**#5 `0x87 i087`（9 处 / 5 文件）—— ② 宿主光标（与 #3 同族）**
- 体 `[体]` `raw 24483-24487`：**`sub_4B8660(_this+174137)`** = `[体] raw 140395-140402`：
  `result = SetCursor(*(HCURSOR*)(_this+1032)); *(_DWORD*)(_this+1036) = 之前的值; return result;`
  （`_this+174137`(dword) = 字节 696548，与 `0x86` 的 `+696548` **同一个"光标管理器"**）；
  `_this[4663]`(=byte 18652) 非 0 再 `sub_4B7D20(_this+7912)`。
- 与 `0x86` 同处置：一个缝两条 handler（`setCursor` / `reapplyCursor`），或一起按有据 `engine-internal` 登记。

**#6 `0x236 i236`（6 处 / 3 文件：BTL 3、FIELD 2、CALLBACK_LOAD 1）—— ② mesh 对象族**
- 体 `[体]` `raw 32243-32286`：`Engine[4*op2+378688]` 惰性 `operator new(0x480)`+`sub_489040` →
  `sub_488DC0(元素, Engine[80653], Engine[96981], 文件名)` 失败即 `_CxxThrowException`「メッシュファイル」→
  `Engine[4*v2+365288]` 为空也抛 → `sub_489230`（装 mesh）/`sub_4054D0`+`sub_405460`（取属性）/`sub_4879E0`/`sub_4885A0`/`sub_4879B0` → `Engine[168993] = 1`。
- **卡点**：整套 `sub_488xxx/sub_489xxx` 网格子系统（含异常路径）。**前置** = 建「立绘/网格节点子系统」。语料 `i236 (local-ptr 0) 2a 0 0` 形态说明它是「按槽号把 mesh 挂在场景项上」。

**#7 `0x1d0 i1d0`（5 处 / 3 文件：HISTORY 3、CONFIG 1、REPLAYVOICE 1）—— ★① 可做（但要连写端一起做）**
- 体 `[体]` `raw 38105-38109`：arity=7（argc 3）→ `v2 = op3` → `sub_459860(_this+21324, &v5, &v4, v2, 2)` → **`op1 = v5`、`op2 = v4`**。
- 被调体 `[体]` `raw 70629-70724`（我逐行扫过关键行）：**零 GDI / 零字体 API**；
  它只碰 `_this[841]`（记录数组，**72B/条**，`+40` = flags）、`_this[842]`（记录数）、
  `_this[845]`（**8B/条**的页表）、`_this[846]`、`_this[860]`（游标），按 `a4` 的正负步进、
  用 `a5`（= 常量 `2`）掩掉 flags 不匹配的记录；失败写 `*a2 = *a3 = -1`。
  ⇒ 语义 = 「**回看页索引表·带符号步数读出**」（`a4` = 相对步数、`a5` = 记录 flags 掩码）——`analysis/opcode-gaps.json` 的路线 C 订正**与体一致**，
  而 `opcode-table.md` / 老台账里「GDI 文本度量族」的说法**是错的**（我不引用它）。`Font` = `_this+21324` ⇒ `845*4 = 3380`、`841*4 = 3364`，与台账的 `Font+3380`/`Font+3364` 对得上。
- **可执行判据（①）**：改 `app/amayui-emulator/src/vm/textItems.ts` 加 `pages: {win, start}[]` + `cursor`/`baseCursor`（`start` = push 时 `records.length`），
  `TextItemTable.reset()` 里清（`control.ts` 已调）；`advState` 快照加这两格；handler 写 op1/op2（失败 `-1/-1`）。
  **守卫**：合成指令跑 `0x70`/`0x71` 各一次 + `i1d0 <win> <start> -1` + `+1`，断言与体一致。
- **前置（★必须一起做，否则是死逻辑）**：写端 = `0x70`（`sub_45D660` raw 73181-73191）与 `0x71`（`sub_45EC60` raw 74267-74276，受 `Engine[97055]` 门控）[台账] —— **这两个体我没读**，它们是本条的真正前置。
  只做读出端 = 表恒空 = 恒写 `-1/-1` = 回想列表静默为空（`HISTORY.txt:31` 那条 `i1d0` 前面有 `jcc … label_00000370` 跳过门，说明脚本自己在处理"取不到"）。

**#8 `0x36 i036`（5 处 / 5 脚本：`$3$SC2340`×2、SC0070×2、SC0590×1）—— ② DDraw/2D + 输入刷**
- 体 `[体]` `raw 28178-28199`：ADV 位 ⇒ `sub_441060(_this+1978, op2, 0)`（`1978*4 = 7912`）；
  否则 `effect_flags |= 8` → `sub_453A60(Engine+107461*4, op3)` → `sub_441410(Engine+7912, op1, op2, 9, 0xA0, 0)` →
  **`sub_478090(_this+258, Engine+174802*4)` + `sub_477220(_this+258, &v7)`（刷输入；后者 `[体] raw 91632-91641` = `GetAsyncKeyState` 左右键）** → 命中则 `_this[1948] = 1`。
- 语料形态 `i036 1 2 6`（3 个实参但 argc=3 我核过 arity=7）。
- **卡点**：同 `0x28` 的 2D 缓冲缝 + 输入刷。**注意 `_this+258` 我这次顺手定死了身份**（见 §D-1 的订正）：它是 `Engine+1032` 的 **Input 管理器**，不是绘制项 map。

**#9 `0x2fd i2fd`（4 处 / 4 文件：ALLMAP / CGVIEWER / FIELD / REIGN）—— ② 输入点击队列**
- 体 `[体]` `raw 40869-40878`：arity=13（argc 6）→ `n = op6` → `operator new[]` 两块 → **`sub_477A60(_this+258, pts, types, ids, &count, n)`**。
- 被调体 `[体]` `raw 92169-92225`：`_this[1688]`（HWND）非 0 且 `_this[1694]`(count) > 0 时，
  从 `*(_DWORD*)(_this + 6780)` 起按 **40B/条** 取记录，`(rec[4] & 4) == 0` 才收，
  坐标 `rec[0]/100, rec[1]/100` 后 **`ScreenToClient(HWND, pt)`**，类型 `rec[4]`、编号 `rec[3]`，并把 `count` 写回；`++` 消费游标。
- **卡点**：emulator 里**没有点击记录环形队列**（我 grep `src/vm/input.ts` 无 click/Click 命中）、**没有 `0x20f`/`0x2fd` 注册**、也没有 `ScreenToClient` 等价物。
  ⇒ ②「宿主窗口/输入队列」。**前置** = 输入层先建 40B 记录队列（`Input+6780` 语义）+ 坐标变换；
  `FIELD.txt:1286` 后面紧跟 `jcc (local-int 2fc1)`，脚本靠 op1 判"有没有点到"。
  （旁注：`0x20F` 本身**已经注册**了，`handlers/gfx-misc.ts:91 [0x20f, op_play_movie]` —— 本条缺的只有输入队列。）

**#10 `0x32c i32c`（4 处 / 1 文件 = SETWEATHER）—— ★① 登记即可（见 A.4）**
- 体 `[体]` `raw 34022-34029`：arity=13（argc 6），**六个浮点** `op1..op6` → `sub_499CE0(Scene, a2@ebx, a3@edi, Engine, v5..v10)`。
- 被调体 `[体]` `raw 116427-116520`：一组 `Scene+41928..41988` 置默认（单位/零），
  `j_D3DXMatrixLookAtLH(Scene+41928, eye, at, up)`，再把矩阵下发给 `(*(*(Scene+1860)+1040)` 的 vtable `+176`)(…)（D3D 设备 `SetTransform`），
  末尾若 `Scene[50704]` 非 0 转发 `sub_4531B0(...)`（3D 效果对象）。
- **★关键实测**：`0x327/0x328/0x329/0x32c/0x32e` 五条的体内**没有任何 `sub_42B4B0`/`sub_42BA00`（操作数写）**（我对每条体的行区间做了机械扫描），
  且它们的同族 `0x324`/`0x325`/`0x326` **已经在 emulator 里注册成 `engine-internal` 有据 no-op**（`stubs.ts:104-125`，带完整 justification）。
  ⇒ **这 5 条按同口径登记 = 把「SETWEATHER 硬停」消掉**。见 A.4 与 C-1。

**#11 `0x25 i025`（4 处 / 1 文件 = STAGERAID）—— ② DDraw/2D + 输入刷**
- 体 `[体]` `raw 27404-27429`：与 `0x36` 同族。ADV 位 ⇒ `sub_441060(Engine+7912, op2, 0)`；
  否则 `effect_flags |= 8` → `op3 <= 64 ? op3 : op3/16` → `sub_453A60` → **`sub_441410(Engine+7912, op1, op2, 4, (op3<=64?16:1), 0)`** → 同样的 `sub_478090`/`sub_477220` 输入刷 + `_this[1948] = 1`。
- 语料 `i025 1 2 28`（4 处同一形态）在 `src/STAGERAID.txt:677/723/883/939`。

---

### A.3 并列第 12：12 条 count=1（逐条，全部读体）

| opcode | 语料处 | 体（我读的行号） | 分类 | 卡点/判据 |
|---|---|---|---|---|
| 0x23a | BTL:3460 | `raw 39995-40000`：`v2 = Engine[op2 + 91322]`；`v2 ⇒ op1 = (*(v2+1068) != 0)`；否则 `op1 = 0` | ② | `Engine+91322` 表**在反编译里无写点**（构造代码未展开）⇒ 表元素类型未确证；`+1068` 无消费者 |
| 0x241 | CALLBACK_LOAD:152 | `raw 32576+`：arity=11（argc 5）；`Engine[4*op2+378688]` mesh 表惰性建 + `operator new(0x480)` | ② | 同 `0x236`（mesh 族）；后段我没有逐行读完 |
| 0x2cf | CONFIG1:1705 | `raw 33480-33492`：`op1>=0 && op1<=1` ⇒ `sub_413DD0(Engine, op1)`；否则**什么都不做**（不是报错） | ② | `sub_413DD0` = 宿主窗口/全屏切换（`HMONITOR`/`HMENU`，WndProc 同款）[台账]，headless 无等价物 |
| **0x147** | CONFIGCV:380 | `raw 39671-39700`：x=op2,y=op3、`op4` 指针、`op5` 指针、n=op6；两两 DEC 去混淆成 `POINT[n]` → **`CreatePolygonRgn(pts,n,2)` → `PtInRegion(rgn,x,y)` → `op1 = 命中位`**；建区失败 → 错误串 `asc_520808` + `op1 = 0` | **①** | **纯几何**（点是否在多边形内，GDI 填充模式 2 = ALTERNATE/奇偶）。DEC = `ror32(key ^ rol32(x,11),25)`（工程已有）。**不需要任何宿主缝** |
| 0x1c4 | FIELD:11560 | `raw 38778-38780`：`v2 = sub_404CB0((int**)(_this+84128)); op1 = (v2 != 0)` | ② | `Engine+84128` = 语音对象；`sub_404CB0` 判前 3 通道占线。**需要音频侧对外回读缝**（`NativeBridge.audio` 目前只有 intent 方向） |
| 0x1d1 | HISTORY:1314 | `raw 29359-29371`：`v8 = _this + 21032`；op1..op5 → `sub_4675A0((int)(_this+21324), v2, v4, v5, v6, v7, v8)` | ② | `sub_4675A0` = GDI 文本页渲染器 [台账，我没读 80312 起] |
| **0x2f2** | REIGN:550 | `raw 40705-40719`：x=op2,y=op3、`op4` 指针（4 个 DEC dword）、`+op5`/`+op6` 偏移 → `rect` → **`CreateEllipticRgnIndirect` → `PtInRegion(rgn,x,y)` → `op1 = 命中位`**；失败 `asc_520858` + `op1 = 0` | **①** | **纯几何**（矩形内切椭圆内的点判定）。同上，零宿主缝 |
| 0x144 | SAVE:560 | `raw 42114`：**`dword_55E1B4(10, Engine[96981], v13)`**（v13 = 两个 1024B 栈缓冲） | ②/③ | **这条是 AGERC `_ShowDialog` cmd 10**，不是台账 note 写的「1024B 拷贝」；`AGERC.DLL_utf8.c:1669-1678` case 10 开对话框，并且**会把两个串回写**进调用方缓冲（与 cmd 8 丢弃不同）；之后再 `sub_40C210` 建 std::string ⇒ 会写 op1/op2。⇒ 与 `0x140` 同一卡点（宿主对话框 + 真人输入） |
| **0x327** | SETWEATHER:20 | `raw 33956-33964`：`sub_453280(*(_DWORD**)(_this+373536), op1)`（Effect3D 管理器） | **① 登记** | 无操作数写（机械扫描确认） |
| **0x329** | SETWEATHER:56 | `raw 33966-34011`：FileDB 解析 + `sub_4A0640(Scene, FileDB, id, bytes, size, op2)`（失败抛「メッシュファイル %s…」） | **① 登记** | 无操作数写；no-op 化的代价 = 该异常路径不再触发 |
| **0x32e** | SETWEATHER:78 | `raw 34057-34113`：α 夹 255、RGB 各 `*dbl_51FA60` 归一化 → `sub_49A080(Scene, op1, op2, …)` | **① 登记** | 无操作数写 |
| **0x328** | SETWEATHER:81 | `raw 41080-41113`：op1、count=op3、op2 指针 → DEC 解密 `4*count` dword → `sub_4183F0(Scene, op1, arr, count)` | **① 登记** | 无操作数写 |

---

### A.4 A 段结论：真正「现在就能做」的只有 4+5 条

1. **★最高性价比：`SETWEATHER` 族 5 条（0x327/0x328/0x329/0x32C/0x32E）→ 登记为 `engine-internal` 有据 no-op。**
   - 理由链（我全核过）：① `SETWEATHER` **是被剧情脚本调的**（`call-script 47 // SETWEATHER` 出现在
     `src/SC5450.txt:3573`、`SC0500.txt:26212`、`SC4000.txt:4359`、`SC0070.txt:29136`、`SC5530.txt:4181`、`SC4160.txt:5752`、`SC2060.txt:28374/30048`、`$1$SC4330.txt:4993`、`DEBUGADV.txt:1923` …）；
     ② 这 5 条的体**都不回写操作数**（机械扫描 `sub_42B4B0|sub_42BA00` = NONE）；
     ③ 同族 `0x324/0x325/0x326` 已在 `stubs.ts:104-125` 是 `engine-internal` 有据 no-op（口径一致）。
   - ⇒ 改动面：`analysis/opcode-gaps.json` 5 条 `disposition`（`deferred → engine-internal`）+ note 写清 why；
     `app/amayui-emulator/src/vm/handlers/stubs.ts` 注册 5 条（`ENGINE_INTERNAL_OPS`）+ raw 注释；
     `node scripts/build-opcode-gaps.mjs`（写模式）+ 守卫。**机械可验证**：真脚本跑到 `SETWEATHER` 不再 `NotImplementedOp`。
   - ⚠ 纪律提醒：这不是「塞进 ENGINE_INTERNAL_OPS 静默跳过」——`engine-internal` 的定义就是「已读体确认对 VM 不可观测（有据跳过）」，
     必须把「哪一行体证明它不碰 VM」写进 note（否则 `gaps:check` / 守卫的红是应该的）。
2. **`0x147` / `0x2f2`：纯几何命中测试**（多边形 / 椭圆），体已完整读到「输入 → DEC → `PtInRegion` → 写 op1」，
   最坏路径（建区失败）也读到了（错误串 + op1=0）。⇒ **无需任何宿主缝**，两条一起做。
   价值：语料各 1 处（CONFIGCV / REIGN），属"低语料 + 零风险"，适合当热身。
3. **`0x1d0`：回看页表读出端**（HISTORY 3 处 / CONFIG 1 / REPLAYVOICE 1）—— ①，但**必须与写端 `0x70`/`0x71` 一起做**（写端体我未读，是本条唯一前置）。
4. 其余 22 条全部是 **②**（指名子系统）：DDraw/2D（0x25/0x26/0x28/0x2b/0x36/0x82/0x85）、宿主光标（0x86/0x87）、宿主窗口（0x2cf）、
   输入点击队列（0x2fd）、mesh（0x236/0x241/0x329）、3D/Effect3D（0x32c/0x327/0x32e/0x328 若选择"真实现"而非 no-op）、
   GDI 文本（0x1d1）、AGERC 对话框（0x140/0x144）、音频回读（0x1c4）、Scene 拾取层（0x222）、模型未确证（0x23a）；
   **③（语料 0 或 DEBUG）**：0x140（DEBUG 门）、0x24d/0x82/0x85/0x26/0x2b（语料 0）。

---

## B. B7 P2/P3：代码侧、未修、且影响可见行为的条目

> 口径：先按 `audit-2026-09-opcodes.md` 的 P2 逐条（28 条）+ P3 汇总表（57 条）筛**代码侧**（排除纯文档措辞），
> 再**逐条 grep emulator 现状**；凡 `audit-2026-09.md §6` 已声明修好的，我去代码里**复核它真的改了**（不转抄）。

### B.1 状态总表（我 grep 到的现状）

| audit id | opcode | 现状（我 grep 到的锚点 `[码]`） | 可见行为 | 建议处置 | 状态 |
|---|---|---|---|---|---|
| op-10-002 | 0x6E | `msgwin.ts:441-444`：`if (speed > 0 && (e.effectFlags & ADV_ACTIVE) === 0)` + 引 `op-10-002` 的订正注释 | — | — | **✅已修** |
| op-2-05 | 0x1F9 | `gfx-texture.ts:206-219`：读 op3 + `normalizeTextureColor` + `native.setTextureObjectParam` | — | — | **✅已修** |
| op-3-003 | 0x307 | `engine-fields.ts:387` `op_set_effect_skip` 已注册 | — | — | **✅已修** |
| op-10-003 | 0x2FC | §6 声明已修 | — | — | ✅（台账，未复读代码） |
| op-7-0x7C | 0x7C | §6/B3 声明 implemented | — | — | ✅（台账） |
| op-9-op805 | 0x325 | `stubs.ts:109-125` 有完整 justification（`engine-internal` 有据） | — | — | **✅（注释级）** |
| **op-6-05 + op-4-02 + op-10-008** | **0xAF / 0x1A8 / 0x10C** | `stubs.ts:236-244` 的 docblock **标题写 `0x10C`/`sub_4220B0`/`raw 30616-30634`，引用的"体全文"却是 `sub_419690`（0xAF）的 arity-槽体**；该 docblock 又物理挂在 `[0xaf, op_engine_internal]`（`stubs.ts:244`）上，而 `[0x10c]` 在 `stubs.ts:221` 用「见上」指回来；`opcode-table.md:282` 的 0x1A8 行仍写「nop（dev 未知指令，通常空实现）」；`opcode-table.md:220` 的 0x10C 行**已正确**（"因 Input = Engine+1032…"） | 无（三条都不回写操作数） | **只改注释/文档**（把 0xAF 的体挂回 0xAF；0x1A8 行改成"写 arity 槽 `95805=1`"；0x10C 的"有据"理由改成"无键盘模型 ⇒ 观测等价"） | **未处理** |
| op-4-06 | 0x203 | `gfx-item.ts:512` `((alpha & 0xff) << 24) \| (color & 0xffffff)` | 潜在边界（语料静态实参无越界 ⇒ 今日不可见） | 改代码 | **未处理** |
| op-8-F3 + op-8-F4 | 0x12E | `input.ts:254-278`：`for (let i = 0; i < count; i++)`、`r = i*4`、**不读 op1**、**无两道边界门**、也不读 op2 | **是**（语料 47 处；`CONFIG1/TITLE/GAMESTART/FIELD` 主界面按钮命中；op1 多为 1） | 改代码 | **未处理** |
| op-2-10 | 0x02 `exit` | `control.ts:110-150`：只有 `caller === -11 && pendingRecord0` 走装载；`raw` 里 -11 的"无记录⇒不动作"没有对应分支，`else` 直接 `throw new ExitScript`；全文件只有 `:122` 一处提 -11 | 读档链 | 改代码（-11 无记录 ⇒ 不动作） | **未处理** |
| op-4-11 | 0x2EE | `engine-fields.ts:116/351` 只写 `ENGINE_FIELD.messageFade` | 重启后淡入值回默认（语料 1 处） | 改代码（补 `setConfigValue(messageFade)`） | **未处理** |
| op-1/0x141 | 0x141 | `engine-fields.ts:207-211` `if (v > 0x10) return;`（有符号 `readIntOperand`） | **否**（我统计 `i141` = **0 处**） | 改代码（一行 `>>> 0`） | 未处理（不可见） |
| op7-0x135 | 0x135 | `arithmetic.ts:78-83` `if (bit > 0x1f) throw new Error(...)`（有符号 + 抛 JS 异常） | **否**（`i135` = **0 处**） | 改代码 | 未处理（不可见） |
| op-6-01 | 0x34B | `live2d.ts:125-129` 仍 `optInt(2)/optInt(3)/optInt(4)`；`0x347/0x348` 同在 `:187-189` | 语料 0 | 改代码（需先扩 L2D 节点缩放模型为三分量） | 未处理（已披露偏差） |
| op-9-op840 | 0x348 | `live2d.ts:188` `[0x348, op_l2d_node_scale]`（仍当缩放） | 语料 0 | 改代码 + `live2d.md:73` | 未处理（已披露） |
| op-4-07 | 0x34A | `live2d.ts:118-121` 仍整数读 op2..op4 | 语料 0 | 改代码 | 未处理（已披露） |
| op-3-004 | 0x196 | `msgwin.ts:587-597` 只 captureFontStyle/addRuby/emitWin，**无 `effect_flags |= 0x20000000`、无节拍计时器、无外层门**；`opcode-table.md:264` 仍三路并列 | 语料 `i196` = 0 | **只改文档 + 注释** | 未处理（文档级） |
| op-6-09 | 0x20A | `msgwin.ts:694-701` 已注册并写清「emitWin ≡ `sub_45AD30` 重排 + `sub_45A940` 重贴」；但 `opcode-table.md:354` 仍「仅映射」 | 无 | **只改文档** | 部分处理 |
| op-6-10 | 0x32 | `gfx-state.ts:131-161` 注释已写「按 `Engine[166964]` 两条支路 + 夹取/跟随/错误串」；**handler 本身不读 166964** | 存档缩略图等（语料 337 处同型） | 只改文档，或补一次「按槽尺寸夹取」 | 部分处理 |
| op-6-07 | 0xBC | `audio.ts:629` 已实现；`Engine[174712]` 全仓 grep = **0 命中** | 无 | 只改索引/文档；若建模先登记字段 | 未处理（文档级） |
| op-8-F8 | 0x25B | `engine-fields.ts:118/353` 只写 `msgMediaImageId(92381)`，**没写 `mediaMode(92379)`**；两格都无读者 | 无 | **只改文档**（+可选同步写 mediaMode 以对称 0x25A） | 未处理（文档级） |
| op-2-12 / op-4-10 | 0x6F / 0x71 | `msgwin.ts:361-366`、`textItems.ts:23`、`handlers/text-items.ts:18-19,39` 已有 `ENGINE_FIELD.textBaseGate`（97055）门与 `0x1BB` 写入端 | — | **只改文档**（审计说"未建模"，实际已建模） | 未处理（文档级） |
| op9-op255 | 0x1FF | `gfx-item.ts:694` 已注册；「`[cur+122327] = Engine[517]` 未建模」[台账] | 语料 2377 处 | 待核（我没读 raw 24997-25009） | 未处理（未核） |
| op7-0x30a | 0x30A | `stubs.ts:222` `[0x30a, op_engine_internal]`，**无任何 justification 注释**（审计说体读 2 操作数、写 1969、可抛异常） | 语料 1 处 | 只改注释（或建线）；体我没读 | 未处理（注释级） |
| op-4-05 | 0x22D / 0x234 / 0x329 | `0x22D`/`0x234` 已在 B3 转 implemented；`0x329` grep **无 `[0x329`** 注册 ⇒ 仍硬停 | SETWEATHER | 见 A.4 | 部分处理 |
| op-10-010 | 0x251 / 0x1B3 / 0x231 / 0x22C / 0x36 | 前四条 B3 已实现；`0x36` 仍 deferred | `0x36` 5 处剧情 | 见 A | 部分处理 |

### B.2 未处理里我另外自己核过体的两条（细节）

**`0x203`（P2 `op-4-06`）—— 体 vs 码，逐行对照（我两边都读了）**
- 体 `[体] raw 31419-31451`：
  ```
  v2 = op3(alpha); v3 = op4(color);
  if (v2 <= 255) { if (v2 < 0) v2 = sub_4ADD60(Scene, op1) >> 24; }   // raw 31429-31436
  else v2 = 255;                                                      // raw 31437-31439
  if (v3 < 0) v3 = sub_4ADD60(Scene, op1);                            // raw 31440-31444
  ... sub_4ACF60(Scene, op1, op2, (u8)v3|((BYTE1(v3)|(((v2<<8)|BYTE2(v3))<<8))<<8))
  ```
- 码 `[码] gfx-item.ts:507-513`：`argb = ((alpha & 0xff) << 24) | (color & 0xffffff)`，注释**自称**「op3=alpha(clamp/回退)」但与实现不符。
  ⇒ `op3 >= 256` 时 emulator 给 α=0（引擎 255）；`op3/op4 < 0` 时丢回退。**结论：审计说得对，至今未修。**

**`0x12E`（P2 `op-8-F3` + `op-8-F4`）—— 体 vs 码**
- 体 `[体] raw 39212-39251`（我读了全部关键行）：
  `dword_55D58C = sub_42AEA0(op6) + 4*op1 + 4`（raw 39214-39215）、`dword_55D588 = sub_42AEA0(op7) + 4*op1 + 4`（39216-39217）、
  `dword_55D57C = dword_55D590 + 16*op8`（39222）、`dword_55D568 = dword_55D590 + 16*(op1+1)`（39230）、
  **门①** `if (dword_55D568 >= (unsigned)dword_55D57C) return op1 = -1;`（39231-39232）、
  每步 `dword_55D58C += 4; dword_55D588 += 4`、`dword_55D568 = v9 + 16`、**门②** 同式（39247-39249）、
  最终 `op1 = ((dword_55D568 - dword_55D590) >> 2)/4`（39251）——**写的是全局项下标，不是循环计数**。
  另外 `op2`（`sub_42AEA0(_this,2)` → `dword_55D594` 的 4 个 DEC dword = raw 39218-39228）**是窗口矩形**，emulator 完全没读。
- 码 `[码] input.ts:254-278`：`for (i=0; i<count; i++)`、盒平面 `r = i*4` 从 **0** 起、x/y 平面 `refAt(bxRef, i)`、命中即 `idx = i; break;`。
  ⇒ 缺 `op1` 起点、缺两道门、缺 op2 窗口矩形、返回下标口径不同。**结论：审计说得对，至今未修**（也是 `ALLOW_UNDERRUN` 里唯一剩下的"确认是 bug"）。

---

## C. 下一轮建议的 5 条活（按性价比）

| # | 一句话 | 为什么值得 | 预估改动面 | 卡点 |
|---|---|---|---|---|
| **1** | 把 `SETWEATHER` 族 `0x327/0x328/0x329/0x32C/0x32E` 按体登记为 `engine-internal` 有据 no-op | **用户可见 + 解锁多条**：`SETWEATHER` 被 10+ 剧情脚本 `call-script 47` 调用（我 grep 到 SC0500/SC0070/SC2060/SC4000/SC4160/SC5450/SC5530…），而 5 条里任何一条命中就 `NotImplementedOp` 硬停整条脚本；同族 3 条已是同口径 no-op ⇒ **口径一致、零猜**。机械可验证：`build-opcode-gaps.mjs --check` + 真脚本跑过 | `analysis/opcode-gaps.json`（5 条 disposition + note 写 why）+ `src/vm/handlers/stubs.ts`（5 条 + raw 注释）；`opcode-gaps` 守卫 | 无技术卡点；**纪律卡点** = note 必须写「哪一行体证明不碰 VM」（我已扫出无 `sub_42B4B0`，可原文引用行区间） |
| **2** | `0x12E` 按体补 `op1` 起点 + 两道边界门（+ 返回全局项下标） | **用户可见**（语料 47 处，`CONFIG1/TITLE/GAMESTART/FIELD` 的按钮悬停/命中）；**机械可验证** = `ALLOW_UNDERRUN` 里"确认是 bug"的**最后一条**，删白名单条目即证明 | `src/vm/handlers/input.ts` + 新守卫 `test/op-012e-hover.test.ts` + `test/opcode-operands.test.ts` 白名单 | 体我读到 `op2` 窗口矩形与 x/y 平面相差一个元素的细节（`raw 39245-39247`），**建议实现前把 `raw 39218-39251` 再读一遍**别照抄我这段摘要 |
| **3** | `0x1d0` + 写端 `0x70`/`0x71`：回想页表模型 | **用户可见**（HISTORY 回想 / CONFIG / REPLAYVOICE 三个真实界面；只做读端 ⇒ 恒 `-1/-1` ⇒ 列表静默为空）；扩展点已在 `opcode-gaps` note 里写清（`textItems.ts` 加 `pages`/`cursor`） | `src/vm/textItems.ts` + `src/vm/handlers/msgwin.ts`（`0x70`/`0x71`）+ `advState` 快照 + 新守卫 | **写端体我没读**（`sub_45D660` raw 73181 / `sub_45EC60` raw 74267）⇒ 这是动手第一件事；`0x71` 还受 `Engine[97055]` 门控（那个门 emulator 已建模） |
| **4** | `0x203` 补 clamp/负值回退（顺带 `0x2EE` 补 `SetConfig`） | **机械可验证**（两处都是"引擎有分支、emulator 没有"的定点小修，`raw` 行号已给全）；语料 `set-draw-color-alpha` 7637 处但静态实参无越界 ⇒ 修的是**潜伏**分叉 | `src/vm/handlers/gfx-item.ts`（需要"取当前色"的来源 = `sub_4ADD60` 等价物，检查 `native` 是否已有 getter；没有就复用 headless 模型）+ `engine-fields.ts` + 单测 | `sub_4ADD60`（取当前 work 色）在 emulator 有没有等价读端——要 grep 一下；没有就必须先加，否则 `<0` 回退仍是编数 |
| **5** | 二选一：**(a)** 宿主光标缝 `0x86`/`0x87`（25 处 / 5 文件：ALLMAP·CGVIEWER·FIELD·HIDEWIN·REIGN）／**(b)** DDraw/2D 缝（`0x28` 为首，解锁 `0x25/0x26/0x28/0x2b/0x36/0x82/0x85` = **7 条 / 45 处剧情语料**） | 都是"卡子系统但回报大"。(a) 缝最小（`SetCursor` 一条链，体已读全）；(b) 解锁最多，且是**剧情脚本**（SC0000/SC0070/SC2340/SC0590…） | (a) 五处同步的 `native.setCursor?` + FileDB 链；(b) 先读 `sub_441060`/`sub_441410`/`sub_443B20` 定 2D 缝形状（我已读开头，`Engine+7912` = `&Sys3Draw___vftable_`） | (b) 的卡点是「哪张 surface / 什么混合」还没定；**建议先做 (a) 或先读 (b) 的三个体再决定** |

---

## D. ★缺口披露：我做不到 / 没读到 / 没核的部分（不许沉默掩盖）

1. **`analysis/fields.json` 里 `Engine/0x408` 的 scope 我认为写错了（发现，未定论到能改）**
   - `fields.json` 同时有 `Engine/0x408 draw_item_container` 与 `Scene/0x408 draw_item_map` 两条（都是"`_this[258]` = 字节 1032"）。
   - 我读体确认**字节 1032 在 Engine 上是 Input 管理器**：`sub_406C70 raw 11993` 把 `hWnd` 交给 `sub_478050(_this+258, a2, hWnd)`；
     `sub_477220 raw 91632-91641`（`_this+258`）用 `GetAsyncKeyState` 读左右键；`opcode-table.md:220` 的 0x10C 行**也**写「因 `Input = Engine+1032` 字节」。
   - 而绘制项 map 是 **Scene** 的 `+1032`：`sub_4AAA50 raw 130039` `v3 = (_DWORD*)(_this+1032)`（这里的 `_this` 就是 0x223 handler 在 `raw 31957` 传的 `_this+80708` = Scene）；`sub_4B4460 raw 137212` 亦同。
   - ⇒ 倾向结论：**`Engine/0x408` 那条是重名/错 scope**。我没改（只读），也没把 `Scene` 基址（= `Engine+80708`）查全，**交给 owner 复核**。
2. **`handoff.md` 内部计数不一致**：§1 表格写 "deferred 28"、§5 写 "`deferred` **27 条 = 292 处**"；`analysis/opcode-gaps.json` 实际是 **28 条 = 292 处**（我算的 292 与之吻合）。建议 owner 顺手统一（这是文档卫生，不是新发现）。
3. **我没跑** `npm run verify` / `npm run shot`（按要求不抢资源）。因此 B 段所有"现状"只是**静态 grep 结论**，没有跑测试确认；`§6` 里声明的"已修"我**只复核了有代码可查的那几条**（0x6E / 0x1F9 / 0x307 / 0x325），`0x2FC`/`0x7C`/`0x1A0`/`0x100`/`0x305`/`0x2E7` 我**没有复读代码**（标了"台账"）。
4. **A 段里我"没读体"的**：
   - 5 条语料 0 的（`0x24d`/`0x82`/`0x85`/`0x26`/`0x2b`）—— 只做计数，没读体；
   - `0x241` 的后段（mesh 装配部分）、`0x32e`/`0x328` 的中间段（我读到调用点与"无操作数写"的机械扫描，但没逐行读完）；
   - `0x1d1` 的被调 `sub_4675A0`（GDI 文本页渲染器）—— 只有 `[台账]`；
   - `0x1d0` 的写端 `0x70`/`0x71`、`0x1c4` 的 `sub_404CB0` 细节、`0x222` 的 `sub_4535F0` —— 只有 `[台账]`（我明确把它们标成"前置 = 要先读"）。
5. **P3 57 条我没有逐条 grep**：我按任务书点名的 10 个 opcode + "代码侧且影响可见行为"这一筛子，扩到 20 余条（B.1 全表）。
   剩下的纯文档措辞类（`op-2-07`/`op-4-03`/`op-5-006`/`op-5-007`/`op-5-009`/`op-8-F5`/`op-8-F6`/`op-8-F7`/`op-8-F12`/`op-9-op265`/`op-9-op170`/`op-10-005`/`op-10-006`/`op-10-007`/`op-3-007`/`op-3-001`/`op-2-09`/`op-2-11`/`op-3-009`/`op-9-op137`/`op3-008`/`op-5-003`/`op-5-008`/`op-10-004`）**我没有逐条核**——
   它们多数是"索引/文档行号与措辞"，与可见行为无关，建议由文档 owner 按汇总表批量处理（不属于"下一轮挑活"的范围）。
6. **`0x23a` 的 `Engine+91322` 表**我仍然没找到写点（与台账结论一致），因此**不能**给"现在可做"的判据；`0x2cf` 的 `sub_413DD0` 我也没读体（标 `[台账]`）。
7. **语料计数是"行数"，不是"执行次数"**：`grep` 统计的是静态出现处数；`0x140` 的 181 处里每处都只在 DEBUG 门后才执行（这是"处数≠影响"的实例）。B 段的"语料 N 处"同此口径。
