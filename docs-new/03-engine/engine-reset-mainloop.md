# 03-engine · `sub_40DF10`(engineInitReset) + `sub_412290`(mainLoop) 拆分分析与 emulator 实现状态对照

> 本文件对引擎**初始化/复位**函数 `sub_40DF10` 与**主循环**函数 `sub_412290` 做逐块拆分，输出**忠实于原始反编译**的伪代码，并在每一块/每个开关旁标注其在当前 `app/amayui-emulator` 中的实现状态，用于防止后续实现时遗漏大量开关控制。
>
> 分析源：`engine/天结_unpacked.exe_utf8.c`
> - `sub_40DF10`：raw **17933–18181**（252 行）
> - `sub_412290`：raw **20465–21237**（773 行，`__noreturn`）
>
> 依据约定：分析只读 raw（信息源）；emulator 是产物。本文件把「引擎真源」与「emulator 现状」对照，**不**把 emulator 当信息源。数据层结论见 `analysis/fields.json` / `analysis/functions.json`（本文件新增 `engine_bool_flag` 与 `sub_423C20/sub_430810/sub_40DF10/sub_412290` 四条）。

---

## 0. 状态图例（贯穿全文）

| 标记 | 含义 |
|---|---|
| `[已实现]` | 该块逻辑 emulator 已有对应建模（即使抽象重构，语义等价） |
| `[部分实现]` | emulator 只建模了该块的一个侧面，或有对应体但缺关键分支 |
| `[字段未知]` | 该偏移未进 `fields.json`，名字/语义未定（待后续逆向对号） |
| `[逻辑未知]` | 能读出这段在做什么，但具体语义/阈值/参数未确认 |
| `[平台无关/无需实现]` | Win32/DirectX/外部 DLL/子系统钩子等，emulator 不打算复刻（记录/跳过即可） |
| `[未建模]` | emulator 目前无对应逻辑，且**不是**平台无关（即：若要完整复刻须补） |
| `[模拟]`（仅用于伪代码行内） | 该行为 emulator 已用等效手段模拟（如 opcode 派发 vs `stepOnce`） |

> 偏移一律为**字节偏移**；`_this[K]`（`_DWORD*`）按 `K×4` 换算。如 `_this[166965]` = 字节 `667860` = `0xA30D4`（见本文件 Part A）。

---

## Part A · `sub_40DF10` —— 引擎初始化/复位

### A.1 总述
`sub_40DF10(Engine* this)` 是引擎对象的**整体复位**：零化/复位一大批状态字段（脚本深度、effect_flags、布尔标志、绘制模式、时间槽），销毁并重建若干子系统对象（文本/绘制/输入/队列/栈/电影/对象数组），并做若干全局配置读取。返回值是 `config.get("setOuterFrameMode")`。

它对应 emulator 里**两类**入口：
- **启动**：`run.ts main()` → `new Engine(native)`（`Engine` 构造函数建 `frames[40]`、`cur=0`）。
- **脚本级 teardown（部分等价）**：`op_exit_script(0x9)` → `op_exit_script` 里 `effectFlags=0`、`cur=0`、`callRet=-1` 等。

但注意：`sub_40DF10` 是**引擎级**复位（WinMain 启动时调用一次），范围远大于 `op_exit_script`（脚本回根）。两者都清 `cur`/`effect_flags`，但 `sub_40DF10` 还重建所有渲染/输入/子系统对象——这些 emulator 均**不建模**。

### A.2 分组伪代码（忠实原始顺序）

```c
int sub_40DF10(int _this) {
  // ---- ① 脚本帧/核心状态复位 ----
  _this + 383108 = -1;              // call_ret 槽（0x5D884）        [已实现] emulator callRet=-1
  _this + 667852 = -1;              // (0xA30CC) 字段未知             [字段未知/未建模]
  _this + 383120 = 0;               // (0x5D890) 字段未知             [字段未知/未建模]
  _this + 388216 = 0;               // (0x5EC78) 字段未知             [字段未知/未建模]
  _this + 383104 = 0;               // cur_script (0x5D880)          [已实现] emulator cur=0
  _this + 699204 = 0;               // effect_flags (0xAAB44)        [已实现] emulator effectFlags=0
  _this + 489808 = 0; _this + 699248 = 1; _this + 388220 = 0;       // (0x77950/0xAAB70/0x5EC7C) 字段未知 [字段未知/未建模]
  _this + 489476 = 0; _this + 489480 = 0; _this + 489820 = 0;       // (0x77804/0x77808/0x778FC) [字段未知/未建模]
  _this + 489984 = 0; _this + 489988 = 0;                           // (0x77980/0x77984) [字段未知/未建模]
  memset(_this + 388612, 0, 0xA0);   // 0x5ED04 一块 160B 拷贝          [字段未知/未建模]（对应 frames 返回栈/局部池区）
  _this + 388204 = 1; _this + 490012 = 1; _this + 497324 = 0;        // [字段未知/未建模]
  _this + 388200 = 0; _this + 388212 = 0; _this + 388208 = 0;        // [字段未知/未建模]
  _this + 490004 = 0; _this + 490008 = 10000; _this + 490016 = 0;    // (0x77A18=10000 时间阈值?) [字段未知/未建模]
  _this + 388232 = 0;               // global_slot_97058 (0x5EC88)   [已实现] emulator globalSlot97058=0
  // ---- ② 绘制模式 / 布尔标志 / 动画时间槽复位 ----
  _this + 667856 = 0;               // draw-mode 字段 (0xA30D0=comsetdrawmode) [字段未知/未建模]
  _this + 429752 = 0; _this + 429756 = 0;                           // (0x68EB8/0x68EBC) [字段未知/未建模]
  _this + 667860 = 0;               // engine_bool_flag (0xA30D4)   [字段已确认；emulator 未建模该字段]
  _this + 675964 = 0; _this + 675968 = 0; _this + 675972 = 0;        // (0xA507C/A5080/A5084) [字段未知/未建模]
  _this + 489484 = 0;               // (0x7780C) [字段未知/未建模]
  for (b = 0x77980; b <= 0x779FC; b += 4) _this+b = 0;   // (489856..489980) 大块时间/动画槽 [字段未知/未建模]
  // ---- ③ 子系统对象重建（各 sub_4Bxxxx / sub_44A9xx = 构造器）----
  sub_499BC0(_this + 322832);       // 绘制入口对象 (0x4ED10) 重建        [平台无关/无需实现]
  sub_49A690(_this + 322832); sub_4AB7A0(_this + 322832); sub_4AA180(_this + 322832); // 绘制子初始化 [平台无关]
  sub_4B8530(_this + 7912);         // 文本/渲染对象 (0x1EE8)            [平台无关]
  sub_44A9A0(_this + 7912, _this + 321572, _this + 322832);
  v2 = config.get("messageFont");   // 经 (*(..+697620)+8)(697620,str)    [逻辑未知/平台无关]（配置 getter）
  sub_465390(_this + 85296, _this + 7912, _this + 321572, _this + 322832, v2); // 字体加载 [平台无关]
  _this + 286956 = config.get("setUseProportion");  // (0x460EC) [逻辑未知/平台无关]
  _this + 698852 = 0; _this + 698856 = 0; _this + 698860 = 0;         // [字段未知/未建模]
  for (i = 0; i < 15; ++i) sub_4B60C0(_this + 18664, i);  // (0x48E8/1EE8 区) 15 个绘制资源槽 [平台无关]
  _this + 85260..85280 = 0;         // (0x14D0C..) [字段未知/未建模]
  _this + 490020..490040 = 0;       // (0x77A24..) [字段未知/未建模]
  sub_4B51E0(_this + 82876); sub_4BBA90(_this + 84128);  // (0x143BC/0x148A0) 输入/定时子系统 [平台无关]
  sub_453AD0(_this + 430600, 500); sub_453AD0(_this + 430180, 2000); // (0x69208/0x69064) 数值滑块初值 [字段未知/未建模]
  _this + 430688 = -1;              // (0x69260) [字段未知/未建模]
  if (_this + 430672 != _this + 430676) _this + 430676 = _this + 430672;  // [逻辑未知/未建模]
  _this + 430668 = -1; _this + 430796 = -1; _this + 430800 = -1;      // [字段未知/未建模]
  sub_4056F0(_this);                // 配置注册表 init
  sub_478090(_this + 1032, _this + 699208);   // flush 输入 → 0x699208(0xAAB50) [部分实现] emulator InputManager.flush() 等效
  v18 = 0; sub_477220(_this + 1032, &v18);    // 读鼠标按键 (0x108 同类)      [部分实现] emulator readButtons()
  if (v18) _this + 7792 = 1;        // (0x1E70) [字段未知/未建模]
  _this + 488984 = 0; _this + 699208 = 0;     // 输入位掩码清零               [部分实现] emulator flush/consumeEdges
  _this + 5660 = 0; _this + 81768 = 0; _this + 81776 = -1;              // [字段未知/未建模]
  _this + 81752 = 0; _this + 81760 = 0; _this + 81756 = 0;              // [字段未知/未建模]
  _this + 51848 = -1; _this + 51840 = 0; _this + 51824 = 0; _this + 51832 = 0; _this + 51828 = 0; // [字段未知/未建模]
  sub_4B8660(_this + 696548); _this + 86688 = 0;                        // [平台无关；字段未知]
  _this + 699216 = 1; _this + 699220 = 1;                               // (0xAAB50/0xAAB54) [字段未知/未建模]
  // ---- ④ 队列/栈容器重建（10 个 Queue_int + 10 个 Stack_int）----
  for (p = _this+388252; p < _this+388292; ++p) {   // 10 个 Queue_int(0x28B) 构造   [平台无关/未建模]
    if (*p) (**p)(*p, 1);                            // 释放旧的
    *p = new Queue_int(0x400 buffer, 256, 256);      // 每队列 256×256
  }
  for (p = _this+388292; p < _this+388332; ++p) {   // 10 个 Stack_int(0x1C) 构造   [平台无关/未建模]
    if (*p) (**p)(*p, 1);
    *p = new Stack_int(256, 256, -1);
  }
  // ---- ⑤ 外部 DLL / 电影 / 对象数组释放后重建 ----
  if (_this + 490072) { FreeLibrary(_this + 490072); _this + 490072 = 0; }  // 卸载电影 DLL [平台无关]
  memset(_this + 490076, 0, 0x190); memset(_this + 388332, 0, 0x118);       // [平台无关/未建模]
  _this + 497380 = 0; _this + 497396 = 0; _this + 497384 = 0; _this + 497400 = 0; // [字段未知/未建模]
  if (_this + 378684) { (**v12)(v12, 1); _this + 378684 = 0; }            // 释放电影对象 (0x5C73C) [平台无关]
  for (i = 0; i < 1000; ++i) {                                            // 释放 1000 个场景对象数组 (0x5C740)
    if (_this + 4*i + 378688) { sub_488FB0(*p); (**...)(...); *p = 0; }    // [平台无关/未建模]（emulator 无场景图）
  }
  // ---- ⑥ 返回 ----
  _this + 369532 = config.get("setOuterFrameMode");   // (0x5A37C) [逻辑未知/未建模]
  return _this + 369532;
}
```

### A.3 字段/对象建模状态小结

`sub_40DF10` 共触碰约 **133 处偏移**（含子对象基址）。对照 `fields.json`（用 `scripts` 校验脚本统计）：

- **命中已知字段（12）**：`call_ret`(0x5D884)、`cur_script`(0x5D880)、`effect_flags`(0xAAB44)、`global_slot_97058`(0x5EC88)、`engine_bool_flag`(0xA30D4)、`config_registry`(0xAA514)、`music_field`/`music_slot`、`sound_directsound`/`sound_manager`、`draw_item_container`、`input_state_mask`。
  - 其中 emulator **已复位**的：`cur=0`、`effectFlags=0`、`globalSlot97058=0`、`callRet=-1`。
  - `engine_bool_flag`(0xA30D4) **字段已确认但 emulator 未建模**（`engineValues` 里也没有）。
- **未知偏移（121 处）**：多为三类——
  1. 大块**时间/动画槽**区（`0x489xxx`/`0x7780C..0x779FC`、`0x77A14..0x77A38`、`0x430xxx`、`0x675xxx`）。
  2. **子对象基址**：`0x4ED10`(322832 绘制)、`0x1EE8`(7912 文本)、`0x4E824`(321572)、`0x14D30`(85296)、`0x143BC`(82876)、`0x148A0`(84128)、`0x69208`(430600)、`0x69064`(430180)、`0xAA0E4`(696548)、`0x5EC9C`(388252 Queue 区)、`0x5ECC4`(388292 Stack 区)、`0x5C73C`(378684 电影)、`0x5C740`(378688 1000 对象数组)。这些传给构造器/析构器，emulator **不建模**任何场景/渲染对象。
  3. 少量**标量**（`0x5D890/0x5EC78/0x5EC6C..0x5EC80/0x77A1C/0x796xx/0xA30CC/0xA30D0/0x0AAB70/0x0AAB50/0x0AAB54` 等）——语义未定。 `[字段未知]`

> 结论：`sub_40DF10` 的**脚本/标志复位**部分（cur/effect_flags/global_slot/call_ret/bool_flag）是可建模的子集；其余为**平台/子系统对象**（绘制、文本、输入、队列栈、电影、1000 对象数组），按本工程 ADR-003「干净建模」原则 emulator 不做字节级复刻，故多数标 `[平台无关/无需实现]`。真正**需要补**的只有 `engine_bool_flag` 的复位位（若 0x21B/0x247 要实现）。

---

## Part B · `sub_412290` —— 主循环

### B.1 总述
`sub_412290(Engine* this)`（`__noreturn`）是引擎的**主循环**：先装 SEH/`new` 处理器、做注册判断、置帧计数器，然后进入**以 `effect_flags` 位掩码驱动的多级状态机**。最内层（`effect_flags==0` 的“正常”路径）负责**取当前 opcode → 经 handler 表 `_this[4*v18+675996]` 派发 → 按 `arity` 推进帧指令指针**。外围各层由 `effect_flags` 的各个位控制“要不要处理”动画/电影/消息/等待/跳转等。

emulator 的对应物：
- 主循环：`src/vm/interpreter.ts run()` → `stepOnce()`（逐条执行），**干净抽象**，无 Win32 消息泵、无帧驱动效果位状态机。
- opcode 派发：`stepOnce` 里 `OPS.get(op) ?? NATIVE_OPS.get(op) ?? ENGINE_INTERNAL_OPS.get(op)`。 `[已实现]`
- `effect_flags`：`Engine.effectFlags`，仅少数位被使用。 `[部分实现]`

### B.2 结构伪代码（忠实原始嵌套 while 状态机）

```c
void sub_412290(int _this) {                    // __noreturn
  _set_se_translator(sub_4539B0); _set_new_handler(sub_453A00);   // 平台无关
  v97 = 0; v75 = 0;
  v89 = 1000*(rand()%120) + timeGetTime();      // 随机“E_0”错误展示时刻（仅未注册时用）
  if (config "setIsRegist") v97 = (config=="setIsRegist")==0;  // 未注册标志 [逻辑未知/平台无关]
  v98 = 1; v59 = *(_this + 671960);             // 锁定态读入 [字段未知/未建模]
  _this + 387936 = 4;                           // 状态门掩码初值（LABEL_4 重入判断用）[字段未知/未建模]
LABEL_4:   // 消息泵（重入点）
  while (PeekMessageA(&Msg,0,0,0,0)) {
    if (!GetMessageA) { *(_this+387924)=0; throw Exit; }   // WM_QUIT [平台无关]
    TranslateMessage; DispatchMessage;         // Win32 分发
  }
  _this + 699212 = 1;                          // 帧计数器 = 1 [字段未知/未建模]
  while (1) {                                  // L0：最外层
    while (1) { while (1) { while (1) { while (1) { while (1) {
    while (1) { while (1) { while (1) {        // L1..L8：8 层 by effect_flags 位
      // ---------- L8 内层（每帧核心） ----------
      if (effect_flags & *(_this+387936)) goto LABEL_4;      // 重入消息泵 [逻辑未知/未建模]
      (*(_this+699212))++;                     // 帧计数 ++           [未建模]
      if (v97 /*未注册*/ && timeGetTime()-v89 > 60000) {      // 60s 展示“E_0”并可能退回
        ... sub_408050(this+8,1024,"E_0"); if (sub_4034F0==1) throw Exit; ...  // [平台无关/未建模]
      }
      v94 = timeGetTime();                     // 当前 tick（present 用）
      // 渲染/呈现门：不锁定或动画等待门开
      if (!*(_this+429752) || (effect_flags & 0x400)) {
        sub_4B5230(_this+82876, v94);          // 帧呈现 [平台无关]
        if (sub_4BBAB0(_this+84128)) {         // present 完成
          sub_407120(_this);
          if (*(_this+85172)) *(_this+490004)=1;
          if ((*(_this+490016)&0x10000)) *(_this+490016)=0;
          if ((*(_this+490016)&1)==0) *(_this+490012)=1;
        }
      }
      v90=v95=v93=0;
      if (*(_this+675972)) {                   // 有场景对象需刷新
        // 第 1 遍：扫 1000 个对象 _this[4*i+378688]，找“需停止”者（obj[271]==dword_5283A0 && !sub_405180）
        for (i=0; i<1000; i++) { if (obj[i]) { if (obj[i][271]==dword_5283A0 && !sub_405180(obj)) { *(this+675972)=0; break; } } }
LABEL_32:
        *(this+675972)=0;
        // 第 2 遍：逐个更新对象动画
        for (i=0; i<1000; i++) if (obj[i]) {
          *(this+675972)=1;
          if (!*(this+429752) || (effect_flags & 0x400)) sub_488550(obj, v94);
          if (sub_405080(obj)) v90=1;          // 命中/视窗判定
          if (sub_4050E0(obj)) v95=1;          // 
          if (sub_405110(obj)) v93=1;          // 
          v91=sub_408130(obj); v13=sub_4080B0(obj);
          if (v13<=v91) {                      // 动画结束
            if (obj[273]) { sub_488420; sub_4081B0(...,0.0); sub_4883A0; continue; }
            sub_488FB0(obj);
            if ((*(obj+1096)&3)!=2) sub_4A4C70(this+322832, i,0,0,0);
            if (obj) { delete obj; *(this+4*i+378688)=0; }
          }
        }
      }
LABEL_56:  // ★ 脚本推进/门控判定（含 engine_bool_flag）
      if (*(_this+667856)==1) {                // draw-mode==1（comsetdrawmode）
        if (*(_this+675968)) v92=0;
        else if (*(_this+667860) /*engine_bool_flag*/ || (effect_flags & 0x2400)) {  // ★ 本标志在此参与
          v92=1;
          (*(_this+369336))=*(_this+369332); *(_this+369332)=v94;   // 帧定时器交换
          if ( (effect_flags & 0x1000000)==0 && !v93
               && (!*(_this+429752) || (effect_flags & 0x400))
               && (sub_40BE10(this+322832)==1 || v90==1) ) {
            sub_4B4040(this+322832); *(this+675992)=0;             // 清绘制
          }
        } else v92=0;
        if (sub_404C20(this+321572)) sub_411560(_this, "callbackLostBi...");
      }
      v17 = effect_flags;
      if (!v17) {                              // ★★ 正常脚本步进：opcode 派发
        v18 = **(_this + 120*cur + 383128);    // 当前 opcode（帧 ip 槽 +24）
        if (v18 > 0x3FF) goto LABEL_229;       // 越界 → 错误
        goto LABEL_216;
      }
      if ((v17 & 0x400000)==0) break;          // →L7
      // 0x400000：WaitMessage 等待模式
      WaitMessage(); GetMessage/Translate/Dispatch(unless IsDialogMessage);  [平台无关]
    } // L7
      if ((v17 & 0x1000000)==0) break;         // →L6
      if ((v17 & 0x2000)) { if(movie obj){ if ready { delete; clear 0x2000 } } }  // 电影 [平台无关]
      Sleep(5);
    } // L6
      if ((v17 & 0x4000) && !sub_404CB0(this+84128)) { if (*(this+490012)) { if (!(effect_flags&0x200) && !(*(this+490016)&1)) { effect_flags|=0x200; sub_453A60(..,10); sub_489D10(..,10000,1); } } }
      if ((effect_flags & 0x200)) { ... sub_453B60(this+430012); sub_489E50 ... clear 0x200 ... }
      if (!*(this+429752)) { if ((effect_flags & 0x1000)) { if (effect_flags&0x800) clear 0x800; else if (!(effect_flags&0x8000000)) { sub_453B60(this+430096); effect_flags|=0x800; goto LABEL_108; } } }
      v25 = effect_flags;
      if ((v25 & 0x4000000)==0) break;         // →L5
      // 0x4000000：跳转/call 待处理（帧栈还原）
      sub_478090(this+1032, this+699208);
      if (*(this+699208)) { *(this+699208)=0; effect_flags&=~0x4000000;
        v26=cur;
        if (*(this + 4*v26 + 489648) != -1) {  // 返回地址存在
          effect_flags|=0x2000000; *(this+489808)=effect_flags; effect_flags=0;
          *(this+489812)=sub_4051E0(_this, v26);
          v28=this+120*v26; *(this+430712)=v28[95796];
          v28[95782]=v28[95781]+4*(*(this+4*v26+489648));   // 帧 ip 回跳
          *(this + 120*cur + 383220)=0;
        }
      }
    } // L5
      if ((v25 & 0x100000)==0) break;          // →L4
      sub_411590(_this); Sleep(5);
    } // L4
      if ((v25 & 0x40000000)) { ... sub_453AF0(this+430600); sub_45A940(...); *(this+430816)=(v+1)%*+430820 ... }  // 显示动画 [平台无关]
      if (*(this+429752)) break;               // 锁定 →跳到最外
      v30=effect_flags;
      if ((v30 & 0x2000)==0) break;            // →L3（无电影）
      // 0x2000：电影播放中
      if (!*(this+378684)) { effect_flags&=~0x2000; goto LABEL_126; }
      sub_478090(this+1032, this+699208);
      if ((*(this+699208)&0x10) || movie_ready) { ... delete 电影对象; effect_flags&=~0x2000; LABEL_126: if(v95){...} for(j<1000) if(obj[j]) effect_flags|=0x2000; Sleep(0); }
      else { v29=*(this+430800); if(v29==-1) {...display aspect...} else LABEL_108: sub_40FC90(_this, -v29); }
    } // L3
      v35=effect_flags;
      // 各“系统效果/动画”位：与 systemEffects 配置 & 按键按下沿有关，走 sub_453AF0(433xxx) 计时 + sub_441E10/444350/447810
      if ((v35 & 8))    { if (...) set v100=0x10000000; else if (v100<0) goto LABEL_186; if(!sub_441E10(this+7912,v100)) effect_flags&=~8; }
      if ((v35 & 0x10)) { ... sub_444350 ... effect_flags&=~0x10; }
      if ((v35 & 0x80)==0) break;   // →L2
      { ... sub_447810 ... effect_flags&=~0x80; }
LABEL_186: Sleep(0);
    } // L2
      if ((v35 & 0x100)) { ... sub_447330 ... effect_flags&=~0x100; }
      if ((v35 & 0x400)==0) break;   // →L1
      if (sub_407E20(this+322832) || v95) {
        if (config "systemEffects" && !(*(this+369360)&1)) {
          if (...) { ... clear 0x10/边沿; effect_flags&=~0x400; sub_407EA0; sub_4B4040; sub_4B51E0; sub_4BBA90; for(k<1000) sub_488FD0(obj[k]); }
        }
        goto LABEL_186;
      }
      effect_flags&=~0x400; Sleep(0);
    } // L1
      if ((v35 & 0x40)==0) break;    // →L0
      sub_408F10(_this);            // 0x40 处理
    } // L0
    if ((v35 & 0x8000000)==0) break;   // 不处理 ADV/消息
    sub_411900(_this); sub_407EA0(this+322832); sub_4B51E0(this+82876); sub_4BBA90(this+84128);
    for (m<1000) sub_488FD0(obj[m]);   // 清场景对象
    Sleep(0); if (PeekMessageA(...)) goto LABEL_4;
  }  // ← 退出的“最外层”
  // 剩余位处理（v35 是退出时最后一次读的 effect_flags）
  if ((v35 & 0x20000000)) { sub_409400(_this); if (*(this+489860)) goto LABEL_215; }
  else if (v35>=0 && (v35 & 1)) { sub_453AF0(this+429760); if(>=0) effect_flags&=~1; }
  else if ((v35 & 0x20)) { sub_453870/453AB0(this+429900); effect_flags&=~0x20; }
  else if ((v35 & 0x10000000)) { sub_409700(_this); Sleep(2); }
  else if ((v35 & 0x800000)) { sub_4098E0(_this); }
  else {
LABEL_215:
    v18 = **(_this + 120*cur + 383128);        // ★★ 取当前 opcode
    if (v18 > 0x3FF) LABEL_229: sub_418E30(_this);   // 错误派发
LABEL_216:
    (*(int(**)(int))(_this + 4*v18 + 675996))(_this);   // ★★ 调 handler 表
    *(_this + 120*cur + 383128) += 4 * *(_this + 120*cur + 383220);  // ★★ 按 arity 推进 ip
  }
}
```

### B.3 `effect_flags` 位开关目录（本函数最核心的“开关”，须防丢失）

emulator 只用到 **3 位**（`0x400`、`0x8000000`、`0x20000000`），其余是引擎主循环的状态门，**`[未建模]`**。下表逐位列出 `sub_412290` 中出现的位与作用：

| 位 | 在 `sub_412290` 中的用途 | emulator 状态 |
|---|---|---|
| `0x1` | 某个系统效果计时（`sub_453AF0(429760)`），≥0 后清 | `[未建模]` |
| `0x8` | 系统效果类动画（`sub_441E10`，systemEffects 配置门） | `[未建模]` |
| `0x10` | 同上，走 `sub_444350` | `[未建模]` |
| `0x20` | `sub_453870/453AB0(429900)` 计时 | `[未建模]` |
| `0x40` | 触发 `sub_408F10`；`[未建模]` | `[未建模]` |
| `0x80` | `sub_447810` 系统效果 | `[未建模]` |
| `0x100` | `sub_447330` 系统效果 | `[未建模]` |
| `0x200` | `sub_453B60(430012)/sub_489D10` 计时；`[未建模]` | `[未建模]` |
| `0x400` | **动画等待门**（`0x21C wait`）：渲染/present 允许、LABEL_56 推进允许 | `[已实现]` `waitFlags=effectFlags`，`0x21C` 置位 |
| `0x800` | `sub_453B60(430096)`，与 0x1000/0x8000000 联动，`goto LABEL_108` | `[未建模]` |
| `0x1000` | 与 0x800/0x8000000 联动决定是否弹“系统效果” | `[未建模]` |
| `0x2000` | **电影播放**：处理 `_this+378684` 电影对象 | `[未建模]`（emulator 无电影） |
| `0x4000` | `sub_404CB0(84128)` 之后，若 `490012` 则置 0x200 | `[未建模]` |
| `0x400000` | **WaitMessage 等待模式**（阻塞取消息） | `[未建模]`（emulator 无消息泵） |
| `0x1000000` | 门：为 0 才进入电影/后续；LABEL_56 推进要求为 0 | `[未建模]` |
| `0x100000` | 触发 `sub_411590` + `Sleep(5)` | `[未建模]` |
| `0x4000000` | **跳转/call 待处理**：还原帧栈、回跳 ip | `[未建模]`（emulator 用 `retStack`/`cur` 单独建模） |
| `0x40000000` | `sub_45A940` 显示动画 | `[未建模]` |
| `0x8000000` | **ADV/消息激活**：清场景对象、处理子状态 | `[已实现]` `advActive`（0xCD/0x071/0x088/0x19B/0x19C 置位） |
| `0x10000000` | `sub_409700` + `Sleep(2)` | `[未建模]` |
| `0x2000000` | 与 0x4000000 联动（跳转中标记） | `[未建模]` |
| `0x800000` | `sub_4098E0` | `[未建模]` |
| `0x20000000` | **sleep 门**（`0xC8`）：`sub_409400`，直到 `*+489860` 才走 LABEL_215 | `[已实现]` `SLEEP_GATE`（`0xC8` 置位） |

> 另：`(effect_flags & 0x2400)`（=0x2000|0x400）在 LABEL_56 作为“推进允许”的一支（电影或动画等待门）——`[逻辑未知/未建模]`，且与 `engine_bool_flag`(0xA30D4) 是**或**的关系。
> `*(_this+387936)` 初值 4，作为 LABEL_4 重入的门掩码；`*(_this+699212)` 是帧计数器。两者 `[字段未知/未建模]`。

### B.4 已实现部分：opcode 派发 + ip 推进（LABEL_216/LABEL_229）

emulator 对**最内层正常路径**（`effect_flags==0`）已用干净模型实现：

| 引擎（`sub_412290` 最内层） | emulator（`interpreter.ts stepOnce`） | 状态 |
|---|---|---|
| 帧 ip 槽 `_this + 120*cur + 383128`（帧基 +0x18，存 opcode/ip） | `frame.ip`（指令下标） | `[已实现]`（抽象：下标 vs 字节偏移） |
| 取 opcode → `_this[4*v18+675996]` 调 handler | `OPS.get(op) ?? NATIVE_OPS.get(op) ?? ENGINE_INTERNAL_OPS.get(op)` | `[已实现]` |
| 越界 `v18>0x3FF` → `sub_418E30`（错误派发） | `NotImplementedOp` 抛错 | `[相关实现]`（语义不同：引擎是错误派发，emulator 是硬报错） |
| `_this[120*cur+383128] += 4 * _this[120*cur+383220]`（按 arity 推进） | `curFrame.ip += 1`（每指令推进） | `[已实现]`（抽象等价；`frame.arity` 供观测） |
| `cur`（`_this[383104]`） | `Engine.cur` | `[已实现]` |

> 这一小块是唯一与 emulator 主循环直接对应的部分，且 emulator 已抽象实现。其余（消息泵、effect_flags 状态机、1000 对象扫描、电影、渲染、计时、输入 Win32 泵）均不在 emulator 主循环内。

### B.5 `sub_412290` 的字段/对象依赖（多属未知）

除 `effect_flags`(0xAAB44)、`cur`(0x5D880)、`engine_bool_flag`(0xA30D4)、`draw-mode`(0xA30D0)、`executable` 几个，绝大多数是 `[字段未知/未建模]`：
- **门控/计数**：`_this+387936`(态掩码)、`+699212`(帧计数)、`+429752`(锁定/输入激活门)、`+675992`、`+675968`、`+675972`(对象刷新标志)、`+369332/369336`(帧定时器)、`+85172`、`+490004/490012/490016`。
- **输入位**：`+699208`(输入掩码，经 `sub_478090` flush)、`+1032`(输入子系统基址)、`+7796`(鼠标边沿残量)。
- **系统效果计时**：`+430012/430096/430600/430180/429760/429844/429872/429900/429956/429984`（`sub_453AF0/453B60/453870` 的槽）。
- **对象数组**：`+378688`(1000 个场景对象)、`+378684`(电影对象)、`+4*v18+675996`(opcode handler 表，675996=0xA50CC)。
- **帧/返回**：`+120*cur+383128`(ip)、`+120*cur+383220`(arity)、`+4*v26+489648`(返回地址)、`+489812`、`+430712`、`v28[95796]/[95781]/[95782]`(帧内部槽)。

---

## Part C · emulator 对照汇总（现状 vs 引擎）

| 引擎逻辑 | emulator 现状 | 缺口/风险 |
|---|---|---|
| `sub_40DF10` 复位 `cur/effect_flags/global_slot/call_ret/bool_flag` | `Engine` 构造默认 `cur=0`；`op_exit_script` 清 `effectFlags=0/cur=0/callRet=-1/globalSlot=0` | `engine_bool_flag`(0xA30D4) **未建模**；若要 0x21B/0x247 需在 reset/构造中同步清 0 |
| `sub_40DF10` 重建渲染/文本/输入/队列栈/电影/1000 对象 | 无对应（干净建模，ADR-003） | 不需要复刻（平台/子系统） |
| `sub_412290` 消息泵 / 定时 / Win32 分发 / 电影 | 无对应（renderer 提供帧循环与输入事件） | 不需要复刻；但注意 renderer 承担了“present/输入”职责 |
| `sub_412290` effect_flags 多级状态机（~24 位开关） | 只用 `0x400/0x8000000/0x20000000` 三位 | **大量位未建模**（见 B.3），后续实现易漏 |
| `sub_412290` opcode 派发 + ip 推进 | `stepOnce` 已抽象实现 | 无明显缺口；error 派发语义略异 |
| `sub_412290` 1000 个场景对象动画/命中/结束 | 无场景图 | 不需要复刻（渲染侧） |
| 输入读取（`sub_478090`/`sub_477220`） | `InputManager.flush()/readButtons()` | 已对齐（输入抽象） |

---

## Part D · 后续实现风险点（用户重点）

1. **`engine_bool_flag`(0xA30D4) 未落进 emulator**：`0x21B` 写 `_this[166965]=(op1!=0)`、`0x247` 写回 op1、`sub_40DF10` 清 0、`sub_412290` LABEL_56 门控。四个引用点都已证据化，但 emulator 尚无该字段。建议：`Engine.engineValues` 增加 `166965` 项，`0x21B/0x247` 建模，复位时清 0（与 `0x148/0x149` 的 `global_slot_97058` 同类做法）。
2. **`effect_flags` 位掩码巨大**：主循环的 `0x1/0x8/0x10/0x20/0x40/0x80/0x100/0x200/0x800/0x1000/0x2000/0x4000/0x400000/0x1000000/0x100000/0x4000000/0x40000000/0x10000000/0x2000000/0x800000` 全部 `[未建模]`。若只做脚本 VM，多数位对应的“系统效果/电影/渲染/消息”是平台职责，**可按“记录+跳过”**；但 `0x4000000`（跳转/call 还原帧栈）与 `0x2400`（LABEL_56 推进）是**脚本语义**，更接近 VM 层，需注意是否复用现成的 `retStack`/`cur` 建模。
3. **`draw-mode`(0xA30D0) 与 `engine_bool_flag` 的 LABEL_56 联动**：`*(`_this+667856`)==1` 才进入推进判定，`0xA30D0` 目前 `[字段未知]`，若要精确复刻 LABEL_56 需先确认它的生产者（`sub_423170` 的 opcode 族写入的地方）。
4. **多处“成对 get/set 槽”**：`0x148/0x149`(`global_slot_97058`)、`0x21B/0x247`(`engine_bool_flag`)、`0x149/0x1A3` 等都是脚本可读写的引擎槽，各自 `[字段未知]` 只在需要时补，避免一次性铺开。
5. **主循环与 emulator 的映射边界**：emulator 的“主循环”是 `run()`/`stepOnce()`（脚本执行），**不是** `sub_412290` 的帧状态机。因此对比时应把 `sub_412290` 视为「平台外壳（消息泵/渲染/电影）+ 引擎帧处理（effect_flags 状态机）+ 脚本执行（LABEL_216）」。脚本执行部分已实现；其余两段按“平台职责”记录即可。

---

## 参考
- `analysis/fields.json`：`engine_bool_flag`(0xA30D4)、`cur_script`、`effect_flags`、`global_slot_97058`、`call_ret`。
- `analysis/functions.json`：`sub_423C20`(`0x21B`)、`sub_430810`(`0x247`)、`sub_40DF10`(`engineInitReset`)、`sub_412290`(`mainLoopFlow`)、`readIntOperand_41BF50`、`writeIntOperand_42B4B0`。
- `docs-new/03-engine/opcode-table.md`：0x21B / 0x247。
- `docs-new/03-engine/field-97058-timer-dialog.md`：同类字段/函数联动的既有文档（风格参考）。
- emulator：`app/amayui-emulator/src/vm/{engine,interpreter,ops,input}.ts`、`src/run.ts`（仅用于对照现状，非真源）。
