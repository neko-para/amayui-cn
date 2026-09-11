---
name: amayui-engine-analysis
description: 数据驱动的引擎反编译分析：读懂并归类《天結いキャッスルマイスター》的 Hex-Rays 反编译（engine/天结_unpacked.exe_utf8.c，约 18 万行），把分析结论沉淀为稳定、工具无关的**两层数据层**——第一层 analysis/functions.json + analysis/fields.json（函数/字段「是什么」），第二层 analysis/engine-capabilities.json（引擎的**常态能力**：逐帧流程/门控标志/惰性创建/转场/资源生命周期，枚举 opcode 看不出来、缺失时不报错只表现不对）。用 scripts/report.js 与 scripts/capabilities.js 查询增删改、scripts/sort-fields.js 排序、scripts/build-capabilities.mjs 渲染人可读台账。当用户要求分析某条指令/函数逻辑、检查某字段偏移的引用、盘点某个子系统的功能面（需要哪些持续行为）、或把反编译结论写入数据层时使用。
---

# amayui-engine-analysis — 数据驱动的引擎反编译分析（两层数据层：函数/字段 + 常态能力）

> 定位：读懂并归类《天結いキャッスルマイスター》引擎的 Hex-Rays 反编译（`engine/天结_unpacked.exe_utf8.c`，约 18 万行），
> 把分析结论沉淀为**稳定、可增长、工具无关的数据**，而不是会漂移的手工镜像/文本改写。
> **核心思想：分析只回答「这个函数/字段是什么」与「引擎有哪些持续行为」；结论存进数据层（唯一会增长的地方）；渲染层可从数据随时再生成。**
>
> **两层数据层**（分层的理由：这是两类根本不同的东西，混在一起必然漏掉第二类）：
>
> | 层 | 文件 | 回答的问题 | 怎么发现 |
> |---|---|---|---|
> | 一 | `analysis/functions.json` + `fields.json` | 这个 `sub_XXXXXX` / 偏移**是什么** | 顺着 opcode 表 / 字段引用**枚举**就能找到 |
> | 二 | `analysis/engine-capabilities.json` | 引擎有哪些**持续行为**（逐帧流程 / 门控标志 / 惰性创建 / 转场 / 资源生命周期） | **枚举不出来** —— 它们不是任何一条 opcode，而是"引擎自己在后台一直做的事" |
>
> 第二层的存在理由（教训）：版权页文字不淡入，查了很久才发现缺的是**逐帧颜色插值** —— 那不是一个没实现的 opcode，
> 而是引擎帧循环里的一段常态行为。这类缺失**不报错、只表现不对**，所以必须有可核对清单。
> 本技能不做逐字节等价复刻（那是 decomp.me 匹配式复刻的目标）；目标是把巨大的 `sub_XXXXXX` 读懂 + 归类。

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
analysis/fields.json                   # 数据层·第一层：字段/偏移模型（唯一会增长）
analysis/functions.json                # 数据层·第一层：函数结论（用途/状态/签名覆盖）
analysis/engine-capabilities.json      # 数据层·第二层：常态能力台账（持续行为 + emulator 现状判定）
docs-new/03-engine/engine-capabilities.md  # 台账的人可读渲染产物（由 scripts/build-capabilities.mjs 生成，勿手改）
```

工具（`<skill>/scripts/` 下；`build-capabilities.mjs` 在**仓库根** `scripts/` 下）：

| 工具 | 作用 |
|---|---|
| `scripts/report.js` | 第一层：查询 + 增删改（`--summary/--index/--find/--addr/--op/--field`、`--func-add/edit/rm`、`--field-add/edit/rm`） |
| `scripts/sort-fields.js` | 第一层：`fields.json` 按 scope+偏移重排 |
| `scripts/capabilities.js` | **第二层：查询 + 增删改 + 离线自检**（`--summary/--index/--attention/--find/--id/--validate`、`--add/edit/rm`） |
| `../../scripts/build-capabilities.mjs` | **第二层：把台账渲染成 md**（改完 JSON 必须重跑，否则守卫测试会因 md 不同步而失败） |

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

### 2.4 严格状态判定（写进 functions.json 的 status）
- **ANALYZED**：读了 handler 体确证，且体内**无未建模数值偏移**（`_this[K]`/`_this+N` 已映射成语义字段）、**无未分析被调**。
- **PARTIAL**：已读体，但仍有未建模偏移或未分析被调（在 `unmodeled` 里写明）。
- **STUB**：桩/simplified（no-op / 安全桩）。
- **UNKNOWN**：未读/无表征（缺省）。

---

## 3. 分析流程

### 3.0 先分层：这条结论该进第一层还是第二层？
分析任何东西之前先问一句：**我要回答的是"它是什么"，还是"引擎一直在做什么"？**

| 情形 | 去向 |
|---|---|
| 一个 `sub_XXXXXX` 的语义 / 一条 opcode 的 handler / 一个偏移的归属 | 第一层（`functions.json` / `fields.json`） |
| 一个**子系统需要哪些持续行为**才能工作；某个标志的**生命周期**；某个每帧步骤；某个惰性创建/转场/资源老化 | 第二层（`engine-capabilities.json`） |
| 一个子系统（如消息窗）的**功能面盘点** | **两层都要写**：逐 opcode 的 handler 结论进第一层；它依赖的持续行为（帧循环、状态位、文本子系统）进第二层 |

判定口诀：**"如果把所有 opcode 都实现对了，这个行为还会不会缺？"** 会缺 ⇒ 它属于第二层。

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
6. **渲染 + 自检**：
   - 第一层无需渲染；
   - 第二层改完必须 `node scripts/build-capabilities.mjs`，再 `capabilities.js --validate`；
   - 收尾跑一次 `npx tsx --test test/capability-ledger.test.ts`（在 `app/amayui-emulator` 下）。

---

## 4. 数据层工具（查询 + 增删改；不改写反编译文本）
只做**纯数据读写**（`analysis/fields.json` + `functions.json`）：哪些函数分析了 / 状态分布 / 字段清单 / 每函数用途与未解项，并可**新增 / 修改 / 删除**记录。
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
  - `node report.js --field-add '<json>' | --field-edit <offset> --set k=v … | --field-rm <offset>`：字段增删改（写后按 scope+offset 重排，保留分组空行）。
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

### 建议的读取姿势（AI/人）
数据层是**存储**，直接读原始 JSON 冗长。
- 第一层：先 `report.js --index --sort addr` 导航，`--find/--addr/--op` 精查，`--summary` 看进度；新增/修改用 `--func-add/--func-edit`。
- 第二层：先 `capabilities.js --attention` 看缺口，`--subsystem 消息窗` 收窄到某个子系统，`--id` 精查；
  新增/修改用 `--add/--edit`，改完 `build-capabilities.mjs` + `--validate`。
- **盘点某个子系统的功能面**时：两层一起看 —— `report.js --find <子系统名>` 找相关 handler，
  `capabilities.js --subsystem <子系统>` 找相关持续行为。

---

## 5. 硬性约定
- **原始 `engine/…_utf8.c` 只读**；结论只在 `analysis/*.json`（两层）。
- **常态能力不得只在脑子里**：任何"引擎每帧/持续做某事"的发现，必须落成 `engine-capabilities.json` 条目，
  并写清 `whySilent` —— 否则下次遇到症状又要从零研究（这正是第二层存在的理由）。
- **不许用 `n/a-known` 掩盖缺口**：必须写 `why:`，且 `capabilities.js --validate` / 守卫测试会拒收。
- **不许空口声称守卫**：`evidence` 写 E2/E3 就必须给出真实存在的 `guard` 测试文件。
- **md 是产物**：`docs-new/03-engine/engine-capabilities.md` 由 `scripts/build-capabilities.mjs` 生成，**勿手改**。
- **不写镜像 / 不写 libclang/AST 文本改写**；渲染只做纯数据报表，不依赖任何反编译器/特定工具。
- **结论带证据**：`evidence` 以 raw 行区间为主。
- **AGE 助记符不可靠**（`exit`≠程序退出、`ret`≠跨脚本返回），以**读反编译体为准**；**严禁读取/参考 emulator**（产物，非信息源）；凡 `推测`/未读体一律标 `partial`。
- **增长只在一处**（数据层）；渲染层可随时重生成。
- 不做 git 提交；只写文件。

---

## 6. 数据层视图（字段/函数清单以 JSON 为准，本技能不复制）

> 字段/偏移的**权威清单**在 `analysis/fields.json`（唯一增长处），**本技能不再复制字段表**。
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
- 参考（若有）：`docs-new/03-engine/*`。（emulator 是产物，分析时禁止读取。）
- 本技能只描述**数据驱动的分析方案**；具体子系统（输入/渲染/版权页）结论若写入 `docs-new`，需与本数据层行号证据一致。
