---
name: amayui-engine-analysis
description: 系统分析《天結いキャッスルマイスター》引擎反编译源（engine/天结_unpacked.exe_utf8.c，C++ 风格）并维护「哪个函数分析了、哪些行未知」的显式进度，把已确证的结论以**C++ 风格（.cpp，语义化命名/注释/归类）**沉淀到精修副本 engine-refined/。当用户要求：分析某个引擎函数/子系统（如输入、渲染、某 opcode handler）、把反编译 C++ 读明白并改名/注释/归类、或整理引擎分析进度时，使用本技能。它规定「原始 .c 只读 + 精修 .cpp + 函数级状态标记 + 机器可读台账 + Node 脚本报表」的整体工作流。
---

# Amayui Engine Analysis（引擎反编译分析/精修工作流）

## 概述

工程有一个大体积的 Hex-Rays 反编译源：`engine/天结_unpacked.exe_utf8.c`（约 18 万行）。
它由无数 `sub_XXXXXX` 组成，很多已被读过、很多未读，且**没有显式记录哪部分已读、哪部分未知**。
本技能把这项分析工作**流程化**：

1. **原始只读**：`engine/` 里的 `.c` 是反编译基准，只用来读、对照行号，**从不直接编辑**。
2. **精修产物（`.cpp`，C++ 风格）**：`engine-refined/` 下用**同名 `.cpp`** 保存精修结果
   （如 `天结_unpacked.exe_utf8.cpp`）。每完成一次业务分析就改这里——把 `sub_XXXXXX`
   改成语义名、加注释、圈定已解区，并打**函数级状态标记**。
3. **结论以代码注释为准**：每个函数的 `状态 / raw行区间证据 / 说明` 一律写入函数上方注释块，不依赖任何 JSON 台账。
   由脚本出报表，回答"哪些分析过、哪些未知、每函数哪些行已解"。
4. **与文档联动**：`docs-new/03-engine/*`（如 `input-system.md`、`opcode-table.md`）
   里的 raw.c 行号引用，必须与 `engine-refined/*.cpp` 的标记一致，避免两套可信度不同的记录。

> **产物理念**：反编译源本身是 **C++ 风格**（`__thiscall`、`this`、`operator delete`、
> `_CxxThrowException`、vtable 派发、`*_vftable_` 等），工程分析也已有 `engine/engine.cpp`。
> 因此**精修产物一律以 `.cpp` 维护**：名称/类型/注释按 C++ 语义，`sub_XXXXXX` 改成有意义的
> 成员/自由函数名，必要时还原成 `Engine::xxx` 或 `xxx()` 形式。原始 `.c` 仅作反编译对照，不进精修。
>
> 目标取向：**读懂+归类**（业务分析），不是"复制出等价源码"的逐字节匹配
> （匹配式需游戏原工具链 + decomp.me/diff.py，属另一更大的工程，本技能不采用）。

---

## 目录 / 工作树约定

```
engine/
└─ 天结_unpacked.exe_utf8.c        # 原始反编译（只读基准；git 提交后不再改）
engine-refined/
├─ 天结_unpacked.exe_utf8.cpp      # 原始基准逐字节副本（只读对照，保持行号；git 提交后不再改）
├─ engine/                         # 已提取的 Engine 成员函数（按语义名分类拆分；split-members.cjs 生成）
│  ├─ arith-ops.cpp                # 整数算术/逻辑/比较（add..random）
│  ├─ bit-ops.cpp                  # 位操作（bit-set/reset/check-bit）
│  ├─ float-ops.cpp                # 浮点（float-mov, int↔float, 比较）
│  ├─ str-ops.cpp                  # 字符串（set-string, concat, strlen…）
│  ├─ memory-ops.cpp               # 数组/索引/取地址(lea)（lookup-array, lea, memcpy…）
│  └─ members.cpp                  # 其余 Engine 成员函数（未分类/未分析/非纯）
├─ remaining-code.cpp              # 剩余代码（已提取成员函数定义区间替换为空行；行号与原始一致；remaining.cjs 生成）
├─ model/
│  └─ engine.hpp                   # 指令层字段模型（仅含目前已拆分指令用到的字段，其余 padding；待迭代补全/核对）
└─ engine/                         # 已提取的 Engine 成员（按类别拆分）
   ├─ arith/bit/float/str/memory-ops.cpp  # 已分类的指令
   └─ members.cpp                  # 其余成员
.agents/skills/amayui-engine-analysis/
├─ SKILL.md                        # 本文档
├─ scripts/                        # 全部为 Node 脚本，跨 Win/macOS/Linux（用 `node` 运行）
│  ├─ func-list.js                 # 解析 .c/.cpp 提取函数列表 + 行区间
│  ├─ scan-status.js               # 扫精修 .cpp 的状态标记 → 按状态统计并列出
│  ├─ func-table.js                # 函数列表 × 可声明台账 → 汇总表（完成度/证据）
│  ├─ diff-refined.js              # 原始 .c vs 精修 .cpp → 已改函数/行统计（git 优先，缺则行数对比）
│  └─ (scripts/engine-refined/ 里另有 memberize.cjs / split-members.cjs / remaining.cjs)
└─ (registry.template.json 已弃用：分析结论一律以代码注释为准，不再维护 analysis-registry.json)

> **代码分区（每段只出现在一处，基线除外）**：Engine 成员函数体只在 `engine-refined/engine/*.cpp`；
> 其余代码（非成员函数、全局、声明/调用点）只在 `remaining-code.cpp`；原始基准保留全部对照。
> 已提取成员的函数定义区间在 remaining-code.cpp 里**替换为空行**以保持行对应，方便映射回原始。

> **命名**：函数/字段按 C++ 语义命名；`_this`=这类 `this` 指针、成员访问写作 `this->…` 或
> `obj->…`；`sub_XXXXXX` 确证后改名（如 `poll-input`→`pollInput` 或 `Engine::pollInput`）。
>
> **跨平台**：所有脚本用 Node 标准库（fs/path/child_process），不依赖 bash/awk。
> Windows 下用 `node <script>` 运行即可（`git` 可用时 diff-refined.js 走 `git diff --no-index`，
> 不可用则退回纯 Node 的行数对比）。脚本内文本按 `\r?\n` 切行，兼容 CRLF。
```

- **首次初始化**：`cp engine/天结_unpacked.exe_utf8.c engine-refined/天结_unpacked.exe_utf8.cpp`
  （一次性，把原始照抄成 `.cpp` 精修起点）。**不再维护 `analysis-registry.json`**：分析结论一律沉淀在代码注释（函数上方状态标记）里。
- 原始 `engine/` 与精修 `engine-refined/` 都是 git 管理的两个路径：`git diff engine engine-refined`
  即"改动即进度"。

---

## 函数级状态标记（精修源码内）

每个**已读过的函数**，在其定义前加一个头部注释块，含状态标签：

```c
/* ===== [x] sub_419CC0  →  poll-input                      状态: ANALYZED =====
 * 读设备态刷掩码 → 清 _this[174801]&0x8000000 → _this[174802]=0。
 * 证据: engine/天结_unpacked.exe_utf8.c raw 25069；emulator src/vm/ops.ts op_poll_input
 */
_DWORD *__thiscall sub_419CC0(_DWORD *_this) { ... }
```

状态标签（大写，供脚本 grep）：
- `ANALYZED`（**真正完整分析**：读了 handler 体确证，且函数内**没有**未建模的 `_this[K]`/`_this+N` 直接数值偏移字段访问，**也不调用**未分析函数。满足才标，否则不得标）。
- `PARTIAL`（部分：已读/部分确证，但仍有未建模字段访问，或仍调用未分析函数，需继续）。
- `STUB`（桩/simplified：emulator 用安全桩/no-op 处理，未逆清完整语义）。
- `UNKNOWN`（未读/未解；可不加，缺省即 UNKNOWN）。

> **严格「已分析」判定（重要）**：一个函数只有在
> ① 函数体内不再出现 `_this[<数字>]` / `_this + <数字>` 这类**直接数值偏移**的引擎字段访问（已建模成 `this->field`/`this->frames[cur].field`），
> ② 且不调用任何**未分析/未建模**的函数（仅可调用已分析函数与文档化的操作数访问原语），
> 才可标 `ANALYZED`。否则标 `PARTIAL`（并在注释里写明遗留的未建模字段/未分析被调）。
> 分析一个未命名字段的流程（迭代直至达标）：
>   $1 分析所有相关未命名字段，确认用途/用法；
>   $2 在 `engine/engine.hpp` 的 `struct Engine` 里为未定义字段建模（命名 + 类型 + 偏移）；
>   $3 修改代码，把该偏移访问改为对建模后字段的引用（`this->field`）；
>   $4 迭代：直到目标函数没有直接数值偏移字段访问、也没有未分析函数的调用，才标 `ANALYZED`。

**已确证结论直接改名**：`sub_419CC0 → poll_input`（C 里 `sub_419CC0` 的调用点同步改名），
旧 `sub_*` 名保留为注释别名。跨构建交叉引用的 `u00xxxxxx`/AGE 助记符**不可靠**，勿当定论。

> **结论以代码注释为准（架构约定）**：所有**分析结论**都写在函数上方的注释块里（语义、字段建模、证据、状态与未办事项）。
> JSON（原 `analysis-registry.json` / `member-index.json` / `op-records.json`）**已移除**——它们只是临时派生载体，不是权威；
> 现在无任何一个 JSON 承载分析结论，结论只存在于代码注释 + `model/engine.hpp` + `docs-new/03-engine/*`。代码是被分析的主体，而非 JSON 的渲染产物。

---

## 行/区块级标注（回答"哪些行未知"）

大文件按行打标记会随编辑错位，**不推荐逐行**。用**区块注释**圈定已解区域，未解处用 `??`：

```c
  /* [KNOWN] 手柄按钮映射区：_this[1158] 逐位消费 → mask|=1<<(..+4) */
  ...
  /* [END KNOWN] */
  /* ?? POV 阈值 0x4650 的精确含义未逆清 */
```

---

## 分析进度（无 JSON；结论在注释）

> ⚠️ **不再维护 `analysis-registry.json` / `member-index.json` / `op-records.json`**（均已移除）。
> 函数级状态/语义/证据一律以 `engine-refined/engine/*.cpp` 里每函数上方的 `[stained]` 状态注释块为准；
> `scripts/engine-refined/device-ink` 里的脚本不再产出这些临时索引。需要「哪些已分析」时，用 `scan-status.js` 扫注释即可。

```json
{
  "funcs": [
    { "old": "sub_419CC0", "new": "poll_input", "op": "0x101",
      "status": "ANALYZED", "lines": [25069, 25082],
      "evidence": "engine raw.c 25069; emulator ops.ts op_poll_input",
      "notes": "刷掩码后复位；供同批位检查读随即清零" }
  ]
}
```

字段：`old`(原始名) / `new`(语义名) / `op`(opcode，可空) / `status` / `lines`(raw.c 行区间) /
`evidence`(证据路径+行) / `notes`(一句话说明)。脚本依此出"完成度/未解清单"报表。

---

## 脚本（scripts/，全部 Node，跨平台，用 `node` 运行）

```bash
# 1) 解析原始 .c，列出所有函数及其行区间
node .agents/skills/amayui-engine-analysis/scripts/func-list.js engine/天结_unpacked.exe_utf8.c

# 2) 扫描精修副本(.cpp)的状态标记，按状态统计 + 列出（状态标记在 engine-refined/engine/*.cpp 里）
node .agents/skills/amayui-engine-analysis/scripts/scan-status.js engine-refined/engine/arith-ops.cpp
node .agents/skills/amayui-engine-analysis/scripts/scan-status.js engine-refined/engine/members.cpp

# 3) 函数列表 × 可声明台账 → 汇总表（已改名 / 状态分布；台账 JSON 已弃用，传空 JSON 则统计 0 登记）
node .agents/skills/amayui-engine-analysis/scripts/func-table.js \
     engine/天结_unpacked.exe_utf8.c /dev/null

# 4) 原始 vs 精修，统计已改函数/行（git diff --no-index 优先，缺则行数对比）
node .agents/skills/amayui-engine-analysis/scripts/diff-refined.js
```

---

## 分析一个函数的流程

1. **定位**：从 `docs-new/03-engine/opcode-table.md`（opcode→handler）、`func-list.js`、
   或表达式/日志里定位到 `sub_XXXXXX`。
2. **判定状态**：读 handler 体（读 `engine/…_utf8.c` 对应行区间）。严格判定（见上「严格『已分析』判定」）：
   已读体 + 无未建模 `_this[K]`/`_this+N` 字段访问 + 无未分析被调 → `ANALYZED`；
   已读但仍有未建模字段/未分析被调 → `PARTIAL`；emulator 里是桩 → `STUB`；没读 → 不加标记（默认 `UNKNOWN`）。
3. **改精修**：在 `engine-refined/engine/*.cpp`（或尚未分类的 `engine/` 成员）里：
   - 函数头部加状态注释块（含 raw.c 行号证据、**语义结论**、遗留未建模字段/被调、状态）；
   - 确证后把函数改名语义名（C++ 风格，如 `pollInput`/`Engine::pollInput`），同步调用点，旧名留注释；
   - 函数内用 `/* [KNOWN] … */` / `??` 圈定已解/未解区；`_this`/this 语义按 C++ 整理。
   **不改 `engine/` 原始 `.c` 文件。**
4. **结论写进注释（权威）**：语义/字段建模/证据/状态均写入函数上方注释；**不再维护任何 JSON**（原 `analysis-registry.json` 等已移除）。
   临时派生载体（可由注释重生成）。
5. **同步文档**：若该结论已经在 `docs-new/03-engine/*` 有记录（如 `input-system.md`、
   `opcode-table.md`），确认文档里的 raw.c 行号引用与 `engine-refined/` 一致；缺则补写。
6. **跑报表**：`scan-status.js`（扫 `engine/*.cpp` 的状态标记）/ `func-table.js` 复核；未解函数仍为 `UNKNOWN`。

---

## 硬性约定

- **原始 `engine/` 只读**：所有改动只在 `engine-refined/` 进行；否则无法再用行号对照原始反编译。
- **已核对结论必须带证据**：状态注释块与台账都写 raw.c 行号 + 证据来源（emulator/文档）。
- **`推测` 不当定论**：仅凭 AGE 助记符/名字推断、未读 handler 体的，标 `PARTIAL`/`STUB`，
  并注明"未读体/仅凭名称"；`exit≠程序退出`、`ret≠跨脚本返回` 这类 AGE 陷阱例外要注明。
- **不执行 git 提交**：只改文件；提交由用户决定。
- **不重复记账**：分析结论只在**代码注释**记一次；不再维护 `analysis-registry.json` 等 JSON，脚本只从注释出报表。

---

## 与现有能力的边界

- 本技能**只管引擎反编译 C 的精修与进度**。
- 具体业务分析结论（版权页 frame、输入系统、渲染等）仍沉淀到 `docs-new/03-engine/*`，
  本技能只保证"代码里的状态标记 + 台账"与这些文档的 raw.c 行号一致。
- 若要做**逐字节匹配式反编译**（重新编译成等价源码并 diff），那是另一工程（需要游戏工具链），
  本技能不覆盖。

---

## 资源

- 本文档（SKILL.md）：唯一流程约束。
- `scripts/` 下 4 个脚本 + `registry.template.json`。
- 参考文档：`docs-new/03-engine/opcode-table.md`（opcode→handler + 分析状态）、
  `docs-new/03-engine/input-system.md`（输入系统权威记录）、`docs-new/03-engine/runtime-memory.md`。
