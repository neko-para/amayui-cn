# 01 · 背景：AGE 引擎逆向现状

> 目标读者：要在 `app/amayui-emulator` 里动手写代码的人（以及后续接手的自己）。
> 目的：把「引擎是什么、已经解到什么程度、还剩哪些未知」一次性说清，免得重踩已确认的坑、高估或低估工作量。

---

## 1. 一句话结论

**AGE / Eushully 引擎是一个「通用字节码解释器（VM）+ 一套引擎子系统」**。它本身**不含任何游戏字段语义**（单位、掉落、技能、货品……），那些语义**全部写在游戏脚本字节码（src）里**。因此：

- VM 核心是「游戏无关、可移植」的 → **重写它是值得且可行的**；
- 引擎的「另外一半」是子系统（渲染/音频/输入/字体/文件/存档），这部分才是难啃且决定工作量的地方。

本工程的唯一重要推论：**我们不需要重复引擎的 Win32 原生初始化（窗口/D3D 设备/消息循环），而是直接在「解释器层」启动**——构造引擎态、装载首个脚本、进入解释器主循环。见 `02-architecture-decisions.md`。

---

## 2. 分析对象与资产（全部为工程内真实路径）

| 资产 | 路径 | 用途 |
|---|---|---|
| 反编译源码（权威语义参考） | [`engine/天结_unpacked.exe_utf8.c`](../../../engine/天结_unpacked.exe_utf8.c) | Hex-Rays 全量 C（字节寻址），约 5.2MB |
| 重定型成员化视图（语义命名） | [`engine/engine.cpp`](../../../engine/engine.cpp) | retarget.py 生成：成员函数化 + 字段标记 + 语义名，约 18 万行 / 5.2MB |
| `this` 对象模型（已确认偏移） | [`engine/engine.hpp`](../../../engine/engine.hpp) | `struct Engine` + `ScriptContext frames[40]` + static_assert 锁定偏移 |
| opcode→handler 全量表 | [`docs/re/engine/06-opcode到handler映射表.md`](../../../docs/re/engine/06-opcode到handler映射表.md) | 544 条具名/实现 handler + 回退默认清单 |
| 权威逆向文档 | [`docs/re/engine/`](../../../docs/re/engine/) | 加壳/架构/opcode 分发/操作数访问/脚本上下文/拆壳 等 15 篇 |
| 脚本反汇编文本 | [`src/*.txt`](../../../src/) | 以指令名形式呈现的 AGE 字节码（如 `TITLE.txt`） |
| 实际字节码 BIN | [`raw-parts/DATA1/*.BIN`](../../../raw-parts/DATA1/)、[`raw/SYSTEM4.BIN`](../../../raw/SYSTEM4.BIN) | 本体验证加载的目标文件 |
| 脚本容器索引 | [`raw/SYS4INI.BIN`](../../../raw/SYS4INI.BIN) | `call-script <index>` 的 index→文件 映射来源 |
| 运行时在位读取器（Oracle 工具） | [`app/amayui-inspector/`](../../../app/amayui-inspector/) | C#/WPF，读运行中引擎的 `this`/全局表/帧栈（Windows only） |

> ⚠️ **重要**：`engine/engine.cpp` 是**反编译产物，不是干净规范**。主循环 `interpreterMainLoop_412290` 一个函数就有上百个局部变量（v2…v61），**语义上真实、阅读上糟糕**。它只能当「语义参考」，不能当「要照抄的源码」。我们的目标是**用 TS 干净重写语义**，不是翻译这 18 万行。

---

## 3. 引擎的核心结构（已确认的部分）

### 3.1 opcode 分发 = 一维函数指针表
- 基址：`this + 0x0A509C + 4*opcode`，**支持 opcode 0..0x3FF（上限 0x400）**。
- 默认 handler：`sub_418E30`（越界/未实现时走它）。
- 在 `Command` 构造器 `sub_415640` 里初始化（`memset/rep stosd` 先填默认，再按 opcode 覆盖）。
- 本引擎实际实现 **544 条**有自定义 handler；其余 30 条左右落在默认（多为 AGE 家族其它作品专属 opcode，Amayui2/Fuukan/Tenmei 等）。

### 3.2 解释器主循环
- 函数：`sub_412290`（`engine.cpp` 内为 `Engine::interpreterMainLoop_412290`），`__noreturn`。
- 伪码：
  ```c
  while(1){
     opcode = *(ip);                     // ip = _this[120*cur_script + 383128]
     if (opcode > 0x3FF) defaultHandler(this);
     else dispatchTable[opcode](this);   // this + 0xA509C + 4*opcode
     ip += 4 * arity;                    // arity 在 _this[120*cur + 383220]
  }
  ```
- 操作数布局：每条指令 = `opcode u32` + `argc` 个 typed 参数，每个参数 = **`type u32` + `raw_data u32`，共 8 字节**。指令长度 = `4 + 8*argc`。

### 3.3 操作数访问原语（读/写，4 个）
| 原语 | 语义 |
|---|---|
| `sub_41BF50` | 读第 N 个操作数（int 化），按 type 分支，int 槽走 `DEC` 去混淆 |
| `sub_41C300` | 读第 N 个操作数（float 化），孪生版 |
| `sub_42B4B0` | 写第 N 个操作数（int），int 槽走 `ENC` 编码 |
| `sub_42BA00` | 写第 N 个操作数（float），孪生版 |

操作数 type 对应：`0`=立即int、`1`=立即float、`2`=local-string、`3`=global-int、`4`=global-float、`5`=global-string、`6`=global-ptr、`7`=global-float-ptr、`9`=local-int、`0xA`=local-float、`0xB`=local-string、`0xC`=local-ptr、`0xD`=local-float-ptr；`0x8003`=全局整型数组批量、`0x8009`=局部整型数组批量。

### 3.4 `DEC` / `ENC` 混淆（关键坑，必须精确实现）
```c
DEC(x) = __ROR4__( key ^ __ROL4__(x,11), 25 )  =  ROL4( key ^ ROL4(x,11), 7 )
ENC(a) = __ROL4__( key ^ __ROR4__(a,7), 21 )    // 与 DEC 互为逆运算，key 相同
key    = *(this + 0x5EC8C)                       // per-instance，构造时写入，非编译期常量
```
- **所有** global/local int 槽、ptr 目标、整型数组元素读写都过这条线；**float 槽不编码**。
- TS 里 `number` 是 double，必须用 `|0`（int32）、`>>>`（逻辑右移）、`Math.imul`、手写 ROL/ROR 来保证 32 位语义。**不要用裸 `<<`/`>>`/`+` 对位模式运算**。

### 3.5 脚本上下文与调用栈
- 引擎为每个脚本上下文准备 **40 个固定帧**（`0..39`），每帧 120 字节（`0x78`），基址 `this + 0x5D894 + 0x78*cur`。
- `cur_script`（`this[95776]`,`0x5D880`）= 当前帧深度（active 帧指针）。
- `call_ret`(`0x5D884`)、`call_link`(`0x5D888`)、`call_flag`(`0x5D88C`)= 控制流目标深度寄存器（存帧下标或 `-1/-10/-11` 哨兵）。
- `frames[cur].caller`（页 `+0x38`）是持久的帧内回链；嵌套 call-script = 切换 `cur`，被挂起帧的 IP/局部变量/字符串表一直保留。
- 帧内字段：`str_table(+0x00)`、`ip(+0x04)`、`local_int(+0x20)`、`local_float(+0x24)`、`local_string(+0x28)`、`local_ptr(+0x2C)`、`local_float_ptr(+0x30)`、`caller(+0x38)`、`frame_arg(+0x3C)`、`arity(+0x60)`、`array_container(+0x70)`。

### 3.6 全局 variant 数组（基址在 `this` 里，间接指针）
| 字段 | 偏移 | 说明 |
|---|---|---|
| `global_int_base` | `0x5D800` | global-int 数组基址（含掉落 item/rate 区段 VM 索引 `0x53cd7c..0x53f48c`） |
| `global_float_base` | `0x5D808` | |
| `global_string_base` | `0x5D810` | |
| `global_ptr_base` | `0x5D818` | |
| `global_float_ptr_base` | `0x5D820` | |

> ⚠️ **陷阱**：脚本里的 `(global-int 0x53e104)` 是 **VM 抽象索引**，不是进程地址。真实位置 = `global_int_base + 0x53e104*4`，且读出的值需过 `DEC`。

---

## 4. 已确认 vs 仍未解（诚实清单）

### ✅ 已确认（可放心当事实用）
- opcode 分发机制（一维表、上限 0x400、默认 handler）、主循环结构。
- 操作数访问原语 + `DEC`/`ENC` 公式 + type 域。
- 帧/调用栈布局（40 帧、`cur_script`/`call_ret`/`call_link`/`call_flag`、帧内字段）。
- 全局 variant 数组基址偏移、`key` 偏移。
- 544 条 opcode→handler 的**地址映射表**（哪些 opcode 有自定义 handler，各自是谁）。
- 引擎是通用解释器、字段语义在字节码（这决定了整个分析/重写的分界线）。

### ⚠️ 仍未解 / 需要继续研究（正是重写时要一并解决的部分）
- **大量 opcode 的「语义」**：544 条里只有约 77 条有具名助记符，其余约 467 条是 `u0041xxxx`（跨构建交叉引用名，不含语义）。**每条的具体行为要从反编译 handler 体里读出来**。
- **`this` 对象的整体布局**：`engine.hpp` 的大片区域（`0x5D800` 之前、`0x5EC90..0xA509C`、尾部）是 char 占位，语义未知。重写时应**干净建模**（只建模 opcode 真正触达的语义态），而不是复刻这个字节大块。
- **脚本文件如何从 index 解析**：`call-script <index>` 的 index→文件 的生命周期（SYS4INI 文件表 / APPEND `0xnn000000+pos`）在 `docs/re/src/01` 已定性，但引擎侧装载细节（`loadScriptFrame_40ED40`）仍需核对。
- **首个脚本如何被装载**：`loadScriptFrame_40ED40(engine, v52, hWnd, 0)` 中 `v52` = 首个脚本 id（应为 SYSTEM4），如何从引擎初始化得到，需确认（见 `04-boot-chain-analysis.md`）。
- **子系统调用的真实行为**：draw-texture/create-texture/set-texture（D3D9）、play-voice（winmm）、set-font、input callback、存档……这些是引擎调用 Win32 的接口，重写为 H5/IPC 时要替换。**在「无界面」模式下全部 stub**。

---

## 5. 对重写工作的直接影响（先建立正确预期）

1. **不要尝试照抄 18 万行 engine.cpp**。用它做「某个 opcode/子系统语义的参考书」，用 TS 重写**语义**。
2. **正确性风险集中在「被脚本实际用到的 opcode 的语义保真」**，不是引擎框架结构（框架已解）。
3. **范围风险集中在「子系统/渲染」**，它和「VM 核心」不是一个量级。第一里程碑先用 stub 规避它。
4. **第一里程碑「无界面跑到 TITLE.txt」** 的现实工作量 = ① BIN 读取器（格式已明确）；② VM 核心解释器（高频算术/位/比较/跳转/call-script/return）；③ 系统调用 stub；④ **把启动链里用到的 ~55 个 `uXXXX` opcode 逐个判定为「VM 核心（须实现）」还是「子系统副作用（可 stub）」**。④ 是真正的主战场，见 `04-boot-chain-analysis.md`。
