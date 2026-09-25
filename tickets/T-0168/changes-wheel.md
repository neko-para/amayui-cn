# T-0168 · ADV 滚轮上滚链：结论、修正与交接（2026-09-25）

> 本文是本票的**过程文档 + 交付说明**。全部结论都带 `engine/天结_unpacked.exe_utf8.c`（下称 raw）行号或 `文件:行`；
> 凡"引擎行为"都给出**可复算的体锚点**，凡"emulator 侧"都给出**可执行的红→绿或真语料实测**。
> 前置研究（只读，含探针日志）：`tickets/T-0168/changes.md`（第一轮）+ `tickets/T-0168/notes.md`（A3 查证）。

---

## §0 一句话结论

**默认配置（`set:WheelKeyUp=3` = ← 键的掩码位）下，ADV 里"滚轮上滚"就是"按一下 ←"**：
它经 WndProc 折成掩码位 `1 << 3` → 等待泵的**第一优先出口** `sub_403D70`（raw 20242）在 ADV 脚本用 `0x97`
绑好的路由表里命中 `src/SN0000.txt:88` 那一项 → 派发它的 labelC = `label_00002c40`（`src/SN0000.txt:770`）
→ 该 label 第一次进来调 `call label_00000e78` 把 **22 个侧栏按钮**逐个 `i220` 摆出来（= 打开侧边栏），
之后按 `label_00002fc0` 把光标**定位到第一个可选中按钮**。
⇒ 用户实测「向上滚 ⇒ 打开侧边栏并停在第一个按钮」**不是 emulator 的分叉，是引擎在随包默认配置下的行为**。
**"回看（额外一层 BIN）"要先把 `set:WheelKeyUp` 配成 8**（`SN0000.txt:106` 把位 8 绑给 `label_00002f84`
→ `call-script 31 // HISTORY`）。

**证据（真语料 E3 实测，本机 `install/`，见 `test/t0168-wheel-adv-input.test.ts`）**：

```
动作前的路由表（真 BIN 跑出来的，不是合成）：
  [0] keyBit=-1 labelClick=910   rect=(1230,233)-(1280,493)   ← 悬停热区
  [1] keyBit=0  labelClick=2630                               ← ↑
  [2] keyBit=1  labelClick=2701                               ← ↓
  [3] keyBit=2  labelClick=2752                               ← →
  [4] keyBit=3  labelClick=2817  = 0xB01 = SN0000.txt:770 的 label_00002c40（侧栏）
  [5] keyBit=8  labelClick=3026  = 0xBD2 = SN0000.txt:831 的 label_00002f84（→ call-script 31 // HISTORY）
  [6] keyBit=7  labelClick=2906
默认配置                 ：set:wheelkeyup=3 / set:wheelkeydown=1（= 引擎内建缺省 raw 111736-111739）
一次 addWheel(+120)      ：wheelKeyBits=0x8 ⇒ lastDispatch={"label":2817,"kind":"key"}
                          同时 textRewind(Engine[489816])=0、effect_flags & 0x100000 == 0
再跑 30 帧（label 体执行）：路由 19 → 7+12、SN0000 里 0x220（平移动画窗）命中 22 次
```

一句话回答"上滚该不该开侧边栏"：**在随包默认键位下应该**（引擎就是这么配的）；
**"上滚 = 回看"只有把 `set:WheelKeyUp` 改成 8 才成立**；而**引擎里根本没有「滚轮 ⇒ HISTORY」的内链**
（`HISTORY.BIN` 全语料唯一入口 = `call-script 31`）。

---

## §1 判据①：把"ADV 里滚轮上滚到底该做什么"按体定死（逐条锚点）

### 1.1 引擎侧（raw，全部回体读过）

| # | 锚点 | 体里是什么 | 结论 |
|---|---|---|---|
| A | `case 0x20Au:` raw **141560-141584**（`WM_MOUSEWHEEL`） | `if ((Engine[699204] & 0x90100000) != 0) { v19 = GetConfig(上滚? aSetWheelkeyup : aSetWheelkeydow); … LABEL_147: if (v19 >= 0) Engine[699208] \|= 1 << v19; } else Engine[7796] += HIWORD(wParam);`（raw 141604-141606 / 141580-141583） | ① 模式开 ⇒ **只**进掩码、**不进**增量累加器（两条支是 if/else，配对）；② 位号来自 `set:WheelKeyUp`；③ 位号只判 `>= 0`，`>= 32` 按 `shl cl` 取模（`.lst:004B9CBE`）⇒ 已在 `T-0171` 修正 |
| B | `sub_403D70`（raw **9847-9863**），调用点 raw **20242**（`sub_411BC0` 的**最前**一段） | `for (i = _this+7361; *i < 0 \|\| ((1 << *i) & *a2) == 0; ++i) … return _this[v3 + 459];` —— 遍历路由表，返回**第一个**"已绑键且该位被按下"的项的 **labelC**（`[459+i]`） | **这是等待泵的第一优先出口**：位 3 被 `0x97` 绑到第一项之后，任何"上滚"都先在这里被吃掉 |
| C | `sub_411BC0`（raw **20206-20093** 段末）—— 真正的泵体 raw 20237-20374 | 次序：raw 20238 `sub_478090` 刷掩码 → 20239-20260 点击/面板 → **20242 `sub_403D70` 键命中（命中即派发并 `goto LABEL_68`，永不返回）** → 20262-20313 推进 → **20315-20321 两条门（右键 / 滚轮键+ReDrawTextOnKey）** → **20341-20363 回看块** → 20365-20374 右键取消路由 | ★**回看块排在键命中之后**，而且它自己被 `effect_flags & 0x40000000`（逐字中）门控 ⇒ **产品路径上"滚轮上滚 ⇒ 回看"永远轮不到** |
| D | 回看块本体 raw **20341-20363** | `v7 = Conf(set:WheelKeyUp); if ((1 << v7) & *v2) { sub_459770(Font,-1,2); Engine[489816] = -1; LABEL_21: effect_flags \|= 0x100000; sub_411560(Engine, "CALLBACK_TEXT.BIN"); *v2 = 0; }` 否则 `if (sub_459770(Font,1,2)) { 489816 = 1; goto LABEL_21; }` 否则 `489816 = 0;` | 上滚位命中 ⇒ 回看游标 **−1**（raw 20347-20348）；**下滚位没有前置判**（raw 20355 无 `& *v2`，照抄引擎）|
| E | `sub_411590`（raw **19947-20093**） | 见 §3。**它不在 ADV 输入路径上**，只在 `0x100000` 自旋里被调（唯一调用点 raw 20884） | 判据③ 的答案 |
| F | `0x84` 的 `sub_41F790`（raw **28829-28942**） | 同一 `0x100000` 标记的**另一置位端**：`_this[174801] \|= 0x100000`（raw 28900/28914）、`& 0xFFEFFFFF` 清位（raw 28894/28929）；**不读任何输入掩码**，`op1` 本身就是方向 | 与 WndProc 那条路**并列**（一个是"滚轮键"，一个是脚本主动），语料 **0 处** |
| G | 引擎内建缺省 raw **111736-111743**（`sub_491880` = `Reg` 构造） | `v13 = 3; sub_434D00(v2, aSetWheelkeyup, &v13);` / `v13 = 1; … aSetWheelkeydow` / 横滚两条 `= -1` | 随包默认 **3 / 1 / −1 / −1** |
| H | 唯一覆盖写者：`sub_494220`（`Reg` vtable+0x2C，raw **112705-112718**） | 读 ini 的 `WHEELKEYUP=` / `WHEELKEYDOWN=` 行（`atoi`，**无范围校验**） | 只有手改 `SYS4REG.INI` 能改它；**游戏内没有写者**（`src/**` 里 `set:` 0 命中、6 条 `SetConfig` 的键名全是常量，见 `notes.md` §2.1(d)） |

### 1.2 语料侧

| # | 锚点 | 体里是什么 |
|---|---|---|
| I | `src/SN0000.txt:76-114`（334 个 ADV 脚本同型） | 先 `i090 x y 1 1 ffffffff ffffffff <labelC>` 登记一个**屏幕外** 1×1 热点（`y = 0 - 0x3e8` 递减），紧接 `i097 x y 1 1 <bit>` 绑位。位号顺序 **0/1/2/3**（`:94/:97/:100/:103`）→ 四个方向键的菜单导航；**8**（`:106`）→ `label_00002f84`；**7**（`:114`）→ `label_00002da4` |
| J | `src/SN0000.txt:88` + `:770-795`（label 体） | 位 3 的 labelC = `label_00002c40`：`read-mouse-pos` → 按 `global f7ffb`（侧栏状态，0 = 收着）判 → `call label_00000e78`（**建侧栏**，`:160-190`：`f8019 = 1..0x16` 逐个 `i220 19834+f8019 0 c8 6e 0 0` + `wait` + `mov 1399 1`）→ 否则 `call label_00002fc0`（`:840-873`：在 `global 13b0` 表里找**第一个非 0 项**当 `f8003`，`add global 13a0 8a f8003*32`）→ `i10a 4c4 (global 13a0)`（把光标钉进侧栏 x=1220）|
| K | `src/$1$SC0330.txt:466-505`（菜单派发） | `lookup-array (local-ptr 0) (global-int 13b0) (global-int f8019)` + `eq … 6` ⇒ `i1f4 / call label_0003da84 / i1f5 / i093 / call-script 31 // HISTORY`（`:477-485`）⇒ **action id 6 = 回想**，而 action 索引 `f8019` 正是 `label_00002c40`/`label_00002fc0` 维护的那个游标 |
| L | `src/$1$SC0330.txt:477-485` / `src/HISTORY.txt` | `HISTORY.BIN` 的**唯一**入口 = 这一处 `call-script 31`（全语料 669 处 / 335 文件，形状相同） |

### 1.3 一句话答案（判据①的收口）

> **默认 `set:WheelKeyUp=3` 时，ADV 里的滚轮上滚 = 按 ← = 打开/展开侧边栏并定位到第一个按钮（引擎行为）；
> 想让它回看，必须把 `set:WheelKeyUp` 配成 8；引擎里不存在「滚轮 ⇒ HISTORY」的内链。**

---

## §2 判据②：侧边栏误开 —— **定为引擎行为，不改代码**（附"为什么不是 emulator 分叉"的逐条排查）

### 2.1 定性

**引擎行为。** 机理见 §1 的 B/C/I/J：WndProc 把上滚折成位 3（raw 141604-141606），
而 ADV 脚本把位 3 绑给了 `label_00002c40`（`SN0000.txt:88-103` 的 `i090`/`i097` 对），
泵的第一出口 `sub_403D70`（raw 20242）取的正是它 ⇒ **真机同样如此**。

### 2.2 逐条排查"是不是 emulator 的分叉"（每一条都回体核过）

| 环节 | 引擎 | emulator | 判定 |
|---|---|---|---|
| 模式判据 | `Engine[699204] & 0x90100000`（raw 141563） | `wheelKeyPolicy().asKey = effectFlags & 0x90100000`（`src/vm/engine.ts:759`） | 一致 |
| 位号来源 | `Conf(set:WheelKeyUp/Down)`（raw 141567-141576） | `cfgInt(cfg, CFG.setWheelKeyUp, -1)`（`engine.ts:757-764`） | 一致；缺键 ⇒ −1 = 不映射（与引擎 `if (v19 >= 0)` 同义） |
| 缺省位号 | 内建 **3/1/−1/−1**（raw 111736-111743） | `configRegistry.ts:131-134` 也是 **3/1/−1/−1**；`renderIni` 全量落盘 ⇒ overlay 那份 `WheelKeyUp=3` 是**我们自己写的**、值也是对的 | 一致（★不要把 overlay 那份当成"随包默认文件"） |
| 进掩码的口 | `Engine[699208] \|= 1 << v19`（raw 141606） | `wheelKeyBits` → `flushPending()`/`flushHeld()` 并进掩码（`input.ts:625/653`） | 一致（★**不许** `>>> 0`：掩码是 int32，位 31 = 负值，`T-0171` 踩过） |
| 刷子归属 | 泵 raw 20238 = `sub_478090`（**消费刷**） | `serviceAdvanceWait` 用 `flushPending()`（`engine.ts:1214`） | 一致 |
| 第一出口 | `sub_403D70` raw 20242（**在回看块 20341 之前**） | `panel.pickByKey(mask)`（`engine.ts:1226`，**在 ④ 之前**） | 一致（顺序是硬约束） |
| 命中判据 | `*i < 0 \|\| ((1 << *i) & *a2) == 0`（跳过未绑项；返回 `[459+i]`） | `e.keyBit >= 0 && (mask & (1 << e.keyBit)) !== 0` → `e.labelClick`（`route.ts:311-316`） | 一致 |
| 位号值域 | `sub_403D10` 写入时**无** `0x1F` 判定；`1 << *i` 裸用（`shl cl` 取模） | JS `<<` 同样取模 32（`route.ts:304-309` 已写明"不得自造上限"） | 一致 |
| 路由表次序 | 入队序（`sub_403B30` 逐项 append） | `entries` 数组 push 序 | 一致（真语料实测的 7 项次序与脚本登记序逐项对齐） |

⇒ **没有发现分叉**；用户看到的"侧边栏"是**忠实复现**。

### 2.3 红→绿证据（本票新增，判据②的机器可复算部分）

新增 **`app/amayui-emulator/test/t0168-wheel-adv-input.test.ts`**（`@tier T1 @kind core @subsystem input`，5 例）
—— 真链路（TITLE → Game Start → GAMESTART → ゲーム開始 → SN0000 首文案 → ADV 等待态）+ 真 BIN：

| 例 | 断言 | 结果 |
|---|---|---|
| ① | 真 BIN 跑出的键位表里 **位 3 → 2817**、**位 8 → 3026**、位 1 → 2701 | ✅ |
| ② | 一次 `addWheel(+120)` ⇒ `wheelKeyBits = 0x8`、`lastDispatch = {label:2817, kind:'key'}`、`textRewind = 0`、`effect_flags & 0x100000 == 0` | ✅ |
| ③ | 派发后 label 体真的执行：路由 **7 → 19**、SN0000 里 `0x220` **22** 次 | ✅ |
| ④ | 下滚（位 1）同样走键命中，label = **2701**（= `SN0000.txt:82` 的 `label_00002a70`） | ✅ |
| ⑤ | 上滚/下滚都**不**碰回看泵（`textRewind`/`0x100000` 保持 0） | ✅ |

```
cd app/amayui-emulator && node --import tsx --test test/t0168-wheel-adv-input.test.ts
ℹ tests 5  pass 5  fail 0   duration_ms ≈ 19.3 s（真链路一次，5 例共享）
```

### 2.4 用户可见说明（本票只登记，不在可写文件里）

- **"ADV 里上滚 = 打开侧边栏"是引擎默认行为**，不是 bug；要"上滚 = 回看"请把
  `SYS4REG.INI` 的 `[set] WheelKeyUp` 改成 **8**（或点侧边栏菜单项「回想」/action id 6）。
- 本作**没有**游戏内键位设置界面（能写配置的 6 条 opcode 键名全是常量，见 `notes.md` §2.1(d)）。

### 2.5 复核 `T-0171`（票面点名的"别重做"）

读过 `src/vm/input.ts:500-539`：`addWheel`/`addHWheel` 在 `policy.asKey` 为真时**只在 `bit >= 0` 时**
置 `1 << (bit & 31)`，随后**一律 `return`**（负位号/零增量/≥32 都不回流累加器）——与引擎
"模式门是 if/else 配对、累加支不可达"（raw 141563-141583）一致；两处 `>>> 0` 也已去掉。
**`T-0171` 无需重做**；本票只在 §1.1-A 把它记成"已修的前置"。

---

## §3 判据③：回看（额外一层 BIN）路径 + `sub_411590` 是否必须建模

### 3.1 "额外一层 BIN"在引擎里由谁开

两条**互不相干**的东西，票面把它们的名字混在一起了，这里拆开：

1. **回看画面 = `HISTORY.BIN`（额外一层 BIN）**：入口只有一处 —— **ADV 侧边栏菜单项 action id 6**
   的 `call-script 31`（`src/$1$SC0330.txt:477-485`，全语料 669 处 / 335 文件同型）。
   它**不是**滚轮触发的：想让滚轮触发它，必须把 `set:WheelKeyUp` 配成 **8**（`SN0000.txt:106`）。
   实测（`test/recall-page-0x1d1.test.ts` ⑧ + 本票 §0）：配 8 后一次滚轮 ⇒ `HISTORY.BIN`，
   `0x1D1` 按体产出正文（`T-0170`）。
2. **ADV 的"回看游标"（不是开画面）**：`sub_411BC0` raw 20341-20363 的 ④ 段
   + `0x84`（`sub_41F790` raw 28829-28942）。它只做 `sub_459770(Font, ∓1, 2)`（页游标 ±1）
   + `Engine[489816] = ∓1` + `effect_flags \|= 0x100000`。**emulator 已建模**（`#textRewindWheel`，
   `src/vm/engine.ts:1434-1462`），但它在产品路径上**被 ① 键命中挡死**（§1.1-C）。

⇒ **emulator 缺的那一环不是"回看游标"，而是 `HISTORY.BIN` 这一层的内存** ——
它由 `call-script 31` 走脚本派发（emulator 的 `0x143`/`call-script` 链已支持），
`HISTORY.BIN` 里唯一曾缺的 opcode `0x1D1` 已由 `T-0170` 实现。**当前无缺口**。

### 3.2 `sub_411590` 按体是什么（raw 19947-20093，逐段读过）

```c
void sub_411590(int _this) {
  // ① 三个**语音通道槽**的待发队列（每个 7 dword = 28B，基址 _this+699260，步进 28）
  v3 = _this + 699260;  v18 = _this + 20212 /* = 85296/4 = 当前语音槽 */;
  do {
    v4 = v3[0]; v5 = v3[1];
    if (v4 < v5 && v5 - v4 > 0) {
      v3[4] = v4;                                   // 记"正在播这个"
      if (v4 < v3[1]) { v3[4] = v4 + 1;
        if (!sub_404CB0(_this + 84128)) {           // 语音忙 ⇒ 不播
          v7 = *(v3[-1] + 4*v4); v8 = v4 + 1; *v3 = v8;
          if (v3[4] < v8) v3[4] = v8;
          sub_4BB840(_this + 84128, v2 /*槽 0..2*/, v7, 0, *v18);   // ★语音文件提交（handle → 播放）
        } }
    }
    ++v18; ++v2; v3 += 7;
  } while (v2 < 3);
  // ② 刷输入掩码（sub_478090 = 消费刷）
  sub_478090(_this + 1032, _this + 699208);  v10 = *(_DWORD*)(_this + 699208);
  if (v10 & 0x10) {                                    // 左键
    if (面板/游标有效) { 压返回点 + 派发 labelC; 压 effect_flags 保存栈; 清 bit30; 再刷掩码+sub_477220 }
    else { sub_459770(Font, 0, 2); effect_flags &= ~0x100000; 489816 = 0; 掩码=0;
           sub_411560(Engine, "CALLBACK_TEXT.BIN"); }  // ★终止回调的那一跳
  } else if (v10 & 0xA) {                              // 上滚位(8) | 下滚位(2)
    if (v10 & 8) { sub_459770(Font,-1,2); 489816 = -1; }
    else if (sub_459770(Font,1,2)) 489816 = 1;
    else { effect_flags &= ~0x100000; 489816 = 0; }
    掩码 = 0; sub_411560(Engine, "CALLBACK_TEXT.BIN");
  } else if (面板) { 悬停离开 → 压返回点 + 派发; 压 effect_flags 保存栈; 清 bit30 }
}
```

**关键更正（与台账不符，见 §4.1）**：`_this+699260` 的三条 28B 记录是**语音通道**（调用体是
`sub_4BB840` = `VOICEファイル %s の読み込みに失敗しました` 那个函数，raw 142489-142519），
**不是"消息/文本回调的派发队列"**。`sub_411590` 是「文本回调/跳读进行中的把门循环体」：
每轮 = （语音槽推进 + 输入刷 + 三种输入各自一格 + 点 `sub_411560`）。

### 3.3 明确结论：**不建模**（why + 重开条件）

**why（三条，都回体）**：

1. **它进不去**：唯一调用点 = 主循环 raw 20882-20885 的 `if ((v25 & 0x100000) == 0) break; sub_411590(_this); Sleep(5);`。
   而 `0x100000` 在**产品路径**上只有两个置位端，两个都是"回看"：泵 raw 20350（`sub_411BC0` 的 ④ 段）
   与 `0x84` raw 28900/28914（**语料 0 处**，`functions.json` 里 `0x84` 也是 PARTIAL）。
   ④ 段在本作 ADV 里**永远轮不到**（§1.1-C：位 0..3/7/8 全被 `0x97` 绑给了路由项，键命中在前）。
   ★**交叉证据**：emulator 的真语料 E3（本票 §2.3）实测 `effect_flags & 0x100000 == 0` —— 不是"没实现"，
   是这条路上真的到不了。
2. **把门条件永不终止**：`0x100000` 的**唯一**清除点里，raw 20041/20061 恰好就在 `sub_411590` 自己体内，
   而它们**只在 `sub_411560` 派发出去的回调脚本跑完之后**才可达；本机数据没有 `CALLBACK_TEXT.BIN`
   （§3.4 实测），`sub_411560` 是整跳 no-op ⇒ **一旦进入这个循环，`0x100000` 永远不会被清**。
   照抄体建模会把 emulator 变成一个 5ms 一圈的死循环（而现行 emulator 的 `serviceAdvanceWait` 一帧返回一次，
   没有"同帧内再泵"的结构）。⇒ **诚实的不建模 > 照抄出一个必然挂死的循环**。
3. **它的可观测后果都有别的落点**：语音槽提交（第①段）在 emulator 里由
   `handlers/audio.ts` + `Engine` 的语音派发承担；输入刷（第②段）由 `InputManager.flushPending()` 承担；
   三种输入各自一格（`0x10`/`0xA`/悬停）在 ADV 里另有实现（`serviceAdvanceWait` / `#textRewindWheel` /
   `nextHoverLabel`）。真正**只此一处**的行为 = `sub_459770(Font, 0, 2)` + 清 `0x100000` + "回调脚本跑完的那一刻"
   —— 那一格依赖第 2 条里不存在的回调脚本。

**重开条件（写清，别当"永远不会做"）**：

- **R1**：数据里出现 `CALLBACK_TEXT.BIN`（换版本 / 装资料片 / 本工具有一天把该 BIN 做出来）
  ⇒ 先补判据④的"按名装载 + 立即派发"口，再在 `#textRewindWheel`/`#cancelRoute` 末尾调它。
- **R2**：`T-0169`（逐字显现帧不跑等待泵）落地后，若 emulator 的帧结构变成"同帧内可再泵"，
  且 ADV 里出现"键命中之后仍带 `0x100000`"的实测状态（本票实测为 0），再评估把第②段（输入刷 +
  `0x10` 逐字贴完）搬进 `Engine` —— 那一段**不需要**回调脚本，是纯 ADV 行为。
- **R3**：若将来某条语料出现 `0x84`（当前 `src/**` 0 处），它的"翻到底"支会置 `0x100000`
  （raw 28894/28900）⇒ 那时第 1 条的前提（"进不去"）失效，必须重评。

### 3.4 `CALLBACK_TEXT.BIN` 的"缺失"再实测（比第一轮更严：这次含 5 个扩展包）

用 `src/script/alf.ts` 的解析器直接读索引（`install/`，两类索引都是 S4IC/S4AC 压缩体）：

```
base  = install/SYS4INI.BIN  → archives 8 / files 21109
APPEND01.AAI pack=1 files=678      APPEND04.AAI pack=4 files=425
APPEND02.AAI pack=2 files=261      APPEND05.AAI pack=5 files=918
APPEND03.AAI pack=3 files=1689     ⇒ 合计 21109 + 3971 = 25080 条
所有 CALLBACK* ：CALLBACK_LOAD.BIN / CALLBACK_SETTING.BIN / CALLBACK_WINDOW.BIN   （仅此三个）
所有 *TEXT*   ：（空）
```

⇒ `sub_455000(Engine, "CALLBACK_TEXT.BIN")` 在本树**必返回 −1**（体 raw 67400-67439：两轮
`_stricmp` 扫本体 `_this+173106` 与扩展包槽，全不中 ⇒ `return -1`）；
`sub_40FC90(Engine, -1)` 体首即 `if (a2 != -1) {…}`（raw 19021-19026）⇒ **整跳 no-op**。
第一轮只扫了 `SYS4INI.BIN` 的 21109 条，本票把它扩到**全部 6 个索引（25080 条）**，结论不变。

---

## §4 判据④：`sub_411560(Engine,name)` 的按名装载 + 立即派发 —— **不实现**（why + 重开条件）

### 4.1 但**发现一处台账与体不符**（本票的"报告说 → 体里是"之一）

`analysis/functions.json` 的 `0x411590` 条（`semantic_name = msgCallbackDispatch_411590`，
`raw 19947-20093`）写：

> purpose: 「消息/文本回调派发器（主循环 `sub_412290` 在 `effect_flags&0x100000` 时调用）。处理**回调队列**(`_this+699260`)…」
> notes: 「🔒 记录背景（待实现消息/文本回调系统时再改 emulator）：本函数/flag 栈属 ADV/文字窗子系统，当前不实现。」

**体里是**：`_this+699260` 那三条 28B 记录的消费者是 `sub_4BB840`（raw 19990），
而 `sub_4BB840`（raw 142489-142519）体内有 `"VOICEファイル %s の読み込みに失敗しました"`
⇒ **那是语音通道槽的待发队列，不是回调脚本队列**。"回调队列"这个名字来自
`functions.json` 里紧邻的 `0x796DC dispatch_queue`（= `sub_40FC90`/`sub_40FB60` 的那张表，**另一张**）。
⇒ 该条 purpose/notes **需要订正**（见 §5 台账待应用 ①）。功能分类不受影响：
`sub_411590` 确实只在 `0x100000` 时被调用，也确实压/弹 effect_flags 保存栈。

### 4.2 不实现的 why（三条独立证据，逐条可复算）

| 证据 | 体 | 结论 |
|---|---|---|
| 按名装载 | `sub_455000`（raw 67400-67439）：本体两轮 `_stricmp` + 扩展包槽逐条比较，名字不在索引里 ⇒ `return -1` | `CALLBACK_TEXT.BIN` 不在（§3.4 的 25080 条里没有）⇒ **−1** |
| 立即派发 | `sub_40FC90`（raw 19019-19027）：`if (a2 != -1) { sub_409E10(queue, a2); if (!_this[124350]) sub_40FB60(_this); }` | **−1 ⇒ 整跳 no-op**（队列不写、不派发） |
| 真机同一结论 | 派发体 `sub_40FB60`（raw 18954-19016）：`if (_this[429752]) …`（停靠锁）+ 取 `dispatch_queue` 的读下标 `497380`，把请求装进**帧 37**（raw 18987 `_this[383104] = 37`）| 即使名字存在，它也只是"入队 + 把帧 37 装上"，**没有"立刻把控制交给它"** —— emulator 的 `FileSource.readScriptByName`（唯一调用点 = 读档的 `CALLBACK_LOAD.BIN`）**已经覆盖这个语义** |

⇒ **不改代码**。判据④的"若需要实现，落地并加守卫"不成立：**不需要**。

### 4.3 emulator 现有落点（不改，只登记）

- `src/vm/engine.ts` 的 `#cancelRoute` 与 `#textRewindWheel` 都在注释里写明了"`CALLBACK_TEXT.BIN` 那一跳不假装"，
  并给了重开条件 —— 与本节结论一致，**无需改动**。
- `#cancelRoute` 那格 `489812`（`redisplayReturn`）**有意不写**的理由（"要回调脚本跑完那一刻的 `(ip−ip_base)>>2`"）
  在本机数据下**永远用不到**（回调脚本不存在）⇒ 保持现状；重开条件同上 R1。

---

## §5 台账待应用（★本 agent 不写 `analysis/**`，以下给主 agent 逐条照抄）

### ① `analysis/functions.json` · `addr = "0x411590"`（`semantic_name = msgCallbackDispatch_411590`）

- `purpose`：**改**为（保留"回调"这个词，但把队列的身份写对）：
  「文本回调/跳读进行中的把门泵（主循环 `sub_412290` 在 `effect_flags & 0x100000` 时每轮调它 + `Sleep(5)`，唯一调用点 raw 20884）。
  每轮四件事：① **三个语音通道槽的待发队列**（28B/条，基址 `_this+699260`，步进 28）逐槽消费，
  命中且 `sub_404CB0` 说通道空闲时 `sub_4BB840(_this+84128, 槽, handle, 0, 当前语音槽)` 提交；
  ② `sub_478090` 刷输入掩码；③ 按掩码低三位分三支（`0x10` 左键 / `0xA` 上滚位8|下滚位2 / 否则悬停），
  每支都可能 `sub_409D40` 压 effect_flags 保存栈并派发 label；④ 各支收尾都调
  `sub_411560(Engine, "CALLBACK_TEXT.BIN")`（本机数据无此文件 ⇒ no-op）。」
- `notes`：**追加**：
  「★2026-09-25 `T-0168` 回体订正：`_this+699260` 的三条 28B 记录是**语音通道槽**，
  不是"回调脚本队列"（消费者 `sub_4BB840` raw 19990 → 体 raw 142489-142519 带
  `VOICEファイル %s の読み込みに失敗しました`）。回调脚本队列是**另一张表** `0x796DC dispatch_queue`
  （`sub_40FC90` 入队 / `sub_40FB60` 派发，帧 37 预占）。
  ★`T-0168` 结论：本函数**不建模**，why + 重开条件 = `tickets/T-0168/changes-wheel.md` §3.3
  （① 产品路径进不去：`0x100000` 的两个置位端都是回看，而回看块被键命中挡死，实测 ADV 里该位恒 0；
  ② 把门条件永不终止：唯一的清位点在它自己体内且要等 `CALLBACK_TEXT.BIN` 跑完，而该文件不在本机 25080 条索引里；
  ③ 其余可观测后果各有落点）。原 notes 里『待实现消息/文本回调系统时再改 emulator』保留。」

### ② `analysis/engine-capabilities.json` · `msgwin-backlog-cursor`

- `note` **追加**（放在已有 T-0167 段之后）：
  「★2026-09-25 `T-0168` 实测（真语料 E3，`test/t0168-wheel-adv-input.test.ts`）：**这条回看路在产品路径上不可达**。
  真 BIN 的键位表里位 **0/1/2/3/7/8** 全被 `0x97` 绑给了路由项（`src/SN0000.txt:79-114`），
  而等待泵的**第一出口** `sub_403D70`（raw 20242）排在回看块（raw 20341）**之前**，且回看块自己还被
  `effect_flags & 0x40000000` 门控 ⇒ 一次滚轮上滚（默认 `set:WheelKeyUp=3`）实测：
  `wheelKeyBits=0x8`、`lastDispatch={label:2817,kind:"key"}`（= `SN0000.txt:770` 的 `label_00002c40`，
  它会 `call label_00000e78` 摆出 22 个侧栏按钮）、`Engine[489816]=0`、`effect_flags & 0x100000 == 0`。
  可复算命令：`cd app/amayui-emulator && node --import tsx --test test/t0168-wheel-adv-input.test.ts`（5/5）。
  ⇒ **"ADV 里上滚 = 打开侧边栏"是引擎默认行为**（不是 emulator 分叉），改代码的地方在配置（`set:WheelKeyUp=8`）而不是这里。」
- （可选）`emulator.guard` 追加 `+ test/t0168-wheel-adv-input.test.ts`。

### ③ 新增能力条目（建议，主 agent 定名）：

`adv-advance-route-table` 已有条目，**不改**；只需在 `input-wheel-two-accumulators` 的 `note` 末尾追加一句：
「★`T-0168`（真语料 E3）：默认 `set:WheelKeyUp=3` 的那一位在 ADV 里**落到路由键命中**（`sub_403D70` raw 20242），
不是回看；见 `test/t0168-wheel-adv-input.test.ts` 与 `changes-wheel.md` §1/§2。」

### ④ `analysis/opcode-gaps.json` · `0x84`（`sub_41F790`）

**不动**（`deferred` + `why` + 扩展点已由主 agent 在 2026-09-24 落库）。
本票只补一条**体证**供其 `why` 引用：`0x84` 的两处置位点（raw 28900 / 28914）与清位点
（raw 28894 / 28929）**都在它自己体内**，且它的输出端是 `effect_flags & 0x100000` ⇒
**与 `sub_411590` 是同一对"置位端 / 把门泵"**（§3.2）。语料仍 **0 处**。

---

## §6 别人该接（文件 + 改什么 + 判据 + raw 锚点）

> 本票**没有**动任何禁改文件；下面几条都是"必须动禁改文件才能做"的，如实登记、不动手。

| # | 文件（归属票） | 改什么 | 判据（怎么算做完） | raw 锚点 |
|---|---|---|---|---|
| 1 | `analysis/functions.json`（台账，归主 agent） | §5 ① 的 `purpose`/`notes` 订正（`0x411590` 的队列身份） | `functions.json` 里 `0x411590` 的 purpose 不再出现"回调队列(_this+699260)"；`node scripts/build-*` 后 `--validate` ✅ | raw 19990 / 142489-142519 / 18968-18975 |
| 2 | `analysis/engine-capabilities.json`（台账，归主 agent） | §5 ② 的 `msgwin-backlog-cursor` 追加段 | 该条 note 含"产品路径不可达 + 实测三值"；`capabilities --validate` ✅ | raw 20242 / 20341 / 20345 |
| 3 | `src/vm/engine.ts`（归 **T-0173**，本轮禁改） | `#advInputDropped`（`engine.ts:1372-1382`）的位号 `& 31` 与引擎 `shl cl` 口径**不一致**（引擎只判 `>= 0` 后裸移位）。**当前 ADV 不可观测**（默认位号 3/1，`& 31` 无差别；实测无影响）⇒ **只登记，不催修**。若要改：`wheelBits = ((1 << (wheelUp & 31)) \| (1 << (wheelDown & 31)))` 两处 `& 31` 去掉会**不忠实**（JS 移位同样取模 32 ⇒ 其实等价），**正确的最小改法 = 保持现状 + 在注释里写明"JS `<<` 与 x86 `shl cl` 都取模 32，故这里显式 `& 31` 只是文档化"**。重开条件：出现位号 ≥ 32 的配置时 | 注释与 `test/t0168-wheel-adv-input.test.ts` 的口径一致 | raw 141604-141606 / `.lst:004B9CBE` |
| 4 | `src/vm/engine.ts`（归 **T-0173**）· `#textRewindWheel` 的注释 | 函数头"已知缺口"那段写「可观测后果：**真机上滚轮回看会弹出「回想/回看」画面**」—— 与同一条台账自己的结论（`sub_411560` 在本树是 no-op）**自相矛盾**，也与本票 §1/§3 矛盾 | 改成「引擎那一跳在本树是 no-op；**画面要出现只能靠路由键把位 8 派发给 `call-script 31`**」 | `engine.ts:1428-1430`；raw 20351 / 19021-19026 |
| 5 | `src/vm/handlers/input.ts`（归 **T-0158**，本轮禁改） | `input.ts:515-522` 那段"**修前**是什么"的叙述时态（`notes.md` §三.6 提出） | 句首加「（修前）」，或改写为现在时事实 | `handlers/input.ts:515-522` |
| 6 | `docs-new/03-engine/input-system.md`（文档） | §15.1 已由 A3 写过；**补 §15.2**：本票 §0 的一整条实测链（真 BIN 键位表 7 项 + 三值 + 侧栏 12 项/22 次 `0x220`）与"上滚=打开侧边栏是默认行为、回看要配 8"的结论 | 文档里有该段且行号引用与 `test/t0168-wheel-adv-input.test.ts` 一致；改完跑 `build-doc-index.mjs` + `doc-model.test.ts` | `src/SN0000.txt:88/770/831`、`$1$SC0330.txt:477-485` |
| 7 | 用户可见说明（落点建议：`docs-new/03-engine/input-system.md` §15.2 的同一段，或发布说明/`CONTEXT.md` §7 的「已知行为」清单） | 写清「滚轮上滚 = 打开侧边栏（引擎默认）；要回看请把 `SYS4REG.INI` 的 `[set] WheelKeyUp` 改成 8；本作无游戏内键位设置界面」 | 用户能据此自助 | raw 111736-111743 / 112705-112718 |

---

## §7 改动文件清单（本票实际落盘）

| 文件 | 规模 | 内容 |
|---|---|---|
| `app/amayui-emulator/test/t0168-wheel-adv-input.test.ts` | **新增**（288 行，LF） | 5 例真语料 E3：键位表 / 上滚派发 / label 体执行 / 下滚 / 与回看泵互斥 |
| `tickets/T-0168/changes-wheel.md` | 新增（本文） | §1-§6 全部结论与交接 |
| `tickets/T-0168/ticket.json` | 修改（tests[]/doneWhy/history） | 收口 |
| `tickets/README.md` | 生成物 | `node scripts/build-tickets.mjs` 重生成 |

**未改**（本票可写面内的 `src/vm/input.ts` / `handlers/input.ts` / `handlers/stubs.ts` / `nativeTap.ts` **一行未动**）：
判据②＝引擎行为、判据③＝不建模、判据④＝不实现 ⇒ **本票没有代码级修复**，全部产出是结论 + 一条真语料守卫。
