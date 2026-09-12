---
name: amayui-engine-analysis
description: 数据驱动的引擎反编译分析：读懂并归类《天結いキャッスルマイスター》的 Hex-Rays 反编译（engine/天结_unpacked.exe_utf8.c，约 18 万行），把分析结论沉淀为稳定、工具无关的**三层数据层**——第一层 analysis/functions.json + analysis/fields.json（函数/字段「是什么」），第二层 analysis/engine-capabilities.json（引擎的**常态能力**：逐帧流程/门控标志/惰性创建/转场/资源生命周期，枚举 opcode 看不出来、缺失时不报错只表现不对），第三层 analysis/scripts.json（**脚本台账**：src/*.txt 里每个被分析过的游戏脚本是什么、谁调它、内部结构与关键槽、不变量/坑/缺口，带行区间锚点棘轮）。用 scripts/report.js 与 scripts/capabilities.js、scripts/scripts.js 查询增删改，scripts/sort-fields.js 排序，scripts/build-capabilities.mjs 与 scripts/build-scripts.mjs 渲染人可读台账。当用户要求分析某条指令/函数逻辑、检查某字段偏移的引用、盘点某个子系统的功能面（需要哪些持续行为）、登记/更新某个游戏脚本（src/*.txt）的结构、或把反编译结论写入数据层时使用。
---

# amayui-engine-analysis — 数据驱动的引擎反编译分析（三层数据层：函数/字段 + 常态能力 + 脚本台账）

> 定位：读懂并归类《天結いキャッスルマイスター》引擎的 Hex-Rays 反编译（`engine/天结_unpacked.exe_utf8.c`，约 18 万行），
> 把分析结论沉淀为**稳定、可增长、工具无关的数据**，而不是会漂移的手工镜像/文本改写。
> **核心思想：分析只回答「这个函数/字段是什么」「引擎有哪些持续行为」「这个脚本长什么样」；结论存进数据层（唯一会增长的地方）；渲染层可从数据随时再生成。**
>
> **三层数据层**（分层的理由：这是三类根本不同的东西，混在一起必然漏掉后两类）：
>
> | 层 | 文件 | 回答的问题 | 怎么发现 |
> |---|---|---|---|
> | 一 | `analysis/functions.json` + `fields.json` | 这个 `sub_XXXXXX` / 偏移**是什么** | 顺着 opcode 表 / 字段引用**枚举**就能找到 |
> | 二 | `analysis/engine-capabilities.json` | 引擎有哪些**持续行为**（逐帧流程 / 门控标志 / 惰性创建 / 转场 / 资源生命周期） | **枚举不出来** —— 它们不是任何一条 opcode，而是"引擎自己在后台一直做的事" |
> | 三 | `analysis/scripts.json` | **这个游戏脚本**（`src/*.txt`）长什么样：谁调它、内部结构（label + 行区间）、关键槽、不变量、坑、缺口 | 只有**真的去读那个脚本**才知道；反编译里没有它的结构 |
>
> 第二层的存在理由（教训）：版权页文字不淡入，查了很久才发现缺的是**逐帧颜色插值** —— 那不是一个没实现的 opcode，
> 而是引擎帧循环里的一段常态行为。这类缺失**不报错、只表现不对**，所以必须有可核对清单。
>
> 第三层的存在理由（教训）：设置界面「可见项表是 36df/179f/273f 三个数组、靠 `i12f` 排序、切分类 = 退出后重入、
> 帧局部池必须在装载时重建」—— 这些既不是函数语义也不是引擎常态行为，以前只活在代码注释和主题文档里，
> 于是同一个界面被反复重读了几千行反汇编。脚本结构必须**按脚本**落库，而且要用「行区间 + 锚点」把自己钉在真源上。
>
> 本技能不做逐字节等价复刻（那是 decomp.me 匹配式复刻的目标）；目标是把巨大的 `sub_XXXXXX` 读懂 + 归类，把脚本读懂 + 记账。

---

## 0. 为什么用「数据驱动」而不是「维护精仿源码 / 改写文本」
在先前的实践中踩过三类坑，本方案就是为了规避它们：
1. **手工镜像 .cpp 会漂移**：行号对齐、空行回填、跨文件改名 —— 维护成本高。
2. **libclang / AST 改写反编译文本**：Hex-Rays 输出脏、模式多，需要大量脆弱的识别代码 —— 已实测不稳定，**弃用**。
3. **依赖反编译器渲染不划算**：要让字段自动传播进反编译输出，得靠特定工具的 GUI/付费或手动，且 headless 批量会因 auto-param/重分析把手工类型打回 —— 不采用。
4. 结论：**把「应用/渲染」和「存储/结论」分开**。存储是数据（稳）；渲染只需「报表」（读数据）——**永不自己解析改写文本，也不依赖特定反编译器**。

---

## 1. 目录 / 输入 / 工具
```
engine/天结_unpacked.exe_utf8.c        # 只读反编译基准（唯一信息源；不修改）
src/*.txt                              # 游戏脚本（反汇编 + 汉化正文；941 个）—— 第三层的对象
analysis/fields.json                   # 数据层·第一层：字段/偏移模型（唯一会增长）
analysis/functions.json                # 数据层·第一层：函数结论（用途/状态/签名覆盖）
analysis/engine-capabilities.json      # 数据层·第二层：常态能力台账（持续行为 + emulator 现状判定）
analysis/scripts.json                  # 数据层·第三层：脚本台账（每个读过的 src/*.txt 的结构/槽/不变量/缺口）
docs-new/03-engine/engine-capabilities.md  # 第二层的人可读渲染产物（由 scripts/build-capabilities.mjs 生成，勿手改）
docs-new/05-scripts/README.md          # 第三层的人可读渲染产物（索引 + 覆盖率；由 scripts/build-scripts.mjs 生成，勿手改）
docs-new/05-scripts/<ID>.md            # 第三层：每个脚本一页（同上，生成物）
```

工具（`<skill>/scripts/` 下；`build-*.mjs` 在**仓库根** `scripts/` 下）：

| 工具 | 作用 |
|---|---|
| `scripts/report.js` | 第一层：查询 + 增删改（`--summary/--index/--find/--addr/--op/--field`、`--func-add/edit/rm`、`--field-add/edit/rm`） |
| `scripts/sort-fields.js` | 第一层：`fields.json` 按 scope+偏移重排 |
| `scripts/capabilities.js` | **第二层：查询 + 增删改 + 离线自检**（`--summary/--index/--attention/--find/--id/--validate`、`--add/edit/rm`） |
| `scripts/scripts.js` | **第三层：查询 + 增删改 + 离线自检**（`--summary/--index/--coverage/--find/--id/--validate`、`--add/edit/rm`） |
| `../../scripts/build-capabilities.mjs` | **第二层：把台账渲染成 md**（改完 JSON 必须重跑，否则守卫测试会因 md 不同步而失败） |
| `../../scripts/build-scripts.mjs` | **第三层：把脚本台账渲染成 md**（同上，生成 `docs-new/05-scripts/`） |

- 原始 dump 目录只读；分析结论一律在 `analysis/*.json`，**不在反编译源码里写注释**。
- 反编译源码是**输入/视图**；数据层是**事实来源**。
- **emulator（`app/amayui-emulator/…`）是产物，不是信息源**：分析时**禁止读取/参考**任何 emulator 内容；分析结果**后续**用以实现/更新 emulator（方向：**分析 → emulator**，绝不复用）。

---

## 2. 数据层 schema

### 2.1 `analysis/fields.json` —— 字段/偏移模型
数组，每条（offset 为**字节偏移**，16 进制，同 `engine/engine.hpp` 约定）：
```jsonc
{
  "offset": "0x5D880",      // 字节偏移（相对 Engine 对象 / 全局基址）
  "type": "uint32_t",        // 字段类型（uaddr=uint32 存地址；uint32_t；指针）
  "name": "cur_script",      // 语义名（C++ 风格）
  "scope": "Engine",         // 所属对象：Engine / ScriptContext / engine(全局) / frames[cur]
  "meaning": "当前脚本帧深度 (this[95776])",
  "stride": "0x78",          // 可选：若是数组，步长（如 frames[cur] 每帧 0x78=120）
  "evidence": "members.cpp 原 383104；loadScriptFrame_40ED40 用法",
  "status": "confirmed"      // confirmed | tentative
}
```
约定：**偏移一律字节偏移**；`_this[K]`×4=字节；`_this + N` 已是字节。**凡标 `tentative` 的需后续复核。**

### 2.2 `analysis/functions.json` —— 函数结论
对象（以 addr 或语义名为键），每条：
```jsonc
{
  "addr": "0x40ED40",
  "raw_name": "sub_40ED40",                           // 原始 _utf8.c 里的名称（唯一操作名）
  "semantic_name": "loadScriptFrame_40ED40",         // 我们赋的语义名（非原始；原始名是 raw_name）
  "op": "0x6",                                   // 若是 opcode handler，记 opcode；否则略
  "status": "PARTIAL",                           // ANALYZED | PARTIAL | STUB | UNKNOWN
  "purpose": "构造并装载一个脚本帧（读脚本文件→解码→建帧局部池）",
  "signature_override": { "param0": "this(Engine*)" },  // 人工矫正：首参是 this，不是 int
  "sub_behaviors": ["打开脚本文件", "校验版本", "建局部池", "填 local_int=enc_zero"],
  "fields_used": ["frames[cur].local_int", "frames[cur].local_int_count", "this->enc_zero", "this->cur_script"],
  "unmodeled": ["_this+680092(字符串表)", "_this+383188 等返回栈"],  // PARTIAL 原因
  "evidence": "raw 18577-18874",
  "notes": "首参被自动处理成 int a1，实为 this；需人工矫正"
}
```

### 2.3 `analysis/engine-capabilities.json` —— **常态能力台账（第二层）**

回答「引擎有哪些**持续行为**」。对象（顶层 `_doc` / `statusEnum` / `evidenceEnum` / `generatedFrom` / `counts` / `entries`）：

```jsonc
{
  "id": "adv-flag-lifecycle",            // kebab-case，全局唯一
  "subsystem": "消息窗",                  // 渲染/3D/帧循环/声音/资源/转场/输入/消息窗/Live2D
  "name": "ADV 激活位（effect_flags 0x8000000）的设置与清除",
  "trigger": "何时发生（含"门不开就不发生"的条件）",
  "engine": { "fns": ["sub_41ED80", "sub_41EEF0"], "raw": "28419-28543" },
  "reads": ["Engine+699204", "Engine+122455"],   // 读/写的字段（可空）
  "whySilent": "★缺失时为什么**不报错、只表现不对**（没有它这条就不该进台账）",
  "confidence": "confirmed",              // confirmed | tentative
  "emulator": {
    "status": "partial",                  // 见 statusEnum
    "evidence": "E1",                     // 见 evidenceEnum（E0–E4）
    "guard": "test/xxx.test.ts",          // 声称 E2/E3 时**必须**给，且文件真实存在
    "note": "本工程现状 + 缺口；n/a-known 必须在开头写 `why:`"
  }
}
```

**status 枚举**（`emulator.status`，写进 JSON 的 `statusEnum`）：

| 值 | 含义 |
|---|---|
| `modeled-verified` | 已建模且有守卫（E2/E3） |
| `modeled-unverified` | 已建模但只有静态结论（E1）或缺少守卫 |
| `partial` | 只实现了一部分（缺口写在该条 `note`） |
| `absent` | 引擎有、emulator 完全没有 |
| `n/a-known` | 与本重写范围无关（**必须写 `why:`**） |

**evidence 等级**（`emulator.evidence`）：`E0` 未读体 / `E1` 已读体（静态 + raw 行号） / `E2` 合成指令单测 / `E3` 真实脚本的场景级断言（快照/不变量） / `E4` 与真机对照（截图或状态 dump）。

**三条硬约束**（`test/capability-ledger.test.ts` 会强制，`capabilities.js --validate` 可离线自检）：
1. 声称 **E2/E3 就必须给 `guard`**，且该测试文件真实存在（防止"声称有守卫"变成空话）；
2. `n/a-known` **必须**在 `note` 里写 `why:`（**不许用 n/a 掩盖缺口**）；
3. 每条都要有 `whySilent`（"缺失时为什么静默" —— 这是台账存在的理由本身）。

> `counts` 由工具自动重算，**不要手改**；改完 JSON 必须 `node scripts/build-capabilities.mjs` 重生成 md，
> 否则守卫测试的"md 与数据层同步"一项会失败。

### 2.4 `analysis/scripts.json` —— **脚本台账（第三层）**

回答「**这个游戏脚本长什么样、怎么跑通**」。对象（顶层 `_doc` / `statusEnum` / `generatedFrom` / `counts` / `entries`），
每个被分析过的 `src/*.txt` 一条：

```jsonc
{
  "id": "CONFIG1",                       // 短名（= md 文件名），唯一
  "file": "src/CONFIG1.txt",             // 真源（校验存在）
  "bin": "CONFIG1.BIN",                  // 运行期名字（统一文件 id 空间里的那个）
  "role": "这个脚本是什么（一句话）",
  "entry": "谁调它 / 怎么进怎么出（退出重入、由父脚本重新 call-script 等）",
  "layout": [                            // ★读过哪些段 —— 一行区间 + 一锚点 + 一职责
    { "anchor": "label_00004a78", "lines": "1136-1174", "what": "重建当前分类的可见项表：36df[count] = (type<<16)|value" }
  ],
  "slots": [ { "key": "local 5620", "what": "滚动起点（首个可见项下标）" } ],   // 关键槽/局部量/全局
  "invariants": ["0 ≤ local5620 ≤ local5624"],   // 拿它做回归断言
  "gotchas":    ["切分类 = 退出 + 重入 ⇒ 帧局部池必须重建"],   // 踩过的坑
  "gaps":       ["0x205（GDI 数字绘制）未实现"],   // 已知缺口（没有就 []）
  "links": {                             // 回链到另外两层 + 主题文档（校验不许悬空）
    "capabilities": ["script-frame-local-pool-lifecycle"],
    "functions": ["0x42F560", "0x422FD0"],
    "docs": ["docs-new/03-engine/opcode-table.md"]
  },
  "guards": ["test/config1-chain.test.ts"],   // 覆盖本脚本的测试（校验存在）
  "status": "analyzed",                  // analyzed | partial | stub
  "evidence": "src/CONFIG1.txt 的区间见 layout；运行期断言见 test/config1-chain.test.ts 的 sort12f/configRows/scrollThumb/slotText",
  "notes": "未读：左列重绘 label_000050f0 的细节、底部按钮的配置回写路径。"
}
```

**status 枚举**（写进 JSON 的 `statusEnum`）：

| 值 | 含义 |
|---|---|
| `analyzed` | 结构 + 关键路径都读过并落库（未读到的部分写在 `notes`） |
| `partial` | 只读了用到的部分（`layout` 里逐条列出的**就是**读过的范围） |
| `stub` | 只登记「它是谁 / 谁调它」，正文未读 |

**四条硬约束**（`app/amayui-emulator/test/script-ledger.test.ts` 会强制，`scripts.js --validate` 可离线自检）：
1. ★**锚点棘轮**：每条 `layout[].anchor` 必须**真的出现在它声明的 `lines` 区间内**（锚点 ≥6 字符，用 label 名或该行真实存在的 opcode 串）——
   既防"凭印象编造结构"，也让 `src/*.txt` 一旦被反汇编重排/翻译 reflow **必然变红**，逼人刷新行号；
2. `guards[]` 指向的测试文件真实存在；`links.capabilities[]` 是第二层里真有的 id、`links.functions[]` 是 `functions.json` 里真有的 addr；
3. 一个脚本只登记**一条**（`file` 不重复）；`status` 与 `layout` 的规模要相称（没读过就别写 `analyzed`）；
4. `gaps` 或 `notes` 至少有一个说话 —— 未读到的部分必须写出来（**不许用沉默掩盖缺口**，与第二层的 `why:` 同一条纪律）。

> **覆盖率是提醒，不是 KPI**：分母是磁盘上真实的 `src/*.txt` 数量（941）。**没读过的脚本不要建条目**（宁可空着），
> 读了一部分就写 `partial` 并只列真正读过的区间。`scripts.js --coverage` 会把未登记项列出来提醒还有哪些没看；
> 生成器与守卫用的是同一个口径（`src/*.txt` 计数），所以"加了脚本忘了重生成 md"会被守卫抓住。
>
> `counts` 由工具自动重算，**不要手改**；改完 JSON 必须 `node scripts/build-scripts.mjs` 重生成 `docs-new/05-scripts/`，
> 否则守卫测试的"md 与数据层同步"一项会失败。

**三层不许互相复制**（分层的意义就在这里）：

| 结论 | 只写在哪 |
|---|---|
| 某个 `sub_XXXXXX` / 偏移是什么 | 第一层 |
| 引擎持续行为（逐帧/门控/生命周期） | 第二层 |
| **某个脚本**的结构、槽、不变量、坑、缺口 | 第三层 |
| 跨脚本的叙述（某个子系统的整体机制、opcode 语义表） | 主题文档 `docs-new/03-engine/*.md` —— 第三层只**回链**，不抄 |

### 2.5 严格状态判定（写进 functions.json 的 status）
- **ANALYZED**：读了 handler 体确证，且体内**无未建模数值偏移**（`_this[K]`/`_this+N` 已映射成语义字段）、**无未分析被调**。
- **PARTIAL**：已读体，但仍有未建模偏移或未分析被调（在 `unmodeled` 里写明）。
- **STUB**：桩/simplified（no-op / 安全桩）。
- **UNKNOWN**：未读/无表征（缺省）。

---

## 3. 分析流程

### 3.0 先分层：这条结论该进第一层、第二层还是第三层？
分析任何东西之前先问一句：**我要回答的是"它是什么"，"引擎一直在做什么"，还是"这个脚本长什么样"？**

| 情形 | 去向 |
|---|---|
| 一个 `sub_XXXXXX` 的语义 / 一条 opcode 的 handler / 一个偏移的归属 | 第一层（`functions.json` / `fields.json`） |
| 一个**子系统需要哪些持续行为**才能工作；某个标志的**生命周期**；某个每帧步骤；某个惰性创建/转场/资源老化 | 第二层（`engine-capabilities.json`） |
| **读某个 `src/*.txt` 时的结构发现**：谁 call 它、label 分区、可见项表/滚动/槽号、不变量、坑、还差什么 | 第三层（`scripts.json`） |
| 一个子系统（如消息窗）的**功能面盘点** | **三层都要写**：逐 opcode 的 handler 结论进第一层；它依赖的持续行为进第二层；用到它的脚本（`SYSTEM4`/`SN0000`…）结构进第三层 |

判定口诀：**"如果把所有 opcode 都实现对了，这个行为还会不会缺？"** 会缺 ⇒ 它属于第二层。
**"换一个脚本，这条结论还成立吗？"** 不成立（是那个脚本自己的表/槽/流程）⇒ 它属于第三层。

### 3.1 每次分析一个函数
1. **定位**：从 `docs-new/03-engine/opcode-table.md` 或 func-list 里定位 `sub_XXXXXX`。
2. **先查 `fields.json`**：把函数体内的偏移**按表解码**（`0x5d880→cur_script`、`0x78 步长→帧下标`、`0x5d8b4→local_int`）。表里没有的偏移，先标 `tentative`，分析确证后再改 `confirmed`。
3. **读 raw handler 体**，理解语义（子行为：它先做什么、分支、调用什么）。
4. **只依据 raw 读体**：分析只用 `engine/…_utf8.c` 直接读出的内容。**不读取/参考 emulator**（它是产物，由分析结果实现，方向相反）。
5. **写回数据**（**只在一处增长**）：
   - 新增/复核字段 → `fields.json`（带 `evidence` + `status`）。
   - 函数结论 → `functions.json`（`purpose`/`status`/`signature_override`/`sub_behaviors`/`unmodeled`/`evidence`）。
   - 若发现的是**持续行为 / 标志生命周期 / 每帧步骤** → 按 §2.3 追加一条 `engine-capabilities.json` 条目
     （用 `capabilities.js --add`），并给出 `whySilent` 与 `emulator` 判定。
   - 若是在**某个脚本里**看到的用法（真实用例、惯用法）→ 把它记到那个脚本的第三层条目（`layout`/`gotchas`/`links`），
     别把它塞进函数条目里。
6. **渲染 + 自检**：
   - 第一层无需渲染；
   - 第二层改完必须 `node scripts/build-capabilities.mjs`，再 `capabilities.js --validate`；
   - 第三层改完必须 `node scripts/build-scripts.mjs`，再 `scripts.js --validate`；
   - 收尾跑一次 `npx tsx --test test/capability-ledger.test.ts test/script-ledger.test.ts`（在 `app/amayui-emulator` 下）。

### 3.2 每次分析一个脚本（`src/*.txt`）—— 第三层的流程
触发场景：要弄清某个界面流程 / 演出 / 消息脚本的行为，或为重现某个现象而读脚本时。

1. **先查台账**：`node .agents/skills/amayui-engine-analysis/scripts/scripts.js --id <ID>`。
   - 有 `analyzed` 条目 ⇒ **别再从头读**，按它的 `layout` 直接跳段；
   - 有 `partial` 条目 ⇒ 看 `notes` 写的"未读"是什么，只补那部分；
   - 没有 ⇒ `--add` 一个骨架，`status` 先写 `partial`（或 `stub`），`role`/`entry` 先写一句话，**别留空**。
2. **边读边记 `layout`**：每读一段就补一条 `{lines, anchor, what}`。锚点用**该段里真实存在的字符串**：
   `label_XXXX` / `i12f (local-int 7ff)` / `show-text 0 @"…"` 这种；**行区间写你实际看过的**，不要图省事写整个文件。
3. **记 `slots`**：这个脚本自己用的槽号 / 局部量 / 全局（`local 5620`、`win 9`、`global 12721e`…）与含义 ——
   下次读同一脚本时，槽名比槽号好记，而这正是重读成本的来源。
4. **把断言写成 `invariants`**（不变量 = 回归测试的素材），**把踩过的坑写成 `gotchas`**（尤其"看起来对其实错"的那种）。
5. **回链**：`links.capabilities`（第二层 id）/ `links.functions`（第一层 addr）/ `links.docs`（主题文档）；
   `guards` 填覆盖它的测试（新写一个更好）。**引擎层面的结论不要写进本层**，写进第一/第二层再来回链。
6. **收尾**：
   ```bash
   node scripts/build-scripts.mjs                    # 重生成 docs-new/05-scripts/（勿手改 md）
   node .agents/skills/amayui-engine-analysis/scripts/scripts.js --validate
   cd app/amayui-emulator && npx tsx --test test/script-ledger.test.ts
   ```
7. **看缺口**：`scripts.js --coverage` 列出还没登记的脚本（提醒，不是待办 KPI）；`scripts.js --summary` 看状态分布。
   **不要把没读过的脚本登记成 `analyzed`** —— 守卫会拿 `layout` 的锚点去核对真源，编不过去。

---

## 4. 数据层工具（查询 + 增删改；不改写反编译文本）
只做**纯数据读写**（`analysis/fields.json` + `functions.json` + `engine-capabilities.json` + `scripts.json`）：哪些函数分析了 / 状态分布 / 字段清单 / 每函数用途与未解项 / 引擎有哪些持续行为 / 哪些脚本读过，并可**新增 / 修改 / 删除**记录。
**永不改写反编译文本，也不依赖任何反编译器/特定工具；结论只写入数据层（唯一增长处）。**

### `scripts/report.js` —— 查询 + 增删改（读写合一）
- **查询（只读）**：
  - `node report.js --summary`：只打统计（字段/函数数、状态/作用域/opcode 分布）。
  - `node report.js --index [--sort addr|op|status|sem] [--group status|op]`：紧凑函数索引（一行一条，便于快速扫）。
  - `node report.js --find <子串>`：按 addr/raw_name/semantic_name/op/purpose 模糊查。
  - `node report.js --addr <0x..> | --op <0x..>`：精查单个函数（附 purpose）。
  - `node report.js --field`：字段清单；`node report.js`（无参）= 完整报表（向后兼容）。
- **写入（增删改）**：
  - `node report.js --func-add  '<json>'`：新增函数（json 或 `k=v …`；需 `addr`）。
  - `node report.js --func-edit <addr> --set k=v [--set …]`：改某函数字段（外科手术式单块编辑，**不翻新其它条目**）。
  - `node report.js --func-rm   <addr>`：删某函数。
  - `node report.js --field-add '<json>' | --field-edit <键> --set k=v … | --field-rm <键>`：字段增删改（写后按 scope+offset 重排，保留分组空行）。
    **键 = `scope + offset`**：不同 scope 可以有相同字节偏移（`Engine`/`Font`/`FontVWindow`/`ScriptContext`/`DrawItem` 各自从对象头起算），
    所以定位键写成 `DrawItem/0x3C`、`FontVWindow/0x15150` 即可并存；裸 `0x3C` 命中多条时会报错并列出候选（旧行为是静默取第一条）。
- **root**：缺省 `.`；可用 `--root <dir>` 或第一个位置参数指定（例如对临时副本操作可 `--root /tmp/rj`）。
- `--set` 的无引号值按布尔/数字自动解析，其余为字符串；数组/对象值请用 json 形式。

### `scripts/sort-fields.js`
字段排序器：按 `scope` + 字节偏移排 `fields.json`，作用域间留空行分组（`report.js --field-add/edit/rm` 内部会复用同格式，故无需另跑）。

### `scripts/capabilities.js` —— 第二层台账（查询 + 增删改 + 自检）
- **查询**：`--summary`（状态/证据/子系统分布）· `--index [--subsystem X] [--status S] [--evidence E]` ·
  `--attention`（只看"需要关注"：非 n/a 且非已核验）· `--find <子串>` · `--id <id>`（精查单条）· `--validate`（离线自检）。
- **写入**：`--add '<json>'` · `--edit <id> --set k=v [--set …]` · `--rm <id>`。
  `--set` 支持**点路径**：`emulator.status=partial`、`engine.raw=28419-28543`、`engine.fns=a,b`、`reads=Engine+699204,Engine+122455`。
  写入后自动重算 `counts`。
- **渲染**（仓库根）：`node scripts/build-capabilities.mjs` → `docs-new/03-engine/engine-capabilities.md`（**勿手改 md**）。
- **收尾必跑**：`cd app/amayui-emulator && npx tsx --test test/capability-ledger.test.ts`。

### `scripts/scripts.js` —— 第三层台账：脚本台账（查询 + 增删改 + 自检）
- **查询**：`--summary`（状态分布 + 覆盖率）· `--index [--status analyzed|partial|stub]` ·
  `--coverage`（列出**尚未登记**的 `src/*.txt` —— 提醒还有哪些没看）· `--find <子串>` · `--id <ID>`（精查单条，含 layout/slots 明细）· `--validate`（离线自检）。
- **写入**：`--add '<json>'` · `--edit <ID> --set k=v [--set …]`（支持点路径，如 `status=analyzed`）· `--rm <ID>`。写入后自动重算 `counts`。
- **`--set` 的坑**：`layout`/`slots` 是**结构化数组**，不要用 `--set` 硬塞（值里的 ASCII 逗号会被当分隔符、ASCII 引号会破坏 JSON）；
  整段结构改用 `--add '<整条 json>'`，或直接编辑 `analysis/scripts.json`（然后 `--validate` 把关）。
- **渲染**（仓库根）：`node scripts/build-scripts.mjs` → `docs-new/05-scripts/README.md` + `<ID>.md`（**勿手改 md**；
  生成器会顺带删掉已不在数据层里的旧页面）。
- **收尾必跑**：`cd app/amayui-emulator && npx tsx --test test/script-ledger.test.ts`。

### 建议的读取姿势（AI/人）
数据层是**存储**，直接读原始 JSON 冗长。
- 第一层：先 `report.js --index --sort addr` 导航，`--find/--addr/--op` 精查，`--summary` 看进度；新增/修改用 `--func-add/--func-edit`。
- 第二层：先 `capabilities.js --attention` 看缺口，`--subsystem 消息窗` 收窄到某个子系统，`--id` 精查；
  新增/修改用 `--add/--edit`，改完 `build-capabilities.mjs` + `--validate`。
- 第三层：先 `scripts.js --index` 看读过哪些脚本，`--id CONFIG1` 精查某个脚本的结构与坑；
  **动手读某个 `src/*.txt` 之前先 `--id`** —— 已读过就别重读。改完 `build-scripts.mjs` + `--validate`。
- **盘点某个子系统的功能面**时：三层一起看 —— `report.js --find <子系统名>` 找相关 handler，
  `capabilities.js --subsystem <子系统>` 找相关持续行为，`scripts.js --find <子系统名>` 找用到它的脚本。

---

## 5. 硬性约定
- **原始 `engine/…_utf8.c` 只读**；结论只在 `analysis/*.json`（三层）。
- **常态能力不得只在脑子里**：任何"引擎每帧/持续做某事"的发现，必须落成 `engine-capabilities.json` 条目，
  并写清 `whySilent` —— 否则下次遇到症状又要从零研究（这正是第二层存在的理由）。
- **脚本结构不得只在脑子里**：任何"这个脚本的表/槽/流程是……"的发现，必须落成 `scripts.json` 条目，
  并写清 `layout`（行区间 + 锚点）—— 否则下次为了同一个界面又要把同一个脚本重读一遍（这正是第三层存在的理由）。
- **锚点必须经得起核对**：`layout[].anchor` 要真实出现在声明的行区间里；行区间只写**实际读过**的范围。
  `src/*.txt` 重排（翻译 reflow）后守卫会红，**这是刻意的棘轮**，照失败信息更新行号即可。
- **覆盖率不是 KPI**：`scripts.js --coverage` 只是提醒；**没读过的脚本不要登记**，读一半就写 `partial`。
- **不许用 `n/a-known` 掩盖缺口**：必须写 `why:`，且 `capabilities.js --validate` / 守卫测试会拒收。
  （第三层的对应纪律：`gaps` 或 `notes` 必须说话，`status` 不许虚高。）
- **不许空口声称守卫**：`evidence` 写 E2/E3 就必须给出真实存在的 `guard` 测试文件。
- **md 是产物**：`docs-new/03-engine/engine-capabilities.md`（`build-capabilities.mjs`）与
  `docs-new/05-scripts/*.md`（`build-scripts.mjs`）都是生成物，**勿手改**。
- **不写镜像 / 不写 libclang/AST 文本改写**；渲染只做纯数据报表，不依赖任何反编译器/特定工具。
- **结论带证据**：`evidence` 以 raw 行区间（第一/二层）或 `src/*.txt` 行区间（第三层）为主。
- **AGE 助记符不可靠**（`exit`≠程序退出、`ret`≠跨脚本返回），以**读反编译体为准**；**严禁读取/参考 emulator**（产物，非信息源）；凡 `推测`/未读体一律标 `partial`。
- **增长只在一处**（数据层）；渲染层可随时重生成。
- 不做 git 提交；只写文件。

---

## 6. 数据层视图（字段/函数/脚本清单以 JSON 为准，本技能不复制）

> 字段/偏移的**权威清单**在 `analysis/fields.json`（唯一增长处），**本技能不再复制字段表**；
> 脚本结构清单在 `analysis/scripts.json`，本技能同样不复制（`scripts.js --index` 看索引，`--id <ID>` 看单条）。
> 查看/维护：`scripts/report.js`（`--index/--find/--addr/--op` 查询；`--func-add/--func-edit/--func-rm`、`--field-*` 增删改），`scripts/sort-fields.js`（字段排序）；**新增/复核请用报告工具，勿手改 JSON**（便于保格式、零翻新）。

- **`scope` 分组**：`Engine` / `ScriptContext` / `global`（`global.engine` = 全局 Engine 对象基址，0x55E1BC）。
- **`status` 约定**：`confirmed`（确证）| `tentative`（偏移由 raw 证实、语义待复核）。
- **`offset` = 字节偏移**（同 `engine/engine.hpp` 约定）；`stride` = 数组步长（如 `frames[40]` 0x78、string 池 28）。
- 引用：`analysis/fields.json`（字段/偏移）、`analysis/functions.json`（函数结论）、`scripts/report.js`（报表）、`scripts/sort-fields.js`（排序）。
### 操作数模型（operand，ADR-011 带标记引用）—— "为什么有这些字段"的语义，非字段表
字段名/偏移以 `fields.json` 为准，这里只给语义映射：
- 操作数编码：`frame.ip + 8*idx` 处为值，`-4` 处为**类型 tag**。
- **type tag → 池**：
  - `3/4/5` = 引擎 int/float/string **值**池（`pool_int/float/string`，stride 4/4/28）
  - `6/7/8` = 引擎 int/float/string **引用**池（`pool_int_ref/float_ref/string_ref`，穿引取值）
  - `9/10/11` = 本帧 int/float/string **值**池（`local_int/float/string`）
  - `12/13/14` = 本帧 int/float/string **引用**池（`local_ptr/float_ptr/string_ptr`）
  - `0/1/2` = 立即数（int/float/字符串字面量）；`0x8003/0x8009` = 数组批量
- **池 `base` ↔ `count` 配对**：引擎池 `pool_*`（0x5D800 区）与 `pool_*_count`（base+4，memflip 双缓冲交换，raw 25753-25774）；帧池 `local_*`（frame+0x20..0x34）与 `local_*_count`（frame+0x08..0x1C）。
- **DEC / ENC（去混淆）**：`DEC(x)=ror32(key ^ rol32(x,11),25)`；`ENC(x)=rol32(key ^ ror32(x,7),21)`；`key`、`enc_zero` 见 `fields.json`。
- 读/写原语（结论在 `functions.json`）：`readIntOperand_41BF50`、`readFloatOperand_41C300`、`writeIntOperand_42B4B0`、`writeFloatOperand_42BA00`、`operandAddress_42AEA0`、`writePointerOperand_418B90`、`writePointerElement_418CC0`、`readStringOperand_41B640`。

> 未建模（`tentative`，待确认）：`_this + 0xA609C` 字符串表（= `frames` 区 + ? 需复核）、`_this + 387924` FileSource、`frames[cur] + 0x40..0x54` 返回栈、`_this + 4*cur + 388612/489488/489648`。`pool_*` 族语义为**推断**（偏移已由 raw 证实），待复核后转 `confirmed`。

---

## 7. 其它
- 参考（若有）：`docs-new/03-engine/*`（引擎主题）、`docs-new/05-scripts/*`（脚本台账渲染物）。（emulator 是产物，分析时禁止读取。）
- 本技能只描述**数据驱动的分析方案**；具体子系统（输入/渲染/版权页）结论若写入 `docs-new`，需与本数据层行号证据一致。
- 三层的守卫测试都在 `app/amayui-emulator/test/`：`capability-ledger.test.ts`（第二层）、`script-ledger.test.ts`（第三层）；
  改完数据层记得 `build-*.mjs` 重生成 md，否则守卫的"md 与数据层同步"一项会红。
