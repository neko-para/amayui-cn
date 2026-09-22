# T-0114 变更记录

> 本票由 **PROPOSAL**（`notes.md`）转为**分步实现**。用户 2026-09-22 批准「请继续」后开工。

---

## 第 1 次变更（2026-09-22）—— 第 1 步：**调试查询（direct query）** 落地

### 做了什么

把「某个量现在是多少」从**改源码加诊断 → 重编 → 从标题推进约 4 分钟**
（`tickets/T-0102` 的实际代价）变成**控制面板上一次回车**。

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/vm/debugQuery.ts`（**新增**） | 纯函数 `runQuery(engine, text)` + `DebugQueryResult`；手写白名单解析，**不 eval**；**只读** |
| 2 | `src/renderer/app/session.ts` | `registerControlHandlers` 里接 `onDebugQuery` → 调 `runQuery(this.#e, text)` → `sendDebugQueryResult` |
| 3 | `electron/preload.ts` | `debugQuery`（**invoke**，要回答案）/ `sendDebugQueryResult` / `onDebugQuery` |
| 4 | `electron/ipc/control.ts` | `control-debug-query` 中转（控制窗 → 主 → 渲染窗）+ 按 `id` 配对 + **5 s 超时兜底** |
| 5 | `src/renderer/ipcProtocol.ts` | 补三条通道的类型声明 |
| 6 | `control/index.html` + `dom.ts` + `control.ts` | 面板加"查询输入 + 查询按钮 + 用法按钮 + 等宽结果块（可滚动）"；回车即查 |
| 7 | `test/debug-query.test.ts`（**新增**） | 7 例守卫 |

### 命令集（第 1 步范围）

```
global <下标> [count]   全局 int 槽（给**解码后**的值 + 原始编码值）
local <下标>            当前帧的 local int 槽
frame [下标]            列帧栈；给下标则展开该帧（脚本/ip/caller/局部量）
flocal <帧> <下标>      指定帧的 local int 槽
slot <槽号>             纹理槽绑定（VM 台账 / 尺寸，分开报）
run                     当前运行态（cur / 脚本 / ip / 等待门 / 错误）
help | ?                用法
```
★下标按**十六进制**读（与 `src/*.txt` 字面量口径一致），也接受 `0x` 前缀。

### 两处刻意的口径决定（都有守卫钉住）

1. **`global` 必须报"解码后"的值**。引擎 int 池内存里是 ENC 过的：脚本写 `6` 存的是 `enc(key,6)=0x18000`。
   只报原始值会误判 —— **T-0102 真踩过这个坑**（`0x4000` 到底是 1 还是 6 取决于 `key`）。
   所以同时给 `= 6 (0x6)` 与 `[raw 0x18000]` 两个口径。
2. **未写过 = 0**，且**显式标出"未写过"**（与操作数读侧 `decIntSlot(key, undefined) === 0` 同口径）。
   T-0102 里 `1dd7/3318/1521/2f3c` 全是"未写过"，这个标注能立刻区分"真的是 0"与"从没被写过"。

### 判据与证据

- `npm run verify` 全绿：**1044 测试（1032 pass / 12 skipped / 0 fail）** + typecheck ×3 + 死写 0；
- 守卫 `test/debug-query.test.ts` **7/7**：值口径 / 未写过 / 批量 / 帧栈与展开 / 失败给用法 /
  **纯只读（跑前后状态快照相等）** / **源码棘轮（不出现 `eval(`、`new Function(`）**。

### 诚实边界（未做 / 未验）

- **未做 E4**：控制面板 UI 通路（invoke 中转 + 面板渲染）**没有在真界面上点过** ——
  需要跑一次 `npm run` 相关入口，确认面板能查到值。**这一步要用户配合验证**。
- `slot` 查询目前只读 **VM 台账**（`engine.texSlots` / `texSizes`）；
  **宿主侧"纹理是否已就位"**（`TextureCache.slotTex`）未纳入 —— 提案 §3 把它列为后续步。
- 只读：本变更**没有**任何写路径（热改全局量若要做，须另开通道并单独设计）。

---

## 第 2 次变更（2026-09-22）—— 第 1 步的**用户实测反馈**两处修复

用户实测确认查询通路**已打通**（拿到了 `global 0 = 1`、`1dd7 未写过`、帧栈），并提出两点：

| 反馈 | 处置 |
|---|---|
| **输出没法复制** | 面板加 **「复制结果」** 按钮：优先 `navigator.clipboard`，失败回退临时 `textarea` + `execCommand('copy')`（旧 Electron 可能拒 clipboard）。落点 `control/{index.html,control.ts,dom.ts}` |
| **`frame` 空槽太多**（实测 40 帧里绝大多数是 `scriptId=0xffffffff / ip=0` 的空壳） | `frame` 改为**只列活帧**（判据：`script !== null \|\| scriptId >= 0`），空槽折叠成一行汇总（含下标表，最多列 24 个）；新增 **`frame all`** 强制全列；`frame <下标>` 仍可展开任意帧（含空槽）。落点 `src/vm/debugQuery.ts` |

守卫同步更新：`frame` 用例改为**真断言折叠行为**（活帧列出 / 空槽不逐条展开 / `frame all` 全列）。

**验证**：`npm run verify` 全绿（**1044 测试 / 1032 pass / 12 skipped / 0 fail** + typecheck ×3 + 死写 0）；`test/debug-query.test.ts` **7/7**。

★**过程中发现我自己写的测试夹具有错**：新建 `Engine` 的 `frames[i]` 默认 `scriptId=-1` 且 `script=null`
⇒ 我最初把"空槽"设成 `scriptId=-1` 反而没造出空槽、而"活帧"也没造出来（首版判据 `script!==null || ip!==0 || scriptId!==-1` 会把真活帧判成空壳）。已改为按实测形状（`scriptId>=0` 或 `script` 非空）判定，并把 `ip` 从判据里去掉（`ip===0` 的活帧不该被折叠）。

---

## 第 3 次变更（2026-09-22）—— 第 2 步**核心件**：条件断点 + 语义事件断点的**引擎与守卫**（IPC/UI 未接）

按用户确认的范围（**指令步 + 语义事件都要**、暂停后**只读查询 + 继续**）开工，本变更交付**纯函数内核 + 守卫**。

### 交付

| # | 文件 | 内容 |
|---|---|---|
| 1 | `src/vm/debugBreak.ts`（**新增**） | 条件表达式（**手写递归下降 + 白名单，不 eval**）、`compileBreak`、`matchInstruction`（指令步）、`matchEvent`（语义事件：`global-write` / `slot-bind`） |
| 2 | `test/debug-break.test.ts`（**新增**） | 8 例守卫（见下） |

### 表达式语法（已定稿并写进文件头）

```
expr    := or
or      := and ('||' and)*
and     := cmp ('&&' cmp)*
cmp     := unary (('=='|'!='|'<='|'>='|'<'|'>') unary)?    // 缺比较 = 真值判定（非 0 为真）
unary   := '!' unary | primary
primary := '(' expr ')' | INT | 'global' INT | 'local' INT
         | 'slot' [INT] | 'idx' | 'val' | 'imgid'
```
- **数字口径（无歧义优先）**：`0x…` ⇒ 十六进制；含 `a-f` 的串 ⇒ 十六进制；**纯数字串 ⇒ 十进制**。
  例：`0x11`=17、`11`=11、`1dd7`=0x1dd7、`f8080`=0xf8080。
  （理由：条件由人手敲，`11` 几乎一定指十进制；要 hex 就写 `0x`。）
- **事件参数**：语义事件断点的条件可引用本次事件的量 ——
  写全局用 `idx`/`val`，绑槽用 `slot`/`imgid`。
  ⇒ 「任何写 `global 0` 都停」= `idx == 0`；「槽 0x11 绑上 0x5260 就停」= `slot == 0x11 && imgid == 0x5260`。

### 两处**刻意缩范围**（写进代码注释，避免后人误以为是漏做）

1. **表达式里不支持 `frame[i].local`**（"指定别的帧"）。它在纯十进制口径下与 `frame[11]` 有歧义风险，
   而实际排查 99% 只需当前帧的 `local N`。要查别的帧请用控制面板的 `flocal <帧> <下标>` **查询**。
2. **只读**：断点只回答"命中了吗"，本变更**没有**任何写引擎状态的路径（热改值未做，用户也未要求）。

### 守卫（8 例，全绿）

值口径（hex/十进制/含字母）· 解码后的值 · 缺项语义（未写过 = 0；未绑槽取 -1 并**文档化**）·
`local` 与逻辑/比较运算 · 解析失败给**面向用户**的错误 · step 断点命中判定 ·
**event 断点用事件参数判定且 `where` 不匹配绝不命中** · 源码棘轮（不 eval）。

### 过程中修掉的**自己的 bug**（都靠测试暴露，值得记）

| bug | 症状 |
|---|---|
| 词法漏了 `[`/`]` token | `frame[1].local` 在字符流里"看起来对"，一到 parser 就报"尾部有多余内容" |
| 词法非 `0x` 分支**漏了推进下标** | token 流卡在同一字符上 ⇒ 后续全部解析失败 |
| 测试夹具写错 | 新建 `Engine` 的 `frames[i]` 默认 `scriptId=-1`/`script=null` ⇒ 我的"活帧/空槽"判据反了 |
| 测试写了语法上不存在的字面量 | `slot 11 == -1`（负数不在语法里）⇒ 用例本身无效，已改 |

**验证**：`npm run verify` 全绿（**1052 测试 / 1040 pass / 12 skipped / 0 fail** + typecheck ×3 + 死写 0）。

### ★诚实边界：**第 2 步还没可用**（IPC/UI/暂停闸门未接）

本变更只交付了"判定命中"的内核。要让它在真界面上可用，还差三件：

1. **暂停闸门**：在 `frame/loop.ts` 的 `dispatch()` 里（`await stepOnce` **之前**）加异步检查；
   命中则 `await` 一个 Promise 门，由面板的「继续」来 resolve。
   ★**绝不能同步阻塞 IPC**（会冻住渲染进程自己的控制通道）—— 必须走 async/Promise 门。
2. **IPC**：照第 1 步 `debug-query` 的四段式抄一遍（`break-set` / `break-clear` / `break-list` / `break-continue`）；
   **显示用推送**（`control-break-hit`），**不用 invoke**（暂停是持续态，不是一次问答）。
3. **面板 UI**：断点输入框 + 列表（显示 `命中次数`）+ **「继续」按钮**（暂停时高亮）。

另有 5 处临时诊断（`arithmetic.ts`/`gfx-texture.ts`/`save-slot.ts`/`control.ts` 的 `[T-0102 诊断]`）
仍在源码里 —— 等 T-0102 收尾时一并撤。

> ★**2026-09-23 已撤（第 8 次变更）**：这 5 处**全部移除**（`arithmetic.ts` 3 处 + `control.ts` 1 处 +
> `gfx-texture.ts` 1 处 + `save-slot.ts` 1 处，含两个随之不再使用的 `decIntSlot` import）。
> 撤的理由不只是"清理"：其中 `SCJUMP 门：1dd7=…` 那一条打的是**已证伪的变量**（轮 19 实测门读
> `13d7`/`13d8`）⇒ 留着会**误导下一个读日志的人**。观测能力已由本票的查询 + 断点 + 输入驱动覆盖
> （`tickets/T-0102/evidence/chapter-chain-runtime-trace.md` 就是不带任何源码探针取到的证）。

---

## 第 4 次变更（2026-09-22）—— 第 2 步**接线完成**：暂停闸门 + IPC + 面板 UI（**指令步断点可用**）

第 3 次变更只交付了"判定命中"的内核；本次把三件接线补齐。

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/frame/loop.ts` | 新增 `FrameLoopOptions.onBeforeStep`（**异步**、在 `stepOnce` **之前**、`onStepStart` 之后）。★为什么必须在执行前：`stepOnce` 查表/抛错阶段不改 VM 状态，停在执行后那条指令就"看得见停不住"；且 `stepOnce` 抛错时 `onStep` 不触发，断点要能停在"即将抛错的那一条"上 |
| 2 | `src/renderer/app/session.ts` | 断点表 `#breaks`、暂停闸门 `#breakResume`（Promise）、`#beforeStep()`、`#pauseAtBreak()`、`#resumeFromBreak()`、`#addBreak()`、`#reportBreakList()`；`#loopOptions` 里挂 `onBeforeStep` |
| 3 | `src/renderer/ipcProtocol.ts` | `BreakCommand` 联合类型 + 6 条通道声明（`controlBreakCommand` / `sendBreakPaused` / `sendBreakList` / `onBreakCommand` / `onBreakPaused` / `onBreakList`） |
| 4 | `electron/preload.ts` | 上述 6 条（控制窗下发用 `send`；命中/列表**推送**回来） |
| 5 | `electron/ipc/control.ts` | `control-break-command` 转发 + `renderer-break-paused` / `renderer-break-list` 转发到控制窗 |
| 6 | `control/{index.html,dom.ts,control.ts}` | 断点区：类型下拉（指令步 / 事件·写全局 / 事件·绑纹理槽）+ 条件输入 + 「加断点」/「清空」/「**继续 ▶**」（暂停时自动可用）+ 断点表显示（含**命中次数**）与暂停提示 |

### 关键设计（都写进代码注释）

1. **暂停 = await 一个 Promise**（`#breakResume`）。★**绝不能同步阻塞 IPC** ——
   那会把渲染进程处理"继续"的那条通道一起冻住（死锁）。渲染进程在暂停期间**仍在转**
   （能收 IPC、能合成、能跑服务），只是不再派发下一条指令。
2. **「继续」= 放行同一条指令**（`#breakSkipOnce`）。断点语义与常规调试器一致：
   继续是"从这条走*过去*"，不是原地反复命中（否则用户点继续也不动，看起来像死锁）。
3. **命中/列表用推送，不用 invoke**：暂停是**持续态**，面板只是"被告知"；
   用户点继续再走 `control-break-command` 回来。若是 invoke，面板会一直挂着一次未完成的请求。
4. **断点表由渲染窗持有**，面板不维护副本 —— 避免两边漂移（面板只显示渲染窗推来的快照）。

### ★诚实边界：**语义事件断点尚未接线**（指令步断点已可用）

- **可用**：指令步断点（`global 0x11 == 5260`、`local 1 == 3`、无条件断点等）；
- **还不能用**：**事件断点**（`idx == 0` 那种"任何写 `global 0` 都停"）。
  `debugBreak.ts` 的 `matchEvent` **已实现且有守卫**，但**引擎侧还没有调用点** ——
  需要两处缝：① 写全局 int 的路径（`writeIntOperand` 的 `TYPE_GLOBAL_INT` 分支）触发；
  ② `TextureCache.bind` 触发。这两处越过了"纯 VM"边界（要经 `Engine` 上的钩子回渲染窗），
  故单独一步做，**本次未做**。
- **未做 E4**：整个断点通路（IPC + 面板 + 暂停/继续）**没有在真界面上点过**，需要用户验证。

**验证**：`npm run verify` 全绿（**1052 测试 / 1040 pass / 12 skipped / 0 fail** + typecheck ×3 + 死写 0）。

---

## 第 5 次变更（2026-09-22）—— 交互改为 **lldb 风格命令台**（用户要求）+ 术语订正

### 用户两点意见

1. **交互改为"输入指令 → 生效"**，不要按钮式 UI；
2. **"指令步"这个叫法看不懂** —— 问"是指任意指令执行后满足特定条件吗？"

### 术语订正（答第 2 点）

**不是"执行后"，是"执行前"**。正确表述：

> **条件断点**：**每条指令即将执行时**，用**此刻的引擎/帧状态**求一次条件，满足就停。
> 与"刚执行过哪条指令"无关 —— 所以 `b global 0x11 == 5260` 的含义是
> "**当 0x11 号全局等于 0x5260 时，在下一条指令之前停住**"。

代码里已把"指令步"全部改写为**条件断点**，并在 `debugBreak.ts` 文件头显式写明这处易误读点。
两类断点与 lldb 的对应：

| 本工程 | lldb 类比 | 触发点 |
|---|---|---|
| **条件断点**（`kind:'step'`） | `breakpoint set --condition` | 每条指令**执行前** |
| **语义事件断点**（`kind:'event'`） | watchpoint | 改状态那一瞬（写全局 / 绑槽） |

### 交付：单一命令台取代按钮

**UI**（`control/index.html`）：删掉"查询框 + 断点下拉/输入/加/清空/继续"整块，换成
**一个输入框 + 转录区 + 状态行 + 帮助/复制**。输入回车即生效。

**命令表**（`debugBreak.ts` 新增 `parseDebugCommand`，纯函数）：

```
b <条件>              条件断点（例：b global 0x11 == 5260 ／ b = 每条都停）
b event <类型> <条件>  语义事件断点（类型：global-write / slot-bind）
bl / breakpoints      列断点（含命中次数）
d [id] / delete [id]  删一条；省略 id = 全删
c / cont / continue   继续（从当前指令走过去）
? / help              帮助
<其它>                一律当**查询**（global 0 ／ local 1 ／ frame ／ slot 0x11 ／ run）
```

**两条设计决定**：
1. **其它输入一律当查询** ⇒ "查一个值"**不需要任何前缀**（这是最常用的动作）；
2. 面板侧**自带一份命令表**（不 import 渲染窗的 `parseDebugCommand`）——
   控制窗与渲染窗是**两个编译单元**，跨单元 import 会把后者的类型/依赖拖进来
   （`ipcProtocol.ts` 的 `recordScript` 注释记过同类事故）。两份命令表的一致性由
   **守卫测试**（`test/debug-break.test.ts` 的 `parseDebugCommand` 用例）钉住。

### 验证

`npm run verify` 全绿（**1053 测试 / 1041 pass / 12 skipped / 0 fail** + typecheck ×3 + 死写 0）；
命令台解析守卫 +1（覆盖 `b` / `b event` / `bl` / `d` / `c` / 其它当查询 / 两种错误用法的可读提示）。

★仍未做：**事件断点的引擎侧调用点**（`matchEvent` 已实现且有守卫，但写全局/绑槽两处缝未接）；
**E4 真界面验证**。

---

## 第 6 次变更（2026-09-22）—— **事件断点接线完成**（`b event …` 现在真能用）+ 池语义订正

### 用户质疑推动的两处订正

用户问："**global 里我记得任意类型都能放**，不该无条件当 int" / "**readXXXOperand 里会 cast**，按你说会找不到？"

核对结论（**两个层面都对，但不是同一层**）：

| 层 | 模型 | 依据 |
|---|---|---|
| **操作数层** | **扁平 variant**：操作数 = `(type tag, 4B value)`，tag 写在指令流 `-4` 处 | `sub_41BF50` 的 `switch(v3)`：`case 3` 全局 int / `case 4` 全局 float / … |
| **运行期存储层** | **按类型分池**：8 个池基址（3 值池 + 3 引用池 + `_alt`） | `analysis/fields.json`：`pool_int 0x5D800` / `pool_float 0x5D808` / `pool_string 0x5D810` / `pool_int_ref 0x5D818` / … |

⇒ **"存 int 3318 再读 float 3318" 不会找不到、也不会冲突**：两者是**不同池**，
`3318` 只是各自的下标（实测：写 int 3318 后读 float 3318 = 0；再写 float 3318 = 2.5，
读 int 3318 仍是 1）。用户记的 "cast" 发生在**同一个 tag 内部**（如 `readIntOperand` 遇到
`TYPE_GLOBAL_FLOAT` ⇒ 读 **float 池**再 `| 0`），**不是**跨池按需转换。

**据此把事件名按池显式命名**（不再有笼统的 `global-write`）：

| 事件 | 参数 | 口径 |
|---|---|---|
| `global-int-write` | `idx` / `val` | `val` = **解码后**的 int（`3318` 属于它） |
| `global-float-write` | `idx` / `val` | `val` = **单精度位模式**，用 `f2i(val)` 比数值 |
| `global-str-write` | `idx` / `val` | `val` = 字符串**长度**（本条件语言不能比字符串） |
| `slot-bind` | `slot` / `imgid` | `0x1F9` 与 `0x249` **两条绑定路径都发** |

三个**引用池**（`ptr`/`floatPtr`/`strPtr`）发的是"引用变更"而非"值变更"，**当前不发事件**（已在 `Engine.debugEvent` 注释里写明，属后续）。

### 接线（跨三层，这是本次的实际交付）

| 层 | 改动 |
|---|---|
| **VM** | `operand.ts`：写全局 int/float/string 各发**对应池**的事件；`gfx-texture.ts`：两处绑槽各发 `slot-bind` |
| **Engine** | 新增 `debugEvent` 钩子 + `emitDebugEvent()`（VM **同步**记录；无钩子时零开销，仅一个 `if`） |
| **主循环** | 新增 `FrameLoopOptions.onAfterStepEvent`（在 `stepOnce` **之后** `await`）—— 事件发生在同步的 `stepOnce` 内部，只能"同步记录 + 之后落地暂停" |
| **session** | `#onDebugEvent`（**在这里**求事件条件，因为事件值只在这一刻可见）+ `#pendingEventHit` + `#afterStepEvent`；`loopOptions` 挂两个钩子；`#e.debugEvent` 注册 |

### 守卫（新文件 `test/debug-event-break.test.ts`，6 例）

写 int/float/string 各发**对应池**事件 · `slot-bind` **两条绑定路径**都发 · int 事件的 `val` 是**解码后**的值 ·
float 事件的 `val` 是**位模式**（`f2i` 可还原）· 无钩子时零副作用 · **源码棘轮**（`onAfterStepEvent`
必须在 `await stepOnce` **之后**；session 必须注册 `debugEvent` 并挂闸门）。

### ★过程中修掉的三处**我自己的** bug（都由测试暴露）

1. **`f32()` 写错了视图**：写成 `F32[0] = bits`（把位模式当**数值**做单精度舍入）⇒ `f32(1069547520)`
   返回 1069547520 而不是 1.5。**必须经 `Int32Array` 视图写入、从 `Float32Array` 读出**。
2. **float 事件用 `| 0` 截断**（1.5 → 1）⇒ `f2i()` 形同虚设。改为编码**单精度位模式**。
3. 测试里 **`operandArg` 写成 0-based**（实际是 **1-based**：`operandArg(instr, n)` 读 `args[n-1]`）；
   以及 float/string-mov 的 opcode 我用了 `0x56`/`0x57`（实际 `float-mov` = **0x2D5**）。

**验证**：`npm run verify` 全绿（**1059 测试 / 1047 pass / 12 skipped / 0 fail** + typecheck ×3 + 死写 0）。

★仍未做：**E4 真界面验证**（整条通路：命令台 → 断点 → 暂停 → 查询 → 继续，尚未在真界面点过）。

---

## 第 7 次变更（2026-09-22）—— **adb 式后台调试守护进程**（用户提议）+ 修掉一个只读副作用

### 为什么做（用户提议，且解决了第 6 次变更遗留的限制）

用户指出：**"控制面板本身就是逻辑上长期存在的界面"** ⇒ 可以像 adb 一样派生一个**后台进程**，
让外置 CLI 连上去操作 —— 而不是每次由用户手点。

这正好解决我先前列的两条限制：① 我的每次工具调用有超时，而推进到目标帧要几分钟；
② 一次调用结束后，上次启动的窗口处于"无人接管"状态。
**长期守护进程 + 短连接客户端**两个问题一起消掉。

### 交付

| # | 文件 | 内容 |
|---|---|---|
| 1 | `tools/debugsrv.cjs`（**新增**） | electron 主脚本：复用 `dist/electron/main.cjs` 起窗，再开一个 **TCP** 服务（默认 `127.0.0.1:39427`）。把控制窗那几条**推送**镜像成广播（断点命中/断点表/状态） |
| 2 | `tools/dbg.cjs`（**新增**） | 外置 CLI：连上→发一条→收结果与推送→断开（adb 的形） |
| 3 | `electron/main.ts` | **导出** `windows` / `sendDebugQuery` / `sendBreakCommand`（供外部脚本复用**同一个单例**） |
| 4 | `electron/ipc/control.ts` | 把 `sendDebugQuery` / `sendBreakCommand` **抽成导出函数**（IPC 处理器与守护进程共用同一实现） |
| 5 | `package.json` | `dbg:srv`（起守护）/ `dbg`（发命令） |
| 6 | `src/vm/debugQuery.ts` | ★修掉 `run` 查询的**只读副作用**（见下） |
| 7 | `test/debug-query.test.ts` | 守卫**补强**（把门计时器纳入快照） |

### 命令（实测可用）

```
npm run dbg:srv                     # 起守护（长期活着）
node tools/dbg.cjs --ping           # → pong / game=true
node tools/dbg.cjs global 0         # 查询（要回答案，走 invoke）
node tools/dbg.cjs run
node tools/dbg.cjs 'b event global-int-write idx == 3318'
node tools/dbg.cjs bl / c           # 断点表 / 继续（走推送）
node tools/dbg.cjs --quit           # 收工
```

### ★修掉一个真 bug：只读查询曾**写**引擎状态

`run` 查询用 `engine.gatePending(nowMs)` 取门状态，而那个方法**会写**（惰性把 `gateWaitStart`
置为 `nowMs`，到期还清零两格）⇒ **一个"只读查询"扰动门计时器**。另外它还是**方法**，
直接插值会把函数源码打出来（实测就这么看到的）。

**修法**：只报**可读字段**（`gateWaitMs`/`gateWaitStart`/`sceneFreeze`/`scenePending`），
由读者自己判断门状态。

### ★我的守卫有过一个真缺口（已补 + 已用突变证明）

首版"纯只读"守卫只快照 `globals`/`locals`/`cur`/`ip`/`texSlots` ⇒ **漏掉门计时器这一类**。
补强后把 `gateWaitMs`/`gateWaitStart`/`sceneFreeze`/`scenePending`/`waitFlags`/`effectFlags`/`engineValues`
一并纳入，并**造一个"计时器在途"的态**（`gateWaitMs = 1234`）逼出惰性写。

**突变证明**（这次做对了）：把 `engine.gatePending(Date.now())` 放回去 ⇒ 该用例**红**；还原 ⇒ 绿。
★第一次突变我写成 `gatePending(0)`，**没能复现**（`gateWaitStart = 0` 本来就是 0）——
**用真实时钟才复现**。这条本身值得记：突变必须构造成**真的能触发副作用**的形态，否则"突变通过"是假绿。

### 环境踩坑（写进代码注释）

- 本环境 Chromium 沙箱初始化失败（`Operation not permitted`）⇒ GPU/网络子进程连环崩、app 被打死。
  守护脚本显式 `no-sandbox`（**仅绑回环 + 只读查询 + 白名单断点**，不执行任意代码，故可接受）。
- 三个"前台/节流"开关照抄 `shot.cjs`（否则窗口不在前台 ⇒ rAF 降频 ⇒ 启动链走不完）。
- 不能另打一份 `windows.cjs`：`windows` 是**单例**，副本会拿到另一个实例（`windows.game` 为 null）⇒
  必须从 `main.cjs` 的**导出**取。

### 实测记录

```
[dbgsrv] listening on 127.0.0.1:39427（game ready）
$ node tools/dbg.cjs --ping     → pong / game=true
$ node tools/dbg.cjs global 0   → global 0x0 = 0 (0x0) ← **未写过**
$ node tools/dbg.cjs run        → cur=1 帧数=40 / 当前帧 TITLE.BIN ip=52 / 门：gateWaitMs=0 … / playSeconds=17.87
```

---

## 第 8 次变更（2026-09-23）—— **实机全面测试**（用户：「测试 T-0114 引入的远程调试能力」）+ 三处补强

本轮是**第一次真机、端到端**地用这套能力去查一个真实现象（`tickets/T-0102` 的白底），
结果：**能力本身可用**，但暴露了 1 个真缺陷、2 个能力缺口。三处都已修，并留下守卫。

### 测了什么（逐项实测，不是"应该能行"）

| 项 | 命令 | 结果 |
|---|---|---|
| 守护进程起来 + 音频 | `electron tools/debugsrv.cjs` | `[dbgsrv] listening on 127.0.0.1:39427`，主进程日志 `emulator options env override -> audio.enabled=false`（**静音生效**） |
| 连通性 | `dbg --ping` | `pong / game=true` |
| 只读查询 | `global 0` / `local 0` / `frame` / `frame 1` / `flocal` / `slot 0x11` / `run` / `?` | 全部返回；`global` 给「解码后 + 原始编码值」，未写过显式标注（T-0102 要的正是这个） |
| 错误路径 | `dbg 'nosuchcmd 1 2'` | `✗ 未知查询` + 用法，退出码 1 |
| JSONL | `dbg --json global 0` | 含 `hello` / 结果 / `status` 推送三行 |
| **条件断点** | `dbg 'b'`（无条件 = 每条都停） | ⏸ `TITLE.BIN@ip=52`，命中计数 1 |
| **暂停中查询** | 暂停态下跑 `run` / `global 0` | **照常返回**（证明「暂停 = await Promise 门」没有阻塞 IPC —— 第 4 次变更那条硬约束真的成立） |
| **继续 / 删除** | `dbg c` / `dbg d 1` / `dbg bl` | 继续后又在同一条断点再停（无条件断点语义正确）；删除后断点表为空 |
| **事件断点** | `dbg 'b event global-int-write idx == 0'` | TITLE 处不命中（该处确实不写 `global 0`）；推进到 SN0000 结尾/SCJUMP 时**连中两次**（`val=2` / `val=1`）——本次 T-0102 取证的核心手段 |

### ★缺陷 1（已修）：非法事件类型被**静默**注册成"永远不命中的死断点"

```
$ node tools/dbg.cjs 'b event bogus-kind idx == 0'
断点 2 条：
  #3 事件断点(bogus-kind) idx == 0  命中 0      ← 报错在哪？
```

**真因**：校验只在 `debugBreak.parseDebugCommand` 里（面板那条路），而调试守护进程 `debugsrv.cjs`
是**手工分流**的（只认 `b event` 前缀、不做校验）⇒ CLI 那条路绕过了校验；渲染窗 `session.#addBreak`
→ `compileBreak` 也**不校验 `where`**。而 `matchEvent` 用 `s.where !== where` 当唯一匹配键
⇒ 写错一个字母的后果是"断点进了表、命中数永远 0"——**不报错、只是没用**，比报错难查得多。

**修法**：校验放到**面板与 CLI 的共同收口点** `compileBreak`（`src/vm/debugBreak.ts`），
非法类型抛面向用户的 `ConditionError`（消息列出合法清单）。守卫：`test/debug-break.test.ts`
新增「`compileBreak` 必须校验事件类型（CLI 绕过解析器）」一例。

### ★缺口 2（已补）：只能"看"，不能"驱动" ⇒ 现象照样要人坐在窗口前点

T-0102 要查的态（`SN0000 → SC0000` 切章后的 ADV 窗）**必须点进去**才能到达；只有查询 + 断点的话，
仍然是"我能不能请你点一下"。⇒ 给守护进程加了**输入驱动**（**只在主进程侧**，
`webContents.sendInputEvent`，与 `tools/shot.cjs` 同一手法 ⇒ **不用重编渲染窗**）：

```
click <x> <y>              点一下（输入坐标 = shot.cjs 里 CONFIG_XY 那一套）
clickn <x> <y> [n] [gap]   连点 n 下（ADV 一页一次点击时用）
clickimg <x> <y>           点一下，但坐标是**截图图像坐标**
move <x> <y>               只移动光标（悬停门控）
shot [名字]                远程截图 → <仓库根>/.tmp/dbg-<名字>.png（并报出内容区尺寸）
```

★**坐标口径的教训**（写进文件头）：`sendInputEvent` 收**内容区 CSS 像素**，`capturePage()` 给**图像像素**，
两者差一个缩放（本机实测截图 1604×903、内容区 1283×722 ⇒ ×0.8）。
`shot.cjs` 那份 `toSend = (x+28.4)/0.955` 是**另一台机器/另一个窗口尺寸**标出来的，本机**对不上**
⇒ `clickimg` 改成**按当前几何现算**（`getContentSize()` / `capturePage().getSize()`）。

**实测走通**（本次 T-0102 取证就是靠它）：
`click 1070 480`（TITLE→Load Data）→ `clickimg 677 181`（选存档 071）→ `clickimg 190 865`（LOAD）
→ `clickimg 802 400`（确认「是」）→ 载入成功（帧栈 `SYSTEM4 → NOVEL → SN0000`）
→ 连点推进 → 事件断点两次命中（见 T-0102 的取证文件）。
★顺带一条**坑**：存档列表里点**空槽**不会有任何反应（不是工具的问题）—— 第一次以为是坐标错，
换到有数据的槽就通了；截图（`shot`）是分辨这两件事的唯一手段。

### ★缺口 3（已补）：调试会话**默认静音**

`debugsrv.cjs` 在 require 主进程**之前**把 `AMAYUI_AUDIO_ENABLED` 兜底成 `'0'`
（引擎侧正式开关：宿主不出声、引擎语义照跑）。理由：调试会话是"无人值守跑几分钟"的形态，
出声只带来设备/自动播放策略/时间抖动这些与被测逻辑无关的噪声。
显式传 `AMAYUI_AUDIO_ENABLED=1`（或本脚本的 `AMAYUI_DEBUG_AUDIO=1`）可恢复。

### 诚实边界（仍然没做的）

- `slot` 查询**仍只读 VM 台账**（`texSlots`/`texSizes`），**宿主侧"纹理是否已就位"没纳入**
  （输出里已显式写明这一点，见 `debugQuery.ts`）。
- 输入驱动**只做了鼠标**（`click`/`move`）；键盘没做 —— `shot.cjs` 移除 `--key` 的教训还在
  （"那个键会看起来一直被按着"），要做需先弄清 `sendInputEvent` 的键盘语义。
- `clickn` **每次都要重启守护**才生效（.cjs 是启动时加载的）——本次为了不丢已载入的存档，
  改用调用方侧循环连点；这条限制本身值得记。
- 本轮**没有**跑"远程改值"（热改全局量）：按定义它是写路径，须另开通道并单独设计（原提案 §3 的后续步）。
