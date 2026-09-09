---
name: amayui-engine-analysis
description: 数据驱动的引擎反编译分析：读懂并归类《天結いキャッスルマイスター》的 Hex-Rays 反编译（engine/天结_unpacked.exe_utf8.c，约 18 万行），把每个函数（sub_XXXXXX）与字段/偏移的分析结论沉淀为稳定、工具无关的数据层（analysis/fields.json + analysis/functions.json），并用 scripts/report.js 做查询与增删改、scripts/sort-fields.js 排序。当用户要求分析某条指令/函数逻辑、检查某字段偏移（如 +166965）的引用、或把反编译结论写入数据层时使用。
---

# amayui-engine-analysis — 数据驱动的引擎反编译分析（fields.json + functions.json）

> 定位：读懂并归类《天結いキャッスルマイスター》引擎的 Hex-Rays 反编译（`engine/天结_unpacked.exe_utf8.c`，约 18 万行），
> 把分析结论沉淀为**稳定、可增长、工具无关的数据**，而不是会漂移的手工镜像/文本改写。
> **核心思想：分析只回答「这个函数/字段是什么」；结论存进数据层（唯一会增长的地方）；渲染层可从数据随时再生成。**
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
analysis/fields.json                   # 数据层：字段/偏移模型（唯一会增长）
analysis/functions.json                # 数据层：函数结论（用途/状态/签名覆盖）
```
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

### 2.3 严格状态判定（写进 functions.json 的 status）
- **ANALYZED**：读了 handler 体确证，且体内**无未建模数值偏移**（`_this[K]`/`_this+N` 已映射成语义字段）、**无未分析被调**。
- **PARTIAL**：已读体，但仍有未建模偏移或未分析被调（在 `unmodeled` 里写明）。
- **STUB**：桩/simplified（no-op / 安全桩）。
- **UNKNOWN**：未读/无表征（缺省）。

---

## 3. 分析流程（每次分析一个函数）
1. **定位**：从 `docs-new/03-engine/opcode-table.md` 或 func-list 里定位 `sub_XXXXXX`。
2. **先查 `fields.json`**：把函数体内的偏移**按表解码**（`0x5d880→cur_script`、`0x78 步长→帧下标`、`0x5d8b4→local_int`）。表里没有的偏移，先标 `tentative`，分析确证后再改 `confirmed`。
3. **读 raw handler 体**，理解语义（子行为：它先做什么、分支、调用什么）。
4. **只依据 raw 读体**：分析只用 `engine/…_utf8.c` 直接读出的内容。**不读取/参考 emulator**（它是产物，由分析结果实现，方向相反）。
5. **写回数据**（**只在一处增长**）：
   - 新增/复核字段 → `fields.json`（带 `evidence` + `status`）。
   - 函数结论 → `functions.json`（`purpose`/`status`/`signature_override`/`sub_behaviors`/`unmodeled`/`evidence`）。
6. **可选渲染**（见 §4）。

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

### 建议的读取姿势（AI/人）
数据层是**存储**，直接读原始 `functions.json` 冗长。先 `report.js --index --sort addr` 导航，`--find/--addr/--op` 精查，`--summary` 看进度；新增/修改结论用 `--func-add/--func-edit`。

---

## 5. 硬性约定
- **原始 `engine/…_utf8.c` 只读**；结论只在 `analysis/*.json`。
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
