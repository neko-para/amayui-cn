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

## 4. 渲染层（纯数据报表 / 数据工具）
只做**纯数据报表**（读 `analysis/fields.json` + `functions.json`）：哪些函数分析了 / 状态分布 / 字段清单 / 每函数用途与未解项。
**永不改写反编译文本，也不依赖任何反编译器/特定工具。**

- `scripts/report.js`：报表生成器（读两个 data 文件，打印进度 / 状态分布 / 字段清单）。
- `scripts/sort-fields.js`：字段排序器（按 `scope` + 字节偏移排 `fields.json`，作用域间留空行分组）。

---

## 5. 硬性约定
- **原始 `engine/…_utf8.c` 只读**；结论只在 `analysis/*.json`。
- **不写镜像 / 不写 libclang/AST 文本改写**；渲染只做纯数据报表，不依赖任何反编译器/特定工具。
- **结论带证据**：`evidence` 以 raw 行区间为主。
- **AGE 助记符不可靠**（`exit`≠程序退出、`ret`≠跨脚本返回），以**读反编译体为准**；**严禁读取/参考 emulator**（产物，非信息源）；凡 `推测`/未读体一律标 `partial`。
- **增长只在一处**（数据层）；渲染层可随时重生成。
- 不做 git 提交；只写文件。

---

## 6. 已确认的字段模型（`fields.json` 为唯一事实来源；下表为固化摘要，如有出入以 `fields.json` 为准）

### 全局
- `engine`（原 `dword_55E1BC`，`Engine*`）—— 全局游戏/Engine 对象基址；访问用字节偏移。

### `Engine`（只列本工程用到的）
| 字节偏移 | 字段 | 类型 | 含义 |
|---|---|---|---|
| 0x00 | vftable | uaddr | Engine vtable |
| 0x08 | message_buf | char[0x400] | ShowMessage sprintf 目标 |
| 0x5D800 | pool_int | uaddr | 引擎作用域 int 池（operand type 3，`tentative`） |
| 0x5D808 | pool_float | uaddr | 引擎作用域 float 池（type 4，`tentative`） |
| 0x5D810 | pool_string | uaddr | 引擎作用域 string 池（type 5，步长 28=SSO，`tentative`） |
| 0x5D818 | pool_int_ref | uaddr | 引擎作用域 int 引用池（type 6，元素为指针，`tentative`） |
| 0x5D820 | pool_float_ref | uaddr | 引擎作用域 float 引用池（type 7，`tentative`） |
| 0x5D828 | pool_string_ref | uaddr | 引擎作用域 string 引用池（type 8，步长 28，`tentative`） |
| 0x5D880 | cur_script | uint32_t | 当前脚本帧深度 (this[95776]) |
| 0x5D884 | call_ret | uint32_t | 跨脚本返回目标 (this[95777]) |
| 0x5D894 | frames[40] | ScriptContext[40] | 每脚本帧数组（帧距 0x78=120） |
| 0x5EC8C | key | uint32_t | DEC/ENC 密钥 (this[97059]) |
| 0x5EC90 | enc_zero | uint32_t | ENC(0) 常量槽 (this[97060]) |
| 0x69330 | counter | uint32_t | random 帧计数器 (this[107724]) |

### `ScriptContext`（0x78=120）
| 字节偏移 | 字段 | 类型 |
|---|---|---|
| 0x00 | str_table | uaddr |
| 0x04 | ip | uaddr |
| 0x08 | local_int_count | uint32_t |
| 0x0C | local_float_count | uint32_t |
| 0x10 | local_string_count | uint32_t |
| 0x14 | local_ptr_count | uint32_t |
| 0x18 | local_float_ptr_count | uint32_t |
| 0x20 | local_int | uaddr（基址指针） |
| 0x24 | local_float | uaddr |
| 0x28 | local_string | uaddr |
| 0x2C | local_ptr | uaddr |
| 0x30 | local_float_ptr | uaddr |
| 0x34 | local_string_ptr | uaddr（type 14，步长 28，`tentative`） |
| 0x38 | caller | uint32_t |
| 0x3C | frame_arg | uint32_t |
| 0x60 | arity | uint32_t（指令长度，含 opcode） |
| 0x70 | array_container | uaddr |

### 操作数模型（operand，ADR-011 带标记引用）
- 操作数编码：`frame.ip + 8*idx` 处为值，`-4` 处为**类型 tag**。
- **type tag → 池**：`3/4/5`=引擎 int/float/string 池（`pool_int/float/string`，stride 4/4/28）；`6/7/8`=引擎 int/float/string **引用**池（`pool_*_ref`，穿引）；`9/10/11`=本帧 int/float/string 池（`local_int/float/string`）；`12/13/14`=本帧 int/float/string 引用池（`local_ptr/float_ptr/string_ptr`）；`0/1/2`=立即数（int/float/字符串字面量）；`0x8003/0x8009`=数组批量。
- **DEC / ENC（去混淆）**：`DEC(x)=ror32(key ^ rol32(x,11), 25)`；`ENC(x)=rol32(key ^ ror32(x,7), 21)`；`key=this->key(0x5EC8C)`，`ENC(0)=this->enc_zero(0x5EC90)`。
- 读/写原语（已入 `functions.json`）：`readIntOperand_41BF50`、`readFloatOperand_41C300`、`writeIntOperand_42B4B0`、`writeFloatOperand_42BA00`、`operandAddress_42AEA0`、`writePointerOperand_418B90`、`writePointerElement_418CC0`、`readStringOperand_41B640`。

> 未建模（`tentative`，待确认）：`_this + 0xA609C` 字符串表（=0x5D894+? 需复核）、`_this + 387924` FileSource、`frames[cur] + 0x40..0x54` 返回栈、`_this + 4*cur + 388612/489488/489648`。本表 `pool_*` 族语义为**推断**（偏移已由 raw 证实），需后续复核后再转 `confirmed`。

---

## 7. 其它
- 参考（若有）：`docs-new/03-engine/*`。（emulator 是产物，分析时禁止读取。）
- 本技能只描述**数据驱动的分析方案**；具体子系统（输入/渲染/版权页）结论若写入 `docs-new`，需与本数据层行号证据一致。
