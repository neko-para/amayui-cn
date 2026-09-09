# 03-engine · 流程控制指令族（exit / call-script / ret / exit-script / jmp / jcc / i143）

> 本文件对《天結いキャッスルマイスター》引擎**最核心的流程控制**指令族做逐条拆分：每条给出忠实于原始反编译的伪代码、语义、所用帧/引擎槽，并标注当前 `app/amayui-emulator` 的实现状态（用于防止后续实现时遗漏「跨帧返回 / 返回栈 / 派发」这类易错细节）。
>
> 分析源：`engine/天结_unpacked.exe_utf8.c`。数据层见 `analysis/functions.json`（本文件新增/复核 7 条）。
>
> 状态图例同《engine-reset-mainloop.md》：`[已实现]` / `[部分实现]` / `[字段未知]` / `[逻辑未知]` / `[平台无关/无需实现]` / `[未建模]`。
>
> ⚠️ AGE 助记符不可靠（`exit`≠程序退出、`ret`≠跨脚本返回）；以下以读反编译体为准。

---

## 0. 帧模型速记（所有 handler 共用）

- 第 `cur` 个脚本帧基址 = `_this + 120*cur + 383104`（`_this[383104]`=cur_script，120 字节/帧）。
- 帧内槽（相对 383104，单位字节）：
  - `frame+0x04`(383108)=`call_ret`（跨脚本返回层，亦全局 `_this[383108]`）。
  - `frame+0x14`(383124)=当前指令**起始**字节位（`_this[120*cur+383124]`）。
  - `frame+0x18`(383128)=当前**opcode/ip**字节位（`_this[120*cur+383128]`，主循环取其 disp）。
  - `frame+0x4C`(383180)=本帧**返回目标/调用方**（`_this[120*cur+383180]`，=emulator `Frame.caller`）。
  - `frame+0x50`(383216)=某「有效/清库」槽（`_this[120*cur+383216]`）。
  - `frame+0x74`(383220)=**指令长度/状态槽**（`_this[120*cur+383220]`：0=空闲、1=ret、3=call-script/跳转中、7=jcc）。
  - `_this[120*cur+383220]` 同时被主循环 `LABEL_216` 当推进量（`ip += 4 * this`）。
- **同脚本返回栈**：每帧 256 槽，计数数组基址 `byte 388612`（` _this[cur+97153]`，40×4=160B，`sub_40DF10` memset 0xA0），数据数组基址 `byte 1024*cur + 388772`（` _this[256*cur+97193+top]`）。
- **effect_flags 保存栈**：全局，base `_this[107436]`(byte 429744) / top `_this[107437]`(byte 429748)。
- **挂起请求队列**：`_this + 173106`（`_DWORD*` 下标 → 实际 byte 692424，256 槽）；`_this[124350]`(byte 497400)=派发中重入标志。

---

## 1. `exit` (0x2) → `sub_41A820`  [raw 25629–25701, 74 行]

### 伪代码
```c
void sub_41A820(int _this) {
  v2 = *(_this + 120*cur + 383180);          // 本帧返回目标（frame.caller）
  _this[383108] = v2;                        // call_ret = v2
  if (v2 < 0) {
    if (v2 == -11) {                         // ★ 哨兵：存档版本
      v3 = config.get(...); _this[383108]=-1;
      v4 = config.get(...);
      v5 = config.get("setSaveVersion", v4);
      sub_40F750(_this, v5, "setSaveVersion_0"); return;   // 保存版本分支
    }
    if (v2 == -10) {                         // ★ 哨兵：续跑/重置
      v6 = 15 * _this[383112];
      _this[383104] = _this[383112];         // cur = _this[383112]（恢复目标帧）
      _this[8*v6+383220] = 0;
      v7 = _this[383116] | (effect_flags & 0x4000);
      _this[497400]=0; _this[699204]=v7 & 0xFFDFFFFF;       // 清部分位
      if (_this[497380] < _this[497384] && _this[497384]-_this[497380]>0)
        sub_40FB60(_this);                   // 派发排队脚本
      return;
    }
LABEL_14:
    _CxxThrowException(2, Command_Exit);     // 其它负值 → 程序退出
  }
  if (v2 + 1 == cur) sub_40EA00(_this, *(void**)(_this+383104));  // 退一层时释帧
  v10 = 15 * _this[383108];
  _this[383104] = _this[383108];             // cur = call_ret（回调用层）
  if (!*(_this + 8*v10 + 383124)) {          // 该层无效 → 向上找有效层
    do { v11=cur; if (v11<0) break; cur=v11-1; } while (!*(_this + 120*v12 + 383124));
  }
  if (cur < 0) goto LABEL_14;                // 找到顶仍无效 → 程序退出
  if (_this[667852] > cur) _this[667852] = -1;
  *(_this + 120*cur + 383216) = -1;          // 清库/有效槽
}
```

### 语义 / 状态
- **正常**：`cur = call_ret` 回退到调用层，向上跳过无「有效」位的空帧，清槽；若顶层也无有效帧 → 程序退出。 `[已实现]`：emulator `op_exit` 用 `frame.caller`，`caller>=0` 则 `cur=caller`、`jump(-1)`。
- **哨兵 -11**（存档版本）：`[未建模]`（emulator 一律按退出处理）。
- **哨兵 -10**（续跑重置）：`[未建模]`（emulator 一律按退出处理）。
- **其它负值**→`Command_Exit`：该行为在 `sub_412290` 主循环顶部 `GetMessage` 退出路径也出现；`[已实现]` emulator 抛 `ExitScript`。
- **关键字段/槽**：`call_ret`(0x5D884, confirmed)、`cur_script`(0x5D880)、`frame.caller`、`_this[383112/383116]`、`_this[667852]`、`_this[497380/497384/497400]`、`frame+0x50`(383216)。后三者 `[字段未知]`。
- **emulator 缺口**：`caller<0` 未区分 `-10/-11`（引擎这两者不是程序退出，而是续跑/存档处理）。

---

## 2. `call-script` (0x3) → `sub_41C6A0`  [raw 26762–26800, 40 行]

### 伪代码
```c
int sub_41C6A0(int _this) {
  _this[120*cur+383220] = 3;                 // 帧状态/长度槽 = 3
  if (cur >= 39) {                           // ★ 深度门（40 帧，index 0..39）
    sprintf(_this+8, "ファイルの階層が深すぎます．最大は%dです．", 40);
    _CxxThrowException(..., ShowMessage);    // 弹错误消息
  }
  v3 = readIntOperand(_this, 1);             // op1 = 目标脚本索引
  v4 = _this + 120*cur;                      // 当前帧基
  v5 = (v4[95782] - v4[95781]) >> 2;         // ★ 当前指令字节长 /4（返回位置）
  v4[95804] = v5;                            // 存 frame[95804]（=120*cur+383216）
  v6 = cur;
  _this[383108] = v6;                        // call_ret = cur（保存返回层）
  _this[383104] = v6 + 1;                    // cur = cur+1（压帧）
  result = sub_40ED40(_this, v5, *(_this+387924), v3);  // 装载目标脚本帧
  if (!result) _CxxThrowException(2, Command_Exit);     // 装载失败 → 程序退出
  return result;
}
```

### 语义 / 状态
- 深度门 `cur>=39` 弹「文件层级太深」错误（最大 40）。 `[已实现]`：emulator `if (c.e.cur >= 39) throw`。
- 读 op1=脚本索引；**保存返回位置**为当前指令长(`v5`)；`call_ret=cur`；`cur=cur+1`；`sub_40ED40` 装载新帧。 `[已实现]`：emulator 用 `frame.ip+=1` + `callRet=caller` + `cur=caller+1` + `loadScriptIntoFrame`（下标 vs 字节长，抽象等价）。
- **被调**：`loadScriptFrame_40ED40`（`sub_40ED40`，PARTIAL）——核心装载函数，另见 call 与 exit-script。 `[部分实现]` emulator 有 `loadScriptIntoFrame`。
- **emulator 缺口**：`sub_40ED40` 的完整装载/局部池重建/版本校验逻辑 emulator 未全复刻（见 `functions.json sub_40ED40`）。

---

## 3. `ret` (0x5) → `sub_41A9B0`  [raw 25704–25727, 25 行]

### 伪代码
```c
int sub_41A9B0(_DWORD *_this) {
  _this[120*cur+383220] = 1;                 // 帧状态槽 = 1
  --_this[cur + 97153];                      // 每帧返回栈顶指针 -1（基址 byte 388612+4*cur）
  result = cur;
  v2 = _this[256*result + 97193 + _this[result+97153]];  // 弹返回地址（每帧 256 槽）
  if (v2 != -1) {                            // 栈非空
    _this[120*result + 95782] = _this[120*result+95781] + 4*v2;  // 帧 ip = 帧基 + 4*返回目标
    _this[120*cur+383220] = 0;               // 清帧状态槽
    result = _this[107437];                  // effect_flags 保存栈 top
    if (result >= 0) {
      v3 = *(_this[107436] + 4*result--);    // 弹回
      _this[107437] = result;
      _this[174801] = v3;                    // effect_flags = 弹出值
    }
  }
  return result;                             // 栈空(v2==-1) → no-op 落下一句
}
```

### 语义 / 状态
- **同脚本子程序返回**：弹每帧返回栈；命中则回跳（`帧ip=帧基+4*目标`），并**恢复 `effect_flags`（从全局保存栈 `_this[107436/107437]`）**；栈空则 no-op。 `[已实现]`：emulator `op_ret` pop `retStack` → `jump(top)`，栈空 no-op。
- **emulator 缺口**：未做 `effect_flags` 保存栈的弹回（引擎的 `call`(0x8F) 压帧时也压 `effect_flags`；emulator `op_call` 只压 `ip+1`）。 `[未建模]`。
- **关键字段**：`effect_flags`(0xAAB44)、`_this[107436/107437]`、每帧返回栈（`byte 388612`/`1024*cur+388772`）。返回栈区 `[字段未知]`（`sub_40DF10` 曾 memset 388612 0xA0）。

---

## 4. `exit-script` (0x9) → `sub_428A60`  [raw 35171–35321, 151 行]

### 伪代码（分块）
```c
int sub_428A60(int _this) {
  (*(_this+676732))();                       // 回调（自定义钩子）          [逻辑未知]
  _this[387932] = 0;                          // 清标志                     [逻辑未知]
  for (i=0;i<40;++i) sub_40EA00(_this, i);    // ★ 释放全部 40 帧            [部分实现] emulator 清 frames[]
  v3 = config.get("setEnableMemFl") != 0 + 1; // memflip 相位
  if (v3 > 0) {
    // 内存池清理：多处 memset(指针池, 0, count*4+4) + 复制/清空（若干 DWORD 池）
    // 涉及 _this+382984 起的 v4 结构（382952/382956/382960/382964/382968/382972 计数等） [平台无关/字段未知]
  }
  if (_this[699244] < 0) SendMessageA(hwnd, 0x1400, 1, 1);  // 解锁消息    [平台无关]
  _this[699244] = 0;
  sub_478090(_this+1032, _this+699208);       // flush 输入
  sub_40DF10(_this);                          // ★ 引擎整体复位（见 engine-reset-mainloop.md）
  _this[667856] = config.get("setDrawMode");  // draw-mode = 配置
  sub_403EF0(_this+51904); sub_403EF0(_this+21976); sub_437440(_this+20764);  // 释放对象
  if (config "setCreateObject" & 1) {         // 窗口尺寸复制到一堆槽（12388..12472）
    ... _this[16112/16116/16104/16108]=...(16000/16004/15996/15992) ... [字段未知]
  }
  if ((config "setCreateObject" & 2) && (config "setAutoFreeTex" & 1))
    for(k=0;k<1000;++k) sub_49E980(_this+322832, k);   // 释放纹理
  result = sub_40ED40(_this, v27, *(_this+387924), 0); // ★ 重载根脚本 INDEX0
  if (!result) _CxxThrowException(2, Command_Exit);
  return result;
}
```

### 语义 / 状态
- **全量 teardown → 回根**：释放 40 帧 → 清内存池 → flush 输入 → `sub_40DF10`（引擎整体复位）→ 释放对象 → 按配置复制窗口尺寸/释放纹理 → **重载根脚本 index 0**（`sub_40ED40(0, …)`）。 `[已实现]`（抽象）：emulator `op_exit_script` 清 40 帧 + 全局数组 + `cur=0` + `callRet=-1` + `effectFlags=0` + `throw ScriptReset`。
- **emulator 缺口**：
  - 引擎**重载根脚本 0 并继续跑**；emulator 停在 `ScriptReset`（由上层 `run` 捕获停止）。 `[未建模]`（若要在 reset 后继续，须仿引擎重载 index 0 + 循环）。
  - `sub_40DF10`（整体复位）、内存池/memflip、对象/纹理释放、`_this+676732` 回调 → `[平台无关/未建模]`。
- **关键字段**：`cur`、`call_ret`、`draw-mode`(0xA30D0)、`_this[387932]`、`_this[699244]`、`_this[497380/497384]`、`sub_40ED40`（重载）。

---

## 5. `jmp` (0x8C) → `sub_4203D0`  [raw 29389–29402, 15 行]

### 伪代码
```c
int sub_4203D0(_DWORD *_this) {
  _this[120*cur+383220] = 3;                 // 帧状态槽 = 3
  result = readIntOperand(_this, 1);         // op1 = label 目标
  if (result != -1) {                        // 0xFFFFFFFF 则不跳（落下）
    _this[120*cur+95782] = _this[120*cur+95781] + 4*readIntOperand(_this,1);
    result = cur; _this[120*cur+383220] = 0; // 清帧状态槽
  }
  return result;
}
```

### 语义 / 状态
- **无条件跳**：op1≠-1 则 `帧ip = 帧基 + 4*op1`（绝对 label 定位），不入返回栈；op1==0xFFFFFFFF 则落下。 `[已实现]`：emulator `op_jmp` 用 `readIntOperand(op1)` 取值，`op1==-1` 则 return（不跳）、否则 `labelPos→jump`。
- **修正记录**：原 emulator `op_jmp` 对 `labelPos(0xffffffff)→null` 直接**抛错**，而引擎视 `jmp -1` 为落下句（no-op）——已修为与 jcc/call 一致的 `-1 落下` 语义；同时 op1 改经 `readIntOperand` 取值（支持变量 label）。 `[已修正]`

---

## 6. `jcc` (0xA0) → `sub_4209B0`  [raw 29615–29639, 26 行]

### 伪代码
```c
int sub_4209B0(_DWORD *_this) {
  _this[120*cur+383220] = 7;                 // 帧状态槽 = 7
  if (readIntOperand(_this, 1)) {            // 条件真
    result = readIntOperand(_this, 2);       // op2（真分支目标）
    if (result == -1) return result;         // 0xFFFFFFFF → 落下
    v3 = readIntOperand(_this, 2);
  } else {                                   // 条件假
    result = readIntOperand(_this, 3);       // op3（假分支目标）
    if (result == -1) return result;
    v3 = readIntOperand(_this, 3);
  }
  _this[120*cur+95782] = _this[120*cur+95781] + 4*v3;  // 帧ip = 帧基 + 4*目标
  result = cur; _this[120*cur+383220] = 0;   // 清帧状态槽
  return result;
}
```

### 语义 / 状态
- **两目标条件跳**：`op1`（readIntOperand，非0=真）为条件；真→跳 `op2`，假→跳 `op3`；`op2/op3` 经 `readIntOperand` 取值，`==-1(0xFFFFFFFF)` 则落下句。 `[已实现]`：emulator `op_jcc`。
- **修正记录**：原 emulator `op_jcc` 的 `op2/op3` 直接用立即数 `args[i].raw`，与引擎经 `readIntOperand` 取值得不一致（引擎可为变量 label）；已修为 `readIntOperand` + `-1 落下`。 `[已修正]`。

---

## 7. `i143` (0x143) → `sub_41A000`  [raw 25168–25191, 25 行]

### 伪代码
```c
void sub_41A000(_DWORD *_this) {
  _this[120*cur+383220] = 1;                 // 帧状态槽 = 1
  _this[124350] = 1;                         // ★ 派发中（防重入）标志 = 1（byte 497400）
  v3 = _this + 173106;                       // 请求槽队列（_DWORD* 下标 → byte 692424）
  v2 = 1;
  do {
    if (*v3) sub_40FC90(_this, v2 << 24);    // 非零槽 → 以 slot<<24 为目标 queueScript
    ++v2; ++v3;
  } while (v2 < 256);                        // 遍历 256 槽
  v4 = cur;
  _this[124350] = 0;                         // 清派发标志
  _this[120*v4+383220] = 0; _this[120*cur+95782] += 4;  // 清状态槽 + 帧ip += 4(1 dword)
  sub_40FB60(_this);                         // ★ 派发已排队脚本
}
```

### 语义 / 状态
- **派发挂起脚本/事件请求**：置防重入标志 → 遍历 256 个请求槽，非零者以 `slot<<24` 排队（`sub_40FC90`）→ 清标志、帧ip+=4 → `sub_40FB60` 真正派发。 `[未建模]`：emulator `0x143` 映射为 `op_engine_internal`（纯 no-op），未实现派发逻辑。
- **联动**：与主循环 `sub_412290` 的 `0x4000000`（跳转/call 待处理，`sub_40FB60` 派发）+ `exit(0x2)` 的 `-10` 哨兵（也调 `sub_40FB60`）+ `_this[124350]`（`exit-script` 里清 0）强相关。 `[未建模]`。
- **关键字段**：`_this[124350]`(byte 497400)、请求队列 `_this+173106`，均 `[字段未知/未建模]`。

---

## 8. emulator 对照汇总 & 实现缺口

| 指令 | handler | 引擎语义 | emulator | 缺口（后续实现需补） |
|---|---|---|---|---|
| `exit` 0x2 | sub_41A820 | 跨帧返回调用层；`caller<0` 有 `-10/-11` 哨兵 | `op_exit`（caller>=0 回退；否则抛 ExitScript） | **未区分 -10/-11**（续跑/存档处理） |
| `call-script` 0x3 | sub_41C6A0 | 深度门 39 + 存返回长 + 压帧 + 装载 | `op_call_script`（深度门 39、ip+1、loadScriptIntoFrame） | `sub_40ED40` 完整装载未复刻（局部池/校验） |
| `ret` 0x5 | sub_41A9B0 | 弹每帧返回栈 + **恢复 effect_flags** | `op_ret`（pop retStack→jump；栈空 no-op） | **未恢复 effect_flags** 保存栈 |
| `exit-script` 0x9 | sub_428A60 | 全量 teardown + `sub_40DF10` 复位 + `_this[387932]=0` + 重载根脚本 0 | `op_exit_script`（**已修正**） | 已对齐：重置+`+96983=0`+`readScript(0)` 重载根并 `jump(0)` 继续（不再停在 reset）→ GAMEOVER 回标题 |
| `jmp` 0x8C | sub_4203D0 | 无条件跳；op1==-1 落下 | `op_jmp`（**已修正**） | 已对齐：`readIntOperand` 取 op1 + `-1 落下`（原对 +0xFFFFFFFF 抛错） |
| `jcc` 0xA0 | sub_4209B0 | 两目标条件跳 | `op_jcc`（**已修正**） | 已对齐：分支目标(2/3)经 `readIntOperand` + `-1 落下`（原用立即数 `args[i].raw`） |
| `i143` 0x143 | sub_41A000 | 派发挂起脚本/事件请求 | `op_engine_internal`（no-op） | **完全未实现**（排队+派发 + `_this[124350]` 重入） |

> 已修正：**`jmp`(0x8C) / `jcc`(0xA0)** 已按引擎改为「经 `readIntOperand` 取分支目标 + `-1 落下`」（见 §9）。
> 仍待补的缺口（风险集中）：**① `i143` 0x143 的派发**（emulator 是 no-op，且与主循环 `0x4000000` / `exit -10` 联动）；**② `exit-script` 0x9 的重载根脚本 0**（emulator 停在 reset，行为与引擎不同）；**③ `ret` 的 effect_flags 保存栈恢复**；**④ `exit` 的 -10/-11 哨兵**。

---

## 9. emulator 模型评估与修正记录

### 9.1 评估结论（正确性）
| 指令 | emulator 模型 | 判定 |
|---|---|---|
| `exit` 0x2 | `op_exit`（caller>=0 回退；否则抛 ExitScript） | **正常路径正确**；仅缺 `-10/-11` 哨兵（引擎内部存档/续跑用，非脚本常规路径） |
| `call-script` 0x3 | `op_call_script`（深度门 39、ip+1、loadScriptIntoFrame） | **正确**（抽象等价） |
| `ret` 0x5 | `op_ret`（pop retStack→jump；栈空 no-op） | **主逻辑正确**；缺 `effect_flags` 保存栈恢复 |
| `exit-script` 0x9 | `op_exit_script` | **已修正**：改为「置 `+96983`=0 + 重载根脚本 0 并继续」（不再停在 reset）→ 支撑 GAMEOVER 回标题 |
| `jmp` 0x8C | `op_jmp` | **原错误**：对 `+0xFFFFFFFF` 抛错（引擎是落下）→ 已修 |
| `jcc` 0xA0 | `op_jcc` | **原部分不精确**：分支目标用立即数 → 已改 `readIntOperand` |
| `i143` 0x143 | `op_engine_internal`（no-op） | **未实现**（派发逻辑缺失）→ 已记为待补 |

### 9.2 已应用的修改（`app/amayui-emulator/src/vm/ops.ts`）
```ts
// op_jmp：引擎 sub_4203D0——op1 经 readIntOperand 取值；==-1(0xFFFFFFFF) 不跳（落下），非错误。
const op_jmp: OpHandler = (c) => {
  const t = readIntOperand(c.e, c.frame, c.instr, 1);
  if (t === -1) return;
  const p = labelPos(c.frame, t);
  if (p === null) throw new Error(`jmp: unknown label 0x${(t >>> 0).toString(16)}`);
  c.jump(p);
};

// op_jcc：引擎 sub_4209B0——分支目标(2/3)亦经 readIntOperand 取值；==-1 落下句。
const op_jcc: OpHandler = (c) => {
  const cond = readIntOperand(c.e, c.frame, c.instr, 1);
  const branchLab = (n: number) => { const t = readIntOperand(c.e, c.frame, c.instr, n); return t === -1 ? null : t; };
  if (cond !== 0) {
    const t = branchLab(2);
    if (t !== null) { const p = labelPos(c.frame, t); if (p === null) throw new Error(`jcc: unknown true label 0x${(t>>>0).toString(16)}`); c.jump(p); }
  } else {
    const t = branchLab(3);
    if (t !== null) { const p = labelPos(c.frame, t); if (p === null) throw new Error(`jcc: unknown false label 0x${(t>>>0).toString(16)}`); c.jump(p); }
  }
};
```
> 这两处改动与既有 `op_call`/`op_jcc` 的 `0xFFFFFFFF` 处理方式一致（同用 `readIntOperand` + `-1` 哨兵）。`tsc --noEmit` 通过、`npm test` 24/24 通过（含新增 exit-script/load-show-logo 用例）。

`op_exit_script`（第 2 处修正，支撑 GAMEOVER → 回标题）：
```ts
// op_exit_script：引擎 sub_428A60——清理 → 置 _this[96983]=0 → 重载根脚本 INDEX0 并继续（不再抛 ScriptReset）。
const op_exit_script: OpHandler = async (c) => {
  // …清 40 帧 + 全局数组 + cur/callRet/callLink/callFlag/effectFlags/advFields/globalSlot…
  c.e.engineValues.set(96983, 0);            // ★ +96983=0 → 回标题后 load-show-logo 读 0 → SYSTEM4 跳过 LOGO
  const boot = await c.e.fileSource!.readScript(0);   // 重载根脚本 0（SYSTEM4）
  loadScriptIntoFrame(c.e.frames[0]!, parseScriptBytes(boot.data), boot.name);
  c.e.cur = 0; c.jump(0);                    // 控制流重定位到新根帧 ip0，继续跑
};
```
详见 §10（load-show-logo / +96983 机制与 GAMEOVER→标题链路）。

### 9.3 未改动项（需后续决策）
- **`i143` 派发（仍未实现）**：已定位其真源——`sub_41A000` 遍历**请求寄存器**`_this + 173106`（`_DWORD*` → byte 692424，256 槽），对每非零槽 `queueScript(slot<<24)`（`sub_40FC90`）；`sub_40FC90` 经 `sub_409E10(_this+124343, a2)`（byte 497372）写入**派发队列**，`sub_40FB60`（byte 队列下标 497380/497384/497376，进程标志 `_this[124350]`=byte 497400）弹出并派发（正请求 loading 到 frame 37、负请求走 `-10` 哨兵）。**写入请求寄存器/派发队列的调用点尚未全部定位**（`sub_40FC90` 被 `sub_41A000`/line19943/20976 等调用），故暂不贸然实现；实现时建议与 `exit(0x2)` `-10` 哨兵、主循环 `0x4000000` 一并处理。
- **`ret` 的 effect_flags 恢复**：引擎 `sub_41A9B0` 从 `_this[107436/107437]` 弹回 `effect_flags`；但其「压入方」尚需确证（`call` 0x8F 只压返回地址），不贸然建模。
- **`exit` 的 -10/-11**：应视为「续跑重置 / 存档版本」而非程序退出；需在明确 save/continue 子系统后再细化。

---

## 10. `load-show-logo`(0x130) / `+96983`（LOGO 开关）与「GAMEOVER → 回标题」链路

### 10.1 字段 `_this[96983]`（byte 387932 = `0x5EB5C`）
- **语义**：LOGO/版权页开关。构造=1 → 播放；exit-script=0 → 跳过。
- **写点**：
  - `sub_415640`（引擎初始化/构造）`*(_this + 387932) = 1`（raw 22589）。
  - `sub_428A60`（exit-script 0x9）`*(_this + 387932) = 0`（raw 35207）。
- **读点**：`sub_42F7A0`（指令 0x130/load-show-logo）`writeIntOperand(op1, _this[96983])`（raw 39346）。

### 10.2 SYSTEM4 的 LOGO 判定
```
load-show-logo (local-int 2)                     // op2 = _this[96983]
jcc (local-int 2) ffffffff label_00000b38      // local-int2≠0 → 落下（播 LOGO）；==0 → 跳到 b38（跳过 LOGO）
call-script 5262  // LOGO
label_00000b38
call-script 5263  // INIT
call-script 5264  // TITLE
```
（`src/SYSTEM4.txt` 144–150。）首启构造 `96983=1` → load-show-logo 读 1 → jcc 落下 → 播 LOGO；GAMEOVER 后经 exit-script 把 `96983` 置 0 → 重载 SYSTEM4 → load-show-logo 读 0 → jcc 跳 b38 → **不再重播版权页**，直接 INIT→TITLE。这正是「GAMEOVER 依赖 exit-script 回标题」的机制。

### 10.3 emulator 修正
`op_exit_script`（0x9）现为 `async`：清 40 帧/全局/引擎态 → **`engineValues.set(96983, 0)`** → `fileSource.readScript(0)` 重载根脚本 SYSTEM4 → `cur=0`、`jump(0)` **继续跑**（不再 `throw ScriptReset` 停在 reset）。`load-show-logo` 读 `engineValues.get(96983)??0`（首启默认 `[[96983,1]]`，exit-script 后为 0）。`test/exit-script.test.ts` 3 例覆盖：load-show-logo 读 1/读 0、exit-script 重载根+96983=0、组合「回标题不再播 LOGO」。

---

## 参考
- `analysis/functions.json`：`sub_41A820`(0x2)/`sub_41C6A0`(0x3)/`sub_41A9B0`(0x5)/`sub_428A60`(0x9)/`sub_4203D0`(0x8C)/`sub_4209B0`(0xA0)/`sub_41A000`(0x143)/`sub_42F7A0`(0x130)，及 `readIntOperand_41BF50`、`loadScriptFrame_40ED40`。
- `analysis/fields.json`：`cur_script`(0x5D880)、`call_ret`(0x5D884)、`effect_flags`(0xAAB44)、`engine_bool_flag`(0xA30D4)、`logo_enabled`(0x5EB5C)。
- `docs-new/03-engine/opcode-table.md`：0x2/0x3/0x5/0x9/0x8C/0xA0/0x130/0x143。
- `docs-new/03-engine/engine-reset-mainloop.md`：`sub_40DF10`（被 `exit-script` 调用）与 `sub_412290`（主循环，`0x4000000`/`0x2400` 与派发/推进联动）。
- emulator：`app/amayui-emulator/src/vm/ops.ts`（含 `op_exit_script` 修正）、`test/exit-script.test.ts`。
