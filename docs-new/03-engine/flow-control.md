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
- **消息回调 effect_flags 保存栈**：`Stack_int` 对象 @ byte `429732`=`0x68EA4`，base `_this[107436]`(byte `429744`=`0x68EB0`) / top `_this[107437]`(byte `429748`=`0x68EB4`)。压入=`sub_409D40`、弹出=`sub_41A520`/ret 内联；压入方 `sub_411590`（`effect_flags&0x100000` 消息回调派发）。
- **挂起请求队列**：`_this + 173106`（`_DWORD*` 下标 → 实际 byte 692424，256 槽）；`_this[124350]`(byte 497400)=派发中重入标志。
- **「调用预加载帧」= opcode 0x8 (`sub_41C900`, `call-frame <帧号>`, 曾名 `i008`)**：save `cur→call_ret`；`cur=帧号`；要求帧已预装（`*(frame+383124)!=0`）否则抛「ファイルが読み込まれていません」；设目标帧 `caller=call_ret`、`ip=帧起始`。被调帧跑完 `exit(0x2)` 依其 caller 返回调用帧。这与 `call-script`(压 cur+1) 不同——`call-frame` 切到**已预装的固定帧**。SYSTEM4 `load-frame`(0x6, 曾名 `i006`) 预装的帧由 `call-frame` 启动。

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
- **同脚本子程序返回**：弹每帧返回栈（`byte 388612` 计数 + `1024*cur+388772` 数据）；命中则回跳（`帧ip=帧基+4*目标`），并**恢复 `effect_flags`（从消息回调保存栈 `Stack_int@0x68EA4`，base=`_this[107436]`=0x68EB0、top=`_this[107437]`=0x68EB4）**；栈空则 no-op。 `[已实现]`：emulator `op_ret` pop `retStack` → `jump(top)`，栈空 no-op。
- **★ 已解出 flag 逻辑（此前 gap）**：effect_flags 保存栈**不是** `call`(0x8F) 压入（`call` 只压每帧返回栈）。**压入方 = `sub_409D40(_this+429732, effect_flags)`，在 `sub_411590`（主循环 `effect_flags&0x100000` 触发的消息/文本回调派发器）进入文本回调前压入，并 `effect_flags&=0x7FEFFFFF`**；回调脚本执行 `ret(0x5)` 时弹回恢复。即 `ret` 的 flag 恢复与**消息回调**配对（0x100000 = 文本回调进行中标记）。同类：`sub_41F790`(opcode 0x84) 也操作同一 `Stack_int`。 `[已确认]`（data layer：`msg_cb_flag_stack_base/top`、`sub_409D40`、`sub_41A520`、`sub_411590`、`sub_41F790`）。
  > 🔒 **记录背景（待后续实现再改）**：本 flag 逻辑属「消息/文本回调系统」(ADV/文字窗子系统)。当前 emulator 不实现该系统，故**仅记录，不修改**；待后续实现消息/文本回调 / `sub_411590`-等价路径时，再补 emulator 的 `msgCbFlagStack`（`op_call_script` 或等价路径压入、`op_ret` 弹出）。
- **emulator 缺口**：`op_ret` 未做该 `Stack_int` 的弹回（仅在消息回调场景触发；如需对齐可加 `msgCbFlagStack` 建模，并在 `op_call_script`/`sub_411590` 等价路径压入）。 `[未建模]`。

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
- **派发挂起脚本/事件请求**：置派发中标志(`_this[124350]`) → 遍历 256 个请求寄存器槽(`_this+173106`) ，非零槽以 `slot<<24` `queueScript`(`sub_40FC90`) → 清标志、帧ip+=4 → `dispatchQueuedScripts`(`sub_40FB60`) 真正弹出派发。 `[未建模]`：emulator `0x143` → `op_engine_internal`(no-op)。
- **完整派发链**：`request_register(0xA90C8)` → `queueScript(40FC90)` 入队 `dispatch_queue(Queue_int@0x796DC)`（`sub_409E10` 入队）→ `dispatchQueuedScripts(40FB60)` 弹出：保存 `cur→_this[383112]`、`effect_flags→_this[383116]`、`call_ret=-10`、`effect_flags=0`；**正请求(资源id≥0) → `cur=37` 预占帧装载脚本**；**负请求 → `cur=-v2` 恢复某帧**。预占脚本跑完 `exit(0x2)` 的 `-10` 哨兵 → 恢复 `cur/effect_flags` 并继续派发。 `[已确认]`（data layer：`dispatch_queue`/`dispatch_in_progress`/`request_register`/`dispatch_saved_cur`/`dispatch_saved_effect_flags`、`sub_40FB60`/`sub_40FC90`/`sub_409E10`）。
- **★ 消耗侧语义**：i143 **不是生产侧**，是派发**消耗/触发**侧。它先置 `dispatch_in_progress`，故循环内的 `queueScript` 只入队不派发；随后 `sub_40FB60` **一次只派发一条**（正请求装入帧 37），其余经 **`-10` 哨兵链**逐条顺次派发（每条任务 exit → -10 分支 `read<write` 时再 `sub_40FB60`）——**不是一次性把全部装入帧 37**。且 i143 **不清**请求寄存器槽（只读）。
- **★ 与 frames 高位/抢占执行的关系**：派发把脚本装进**帧 37**（正请求）或恢复帧 `-v2`（负请求）——帧 37 属 frames 30–39 高位区。**opcode 0x6（`sub_41C7C0`, load-frame）会直接「抢占」把脚本装进指定帧（备份/恢复 `cur`）**，SYSTEM4 帧布局初始化用；这正是「指令直接抢占加载执行」的机制，与 i143 的预占帧派发同源。 `[已确认]`（`sub_41C7C0`）。
- **★ 预加载帧的「调用点」= opcode 0x8（`sub_41C900`, `call-frame <帧号>`, 曾名 `i008`）**：把 `cur` 切到预加载帧（要求已预装），设 caller=调用帧，跑完 `exit` 返回。SYSTEM4 `load-frame`(0x6) 预装的 `DRAWTOOLTIP(26)/DRAWORN(28)/ATSEEK(29)/SETROUTE(30)/MVSEEK(31)` 正是由游戏脚本 `call-frame 1a/1c/1d/1e/1f` 启动（FIELD/ALLMAP/FELLOW/ALCHEMY/MOVERUIN/RTN_M002 等）。即**预装帧的直接启动路径是 `call-frame`，而非负派发**；负派发(恢复帧)是另一条"抢占/延迟"路径。
- **★ SYSTEM4 load-frame(0x6) 预装清单**（`src/SYSTEM4.txt` 113–117，均预装不进执行、按需启动）：`0x5106`=DRAWTOOLTIP.BIN→帧26(0x1A)、`0x525A`=DRAWORN.BIN→帧28(0x1C)、`0x525B`=ATSEEK.BIN→帧29(0x1D)、`0x525C`=SETROUTE.BIN→帧30(0x1E)、`0x525D`=MVSEEK.BIN→帧31(0x1F)。这些为游戏过程“随取随用”的行为/战术脚本（提示绘制/装饰绘制/寻路/设路线/移动寻路），**由游戏脚本 `call-frame <帧号>` 直接启动**（负派发是另一条抢占/延迟路径）。
- **联动**：与主循环 `sub_412290` 的 `0x4000000`（跳转/call 待处理，也走 `sub_40FB60`）+ `exit(0x2)` 的 `-10` 哨兵 + `exit-script` 清 `_this[124350]` 强相关。 `[部分]`。
- **关键字段**：`dispatch_in_progress`(0x796F8)、`dispatch_queue`(0x796DC)、`request_register`(0xA90C4 基址，槽1=0xA90C8)、`dispatch_saved_cur/effect_flags`(0x5D888/0x5D88C)。

---

## 8. emulator 对照汇总 & 实现缺口

| 指令 | handler | 引擎语义 | emulator | 缺口（后续实现需补） |
|---|---|---|---|---|
| `exit` 0x2 | sub_41A820 | 跨帧返回调用层；`caller<0` 有 `-10/-11` 哨兵 | `op_exit`（caller>=0 回退；否则抛 ExitScript） | **未区分 -10/-11**（续跑/存档处理） |
| `call-script` 0x3 | sub_41C6A0 | 深度门 39 + 存返回长 + 压帧 + 装载 | `op_call_script`（深度门 39、ip+1、loadScriptIntoFrame） | `sub_40ED40` 完整装载未复刻（局部池/校验） |
| `ret` 0x5 | sub_41A9B0 | 弹每帧返回栈 + **恢复 effect_flags** | `op_ret`（pop retStack→jump；栈空 no-op） | 压入方已解出（`sub_411590`/`sub_409D40` 消息回调栈）；emulator 仍未实现该弹回 |
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
| `ret` 0x5 | `op_ret`（pop retStack→jump；栈空 no-op） | **主逻辑正确**；flag 恢复已解出压入方（消息回调 `Stack_int`），emulator 未实现该弹回 |
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
- **`ret` 的 effect_flags 恢复（压入方已确证）**：`Stack_int@0x68EA4`（base 0x68EB0 / top 0x68EB4），压入方 = `sub_409D40`（在 `sub_411590` 消息回调派发、`effect_flags&0x100000` 时压入并 `&=0x7FEFFFFF`），`ret(0x5)` 弹回。**emulator 仍未实现**该弹回（`op_ret` 只弹 `retStack`）；仅在消息回调场景触发，若要完整复刻需在 `op_call_script`/消息回调等价路径建模该 Stack_int。
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

---

## 11. 流程控制体系建模（总览 + 分析/未分析清单）

### 11.1 帧模型（"地址空间"）
- `frames[40]`（每帧 120 字节/0x78）；`cur`=当前帧；`call_ret`=暂存"返回目标"。
- 帧内槽：`caller`(383180)、`arg`(383184)、`instr-buf`(383124)、`ip/opcode`(383128)、`state`(383220)、`valid`(383120?)。
- 每帧**独立数组**：返回栈 `count(388612)`/`data(388772,256槽)`、返回地址槽 `489488/489648`。

### 11.2 五类"调用 / 延续"
| 方式 | opcode | 机制 | 返回 |
|---|---|---|---|
| call-script | 0x3 | 压 `cur+1`、加载新脚本（跨脚本嵌套；深度门39） | `exit(0x2)` |
| call | 0x8F | 同脚本子程序：压返回地址到每帧返回栈、跳 label | `ret(0x5)` |
| call-frame | 0x8 | 切到**预加载帧**（固定帧号，要求已预装） | `exit(0x2)` |
| load-frame | 0x6 | 预装脚本进指定帧（备份/恢复 cur，**不执行**） | —— |
| **wait→协程续点** | 0x72/0xFA → 0x7C | **单帧**：`sub_411BC0`(负ef转接) 保存 `ip→489812`/`ef→489808`/`深度→430712` 并跳 `4*cur+489488` 续点；处理完 **`local-ret`(0x7C)** 恢复 | `local-ret`=**"续点 ret"** |

### 11.3 三类"返回"
| 方式 | opcode | 机制 |
|---|---|---|
| exit | 0x2 | 跨脚本返回 `cur=caller`；哨兵 **-10**(派发恢复)/**-11**(存档版本)/其它负(程序退出) |
| ret | 0x5 | 同脚本返回：弹每帧返回栈→跳；恢复 msg-callback `effect_flags` 栈 |
| exit-script | 0x9 | 全量 teardown + `sub_40DF10` 复位 + 置 `_this[96983]=0` + 重载根脚本0 |

### 11.4 跳转
- `jmp`(0x8C)=无条件（-1 落下）；`jcc`(0xA0)=两目标条件跳；`menu-dispatch`(0xA3)=key→label 哈希跳；**输入派发**(0xCC/0xFB/0xCD/0x100/0x101)=输入→回调目标。

### 11.5 异步/延迟派发
- `i143`(0x143)=**消费侧**：扫 `request_register(0xA90C4 基址)`→`queueScript(40FC90)` 入 `dispatch_queue(0x796DC)`→`dispatchQueuedScripts(40FB60)` 弹出一条（正→帧37装载 / 负→恢复帧）。`-10` 哨兵链逐条派发；`0x1F5`(帧倒计)/`0x7C`(嵌套返回+一次性派发)/`exit -10`/`queueScript` 均为派发触发点。

### 11.6 预装帧协作
- SYSTEM4 `load-frame`(0x6) 预装 `DRAWTOOLTIP(26)/DRAWORN(28)/ATSEEK(29)/SETROUTE(30)/MVSEEK(31)` → 游戏脚本 `call-frame <帧号>`(0x8) 调用 → 跑完 `exit` 返回调用帧。**`0xAE` 是「存档续档」机制**（读存档版本、续档回到存档时活跃脚本帧、或载入对应场景脚本），**与预装帧无关**。

### 11.7 分析状态 / 未分析清单
| 项 | 状态 | 缺口 |
|---|---|---|
| exit(0x2)/call-script(0x3)/ret(0x5)/exit-script(0x9)/jmp(0x8C)/jcc(0xA0)/call-frame(0x8)/i143(0x143) | 已读体确证 | —— |
| call(0x8F) | 已读体确证（本表新增，入数据层） | 返回地址编码 `((ip-start)>>2+3)` 精确语义 |
| 0xAE(版本分支) | 已读体（**已定性=存档续档**） | 目标帧=存档时活跃场景脚本帧（快照 `_this[140457]/[151210]/[129624]` 首字段，由 `sub_40CD10` 一族存档时写入）；**与预装帧 26/28–31 无关**；快照写入方/存档流程未全展开 |
| `sub_40EA00`(release frame) | **未建模** | 帧释放/复用生命周期 |
| `sub_410160`(save-version load, 置 -11) | **未建模** | save-version 装载体 |
| `0x14C`(set-agerc-export)/`0x14D`(call-agerc-export) | **推测/未读体** | 是否改变控制流 |
| `0x88`(消息模式) | 未读体 | 与消息/ADV 联动 |
| `request_register`(0xA90C4 基址，槽1=0xA90C8) 生产侧 | **未定位（结论定）** | 全引擎仅 2 处**读**引用（`i143` 扫槽1..255、`sub_476730` 探测槽 a1）；**无字面写入方**、构造/复位不 init → 生产侧走计算基址或外部/vtable(AGERC)路径，**静态不可定位**。`sub_476730` 无 C 内调用者（__stdcall，疑 vtable/导出）。`_this[3601+slot]` 属资源/文件访问，非本寄存器 |
| 负派发生产侧（主循环 `-v29`, `_this[430796]`） | **未定位** | `_this[430796]` 仅 reset 为 -1，无其它写入 → 疑非负请求来源 |
| `sub_41C7C0`(0x6) 预装载校验（`388236/388240`） | 未解 | 脚本 key/版本校验语义 |
| 帧 `arg`(383184)/帧设置细节（`sub_40ED40` 内） | 部分 | 局部池/`argc` 重建 |
| emulator 侧缺口 | 部分 | **`0x8`(call-frame)、`0x8F`(call)、`0xAE`、`i143` 派发、`0x6` 预装** 未实现（NotImplementedOp/engine-internal） |
