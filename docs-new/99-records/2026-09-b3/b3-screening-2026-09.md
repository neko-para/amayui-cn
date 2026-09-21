---
kind: record
state: consumed
superseded_by: analysis/opcode-gaps.json
---
# B3 剩余未实现指令 · 逐条筛体（2026-09）

> 真源 = `analysis/opcode-gaps.json` 里 `disposition === "unimplemented"` 的条目（本次 35 条）。
> **唯一权威 = 引擎反编译 `engine/天结_unpacked.exe_utf8.c`**；emulator（`app/amayui-emulator/…`）只用于
> 核对「现在注册了没有」，不作为「引擎在做什么」的信息源。
> 本文是**筛查结论**，不是实现记录；窗口期后 `disposition` 会随实现推进而变化（以 JSON 为准）。

## 0. 范围与口径

**本次筛体 32 条**：`opcode-gaps.json` 的 35 条 `unimplemented` 里**排除 3 条**（`0x24f`(sub_4258F0) /
`0x250`(sub_425980) / `0x251`(sub_425A10) —— 另有并行 agent 处理，本文不动）。

**读体纪律**：32 条**全部逐条读了函数体**（用 `//----- (XXXXXXXX) -----` 定义头定位，不按邻近常量猜位置；
表里的「体起始行」= 该定义头所在行，raw 行区间 = 本人实际读过的范围）。反编译里凡出现
`// XXXXXX: using guessed type …` 无体的符号，都继续追到真身（本次涉及的 `j_D3DXMatrix*` / `sub_453530`
一类导入 thunk 已按此追）。

**判定口径**（来自交接文档的筛体规则，硬纪律）：

| 判定 | 判据 |
|---|---|
| **deferred** | 体内出现 `sub_4Bxxxx`（设备族）/ `sub_4675A0`（GDI 文本族）/ `sub_441060`（DDraw）/ `sub_489xxx`·`sub_406DF0`（音频属性族）⇒ 卡子系统，**不硬接**，但必须写清扩展点 |
| **deferred（需新模型）** | 只动操作数/字段，但字段宿主是引擎侧 emulator 完全没有的子系统/表（音频播放对象族、3D 网格与效果管理器、鼠标点击队列、GDI region、帧缓冲 blit、外部服务、宿主窗口） |
| **可实现** | 只动操作数 / 引擎字段（且**该字段的消费端已在 emulator 建模**）或只走已有宿主缝 ⇒ 不需要新模型 |

**量产/量级口径**：语料命中数当场用 `scripts/build-opcode-gaps.mjs` 的 `scanCorpus` 重算（`src/*.txt` 941 本），
不引用 JSON 里的旧数字；`argc` 取自 `scripts/asm/opcodes.json`（= 引擎 arity 槽 `/4`）。

---

## 1. 逐条筛体表（按语料命中数降序）

| opcode | 助记符 | 语料/文件 | argc | handler | 体起始行 | 体内真实行为（raw 行区间） | 判定 | 若要实现需要什么 |
|---|---|---|---|---|---|---|---|---|
| 0x133 | i133 | 10/5 | 2 | sub_422240 | 30683 | 队列 **push**：`v2 = op1`（>0xA ⇒ 打「ADDQ」错误串）→ `sub_409E10(Engine[4*v2+388252], op2)`；容器构造器 `sub_407C50`（12653-12663）= `Queue_int`：`vftable + new[0x400] + cap=256 + 读写游标 0`（30683-30701） | **可实现** | 见 §2：`Engine.dispatchQueues[0..10]`（11 条 `number[]`） |
| 0x222 | i222 | 10/10 | 2 | sub_423EC0 | 31924 | `sub_4B4460(_this + 80770&nbsp;… +80708, op1, op2)`（31924-31934）—— 真身 raw 136968 起、150+ 局部、在 `Scene+1036/+1068/+1100/+16424` 四张场景表里按键范围查项、调 `sub_4535F0(v50[12676], key)` 选中/多选并清 `+0x10000` 位（`SETPOLYGON`/`INFOxx` 10 处） | **deferred**（设备族 `sub_4Bxxxx`） | 见 §2：需要宿主侧「场景多边形/拾取范围」原语（`sub_4B4460` 是 `Scene+80708` 的多选拾取），emulator 无该层 |
| 0x87 | i87 | 9/5 | 0 | sub_418F80 | 24478 | `_this[465&nbsp;… ]` 记 arity=1 → `sub_4B8660(_this + 174137)`（取 `HCURSOR`，设备族）→ 若 `_this[18652]` 非 0 再 `sub_4B7D20(_this + 7912)`（DDraw/2D 刷新）⇒ 返回值是**宿主光标**（24478-24488） | **deferred**（设备族 + DDraw） | 见 §2：需要宿主窗口/光标子系统（`sub_4B8660`/`sub_4B7D20`） |
| 0x232 | i232 | 8/6 | 4 | sub_424440 | 32131 | `*v |= 4u`（bit2）+ `+524=0`（延迟窗起点）+ `+544=op2`（时长）+ `+576=ARGB(op3 α 夹 255, op4)`（32131-32164 → sub_4AD730 raw 132241-132258）⇒ **颜色窗（窗0）的参数面**，与 `0x202` 同一组字段 | **可实现** | 见 §2：转发 `native.setDrawColor(handle, 0, op2, argb)`（**订正旧结论**，见 §4） |
| 0x22f | i22f | 7/6 | 5 | sub_424330 | 32087 | op1=handle、op2=旋转轴下标、op3/4/5=轴分量（float）→ `sub_49A9C0(_this+80708, …, a3, a4,a5,a6)`（32087-32103）：写 Scene 的 `+293=0 / +295 / +300` + `+280 \|= 2` + `+306=1` ⇒ **Scene 级旋转轴/角度**（与 `sub_49A870` 同族） | **可实现** | 见 §2：转发 `native.setRotationAnim`/新 `native.setSceneRotation` |
| 0x22c | i22c | 6/6 | 3 | sub_424180 | 32034 | op1=handle、op2/3/4=float → `sub_49A820(_this+80708, a2,a3,a4)`（32034-32046）：`_this[306]=1` + `D3DXMatrixTranslation(_this+371, …)`（117153-117162）⇒ **Scene 级立即平移** | **可实现** | 见 §2：转发 `native.setDrawTranslation` |
| 0xd0 | id0 | 6/2 | 1 | sub_42E910 | 38790 | arity=3；`sub_42B4B0(_this, 1, timeGetTime())`（38790-38798）⇒ **op1 = 墙钟毫秒**（无门、无副作用） | **可实现** | 见 §2：写 `Math.trunc(c.e.wallClockMs)`；守卫断言「op1 = 注入的墙钟」 |
| 0x236 | i236 | 6/3 | 4 | sub_4246B0 | 32221 | 惰性建/取 `Engine[4*v2+378688]` 的**网格对象**（`operator new(0x480)` + `sub_489040`）→ `sub_488DC0(…, Engine[80653], Engine[96981], 文件名)` 读文件（失败抛「メッシュファイル」）→ 等级/尺寸/体积（`sub_4054D0`/`sub_405460`/`sub_408350`/`sub_4885A0`/`sub_4081B0`）→ `sub_4879B0`；`Engine[168993]=1`（32221-32288） | **deferred（需新模型）** | 见 §2：需要「网格/立绘节点」子系统（`sub_479A50`/`sub_47A0E0`/`sub_4879B0` 一族）+ 3D mesh 装载 |
| 0x36 | i36 | 5/3 | 3 | sub_41E7E0 | 28168 | arity=7；`effect_flags \|= 8`（非 ADV 时）→ `sub_453A60(Engine+429844, op3)`（计时器起）+ `sub_441410(_this+7912, op1, op2, 9, 0xA0, 0)`（DDraw/2D 效果，`+7912` 是 DDraw 对象）+ 十字缓冲保存/复原（28168-28200） | **deferred**（DDraw `sub_441410`/`sub_441060`） | 见 §2：需要 DDraw/2D 特效宿主 blit 缝 |
| 0x22d | i22d | 5/2 | 5 | sub_4241F0 | 32048 | op1/op2=int、op3/4/5=float（前两个 `/dbl_5201F0`=÷100）→ `sub_49A870(_this+80708, a2,a3,f,f,f)`（32048-32064 → 117165-117179）：`+280 \|= 2`、`+293=0`、`+295/+300`、`+306=1`、`+323`=缩放矩阵、`+11627/+11629` 置脏 ⇒ **Scene 级立即缩放** | **可实现** | 见 §2：转发 `native.setScale`（÷100 口径） |
| 0x132 | i132 | 5/5 | 1 | sub_422150 | 30647 | 队列 **reset/重建**：`v2 = op1`（>0xA ⇒ 打「RESETQ」错误串）；否则析构旧队列（`(**v4)(v4,1)`）→ `operator new(0x1C)` → `sub_407C50`（`Queue_int` 构造：`new[0x400]`、cap 256）→ `Engine[4*v2+388252] = 新队列`（30647-30680） | **可实现** | 见 §2：`Engine.dispatchQueues[op1] = []`（+ 非法下标打错误串） |
| 0x134 | i134 | 5/5 | 3 | sub_42F810 | 39359 | 队列 **pop**：`v3 = Engine[4*op1+388252]`；`rd < wr` ⇒ `v5 = [1][rd]`、`rd++`、`max` 更新、`v6 = 1`，否则 `v5 = 未初值`、`v6 = 0`；`sub_42B4B0(_this, 2, v6)`、`(_this, 3, v5)`（39359-39398） | **可实现** | 见 §2：`op2 = 成功位 / op3 = 值`（空队列 ⇒ op2=0，op3 写 0） |
| 0x233 | i233 | 5/4 | 5 | sub_424510 | 32166 | op1=handle、op2=时长、op3/4/5=缩放（float，`/dbl_5201F0`=÷100）→ `sub_4AD7B0(_this+80708, …)`（32166-32182 → 132260-132286）：`*v \|= 4u`（bit2）+ `+528=0` + `+548=op2`（时长）+ `D3DXMatrixScaling(元素+592, sx,sy,sz)` ⇒ **缩放窗（窗1）**，与 `0x21E` 同字段 | **可实现** | 见 §2：转发 `native.setScaleAnim(handle, 0, op2, op3/100, op4/100, op5/100)` |
| 0x2fd | i2fd | 4/4 | 6 | sub_431CF0 | 40829 | 读鼠标**点击队列**：`n = op6`；`sub_477A60(Input, pts, types, ids, &count, n)`（92168-92225：遍历 40B/条的点击记录、`frFlags & 4` 过滤、`ScreenToClient` 后回填坐标）⇒ 逐点写回 float/flag 数组，`sub_42B4B0(_this, 1, 1)` 成功（40829-40900+） | **deferred（需新模型）** | 见 §2：需要「鼠标点击队列」（`Input+6780` 起的 40B 记录）+ 消费语义 |
| 0x234 | i234 | 4/2 | 5 | sub_4245B0 | 32185 | op1=handle、op2=时长、op3/4/5=平移（float，**不除**）→ `sub_4AD850(_this+80708, …)`（32185-32201 → 132289-132314）：`*v \|= 4u` + `+532=0` + `+552=op2` + `元素[145..147] = x,y,z` ⇒ **平移窗（窗3）**，与 `0x220` 同字段 | **可实现** | 见 §2：转发 `native.setTranslationAnim(handle, 0, op2, x, y, z)` |
| 0x32c | i32c | 4/1 | 6 | sub_426FC0 | 34012 | 读 op1..op6 六个 float → `sub_499CE0(_this+80708, …)`（34012-34030 → 116427 起）⇒ 写 Scene 的 `+41960..+41984` 一组 float + 三个 16 dword 缓冲（3D 天气参数下发） | **deferred（需新模型）** | 见 §2：需要 3D 天气/粒子参数面（与 `0x325`/`0x326` 同族） |
| 0x25 | i25 | 4/1 | 3 | sub_41D590 | 27393 | arity=7；`effect_flags \|= 8`（非 ADV）→ `sub_453A60(Engine+429844, op3)` + `sub_441410(_this+7912, op1, op2, 4, w, 0)` + 十字缓冲（27393-27430，语料 `REIGN`/`STAGERAID`） | **deferred**（DDraw `sub_441410`） | 见 §2：DDraw/2D 特效宿主 blit 缝 |
| 0x22a | i22a | 2/2 | 3 | sub_424080 | 32003 | op1=handle、op2/3/4=float（**全 `/dbl_5201F0`=÷100**）→ `sub_49A720(_this+80708, f,f,f)`（32003-32016 → 117117-117126）：`_this[306]=1` + `D3DXMatrixScaling(_this+307, …)` + 置脏 ⇒ **Scene 级立即缩放（÷100）** | **可实现** | 见 §2：转发 `native.setScale`（÷100） |
| 0x23a | i23a | 1/1 | 2 | sub_4306F0 | 39990 | arity=5；`v2 = Engine[op2 + 91322]`（节点表）；`v2==0` ⇒ `op1 = 0`，否则 `op1 = (*(v2+1068) != 0)`（39990-40001）⇒ **节点布尔 getter**（「有没有」/是否可见一类） | **可实现** | 见 §2：`Engine.nodeTable`（`0x344` 一族的 572B 立绘节点）+ `node +1068` 布尔字段 |
| 0x241 | i241 | 1/1 | 5 | sub_424FA0 | 32576 | 惰性建/取 `Engine[4*op2+378688]` 的**音频/播放对象**（`operator new(0x480)` + `sub_489040`）→ `sub_488DC0` 装载 + 抛错门 → `sub_489230(…, FileDB, op1, ptr)` → `sub_4054D0`/`sub_405460` 音量标志 → `sub_4879E0`/`sub_4885A0`（音量 = `Engine[5008]*sub_408350(...)/10000`）/`sub_4081B0` → `sub_4879B0`；`Engine[168993]=1`（32576-32645） | **deferred（需新模型）** | 见 §2：需要音频播放对象族（`sub_489xxx`）+ 音量/时间轴 |
| 0x82 | i82 | 1/1 | 5 | sub_41F720 | 28808 | arity=11；读 op1..op5 → `sub_466000(_this + 21324, op1, op2, op3, op4, op5, _this + 21032)`（28808-28826）—— `_this+21324` 是 **GDI 文本对象**（`sub_466000` 在 `sub_4675A0` 一族隔壁，raw 79319 起） | **deferred**（GDI 文本族） | 见 §2：需要 GDI 文本对象/字形度量与 `+21032` 那层掩码 |
| 0x147 | i147 | 1/1 | 6 | sub_42FD60 | 39655 | 读 op2/op3=点 (x,y)、`op4/op5` = 两个数组基址、`op6=n`；逐点 `DEC(ror(key^rol(v,11),25))` 解出 n 个 `POINT` → `CreatePolygonRgn(pts, n, 2)` → `PtInRegion` → `op1 = 命中`（39655-39700）—— **GDI region 命中测试** | **deferred**（GDI region 族） | 见 §2：需要 GDI region 原语（或宿主侧多边形命中） |
| 0x1c4 | i1c4 | 1/1 | 1 | sub_42E8A0 | 38773 | arity=3；`v2 = sub_404CB0(_this + 84128)`（10583-10598：容器 `[258]` 非空 + 前 3 槽按 `flags&3==3` / `sub_4B6130(槽, i+12)` 判存在）→ `op1 = (v2 != 0)`（38773-38781） | **可实现** | 见 §2：`Scene` 里「是否已挂项」的存在性判定（用 `Item.flags` 或 `texSlots`） |
| 0x85 | i85 | 1/1 | 0 | sub_418F50 | 24471 | arity=1；`sub_45EBE0(_this + 21324)`（74182-74194：**同一 GDI 文本对象**的两条 `std::vector` 清空 + `sub_45D1B0(…, 0)` 归零）⇒ 清文本对象内部缓冲 | **deferred**（GDI 文本族） | 见 §2：需要 GDI 文本对象的行/段容器模型 |
| 0x2f2 | i2f2 | 1/1 | 6 | sub_4318A0 | 40687 | 读 op2/op3=点、`op4`=数组基址（4 个 int：l/r/t/b，逐个 DEC）、op5/op6=偏移 → `CreateEllipticRgnIndirect(&rect)` → `PtInRegion` → `op1 = 命中`（40687-40721）—— **椭圆 GDI region 命中** | **deferred**（GDI region 族） | 见 §2：同 `0x147` |
| 0x144 | i144 | 1/1 | 2 | sub_433AB0 | 42064 | op1/op2 各作**有界 1024B 拷贝**（手写 memcpy 循环）→ 组 `{str1, str2, 0}` → **`dword_55E1B4(10, Engine[96981], &v13)`**（外部服务，cmd=10）→ 两个返回值 `sub_433310(_this, 1/2, …)` 写回 op1/op2；前后按 `Engine[167990]` 套 `sub_406050`/`sub_406220`（显示模式）（42064-42153） | **deferred（需新模型）** | 见 §2：`dword_55E1B4` = 运行时取得的外部服务（同 `0x140` 的 cmd=8 表弟），**静态定不了目标** |
| 0x26 | i26 | 1/1 | 4 | sub_41D6A0 | 27432 | arity=9；`op4 ∈ [0,4]` 校验（否则打「COMEFWP」错误串）；非 ADV 时 `sub_443B20(_this+7912, x, y, op4)`（52623 起，DDraw/2D 特效）成功 ⇒ `effect_flags \|= 0x10` + `sub_453A60(Engine+429872, op2)`（27432-27464） | **deferred**（DDraw `sub_443B20`） | 见 §2：DDraw/2D 特效宿主 blit 缝 |
| 0x2b | i2b | 1/1 | 5 | sub_41DA20 | 27567 | arity=11；`op5 ∈ [0,4]` 校验（否则「COMEFRB」错误串）；非 ADV 时 `sub_445D70(_this+7912, op1, op3, op4, op5)` 成功 ⇒ `effect_flags \|= 0x80` + `sub_453A60(Engine+429956, op2)`（27567-27601） | **deferred**（DDraw `sub_445D70`） | 见 §2：DDraw/2D 特效宿主 blit 缝 |
| 0x327 | i327 | 1/1 | 1 | sub_426E70 | 33956 | arity=3；`sub_453280(Engine[93384], op1)`（65570 起）—— 释放 3D 效果管理器 `[258]` 旧对象 → `new(0x29C)` + `sub_48E370`（`&Rain___vftable_`）**重建 Rain**（33956-33964） | **deferred（需新模型）** | 见 §2：需要 3D 效果/天气子系统（管理器 = `Engine[93384]`，Rain/Snow/Leaf 三类） |
| 0x329 | i329 | 1/1 | 2 | sub_426EB0 | 33966 | 读 op1=统一资源 id、op2=槽 → FileDB 解析 + `sub_455560` 取字节 → `sub_4A0640(_this+322832, FileDB, id, hFile, size, op2)`（121066-121102：`GlobalAlloc`+`ReadFile` → `sub_47A0E0` 建网格对象 → `sub_47A140` 解析）⇒ **装载 3D mesh**，失败抛「メッシュファイル %s の読み込みに失敗しました」（33966-34000） | **deferred（需新模型）** | 见 §2：需要 3D 网格装载（`sub_47A0E0`/`sub_47A140`）+ `Engine[4*槽+12677]` 表 |
| 0x32e | i32e | 1/1 | 11 | sub_427110 | 34057 | 读 op9=α（夹 255）、op10=RGB、op3..op8=六个 float、op11=float、op2=索引 → `sub_49A080(_this+80708, op1, op2, x,y,z, w, a,b, 4 个归一化通道, op11)`（34057-34113）⇒ 3D 图元的变换+顶点色+时间参数 | **deferred（需新模型）** | 见 §2：需要 3D 图元/效果参数面 |
| 0x328 | i328 | 1/1 | 3 | sub_432300 | 41080 | 读 op1=handle、op2=网格 id **数组基址**、op3=数量；把数组元素逐个 `DEC` 到临时数组 → `sub_4183F0(Scene, op1, 临时数组, op3)`（失败「Set3DEffectLeaf エラー：メッシュが作成されていません」）→ `new(0xA0)` + `sub_478CC0` **重建 Leaf** + 逐槽 `sub_4534F0`（41080-41113） | **deferred（需新模型）** | 见 §2：同 `0x327`（Leaf 变体） |

> 表内「语料/文件」= 当场重算值（如 `0x222` 10/10、`0x32c` 4/1 与 JSON 旧注的「审计 P1」数字不同——**旧注的数字已过期**）。

---

## 2. 可实现清单（逐条最小实现方案）

### 2.1 `0x132` / `0x133` / `0x134` —— 通用 `Queue_int` 队（**族**）

**引擎真源**：容器 = `Engine + 258`（字节）里的 11 个 `Queue_int*`（`Engine[4*i + 388252]`，i=0..10）。
`sub_407C50`（raw 12653-12663）= 构造：`vftable + new[0x400]（256 int）+ cap=256 + rd/wr=0`；
`sub_409E10`（14280 起）= push；`sub_409D40`（14244 起）= 另一个 push 变体；pop 本体在 `0x134` 的 handler 里内联。

- **改哪个文件**：`src/vm/handlers/control.ts`（新 `op_queue_reset/push/pop`）；新增字段放 `src/vm/engine.ts`。
- **写哪些字段**：`Engine.dispatchQueues: number[][]`（长度 11，默认 `[]`）——
  `0x132`：`dispatchQueues[op1] = []`（`op1 > 0xA` ⇒ 走既有错误串路径、不改队列）；
  `0x133`：`dispatchQueues[op1].push(op2)`；
  `0x134`：`const v = q.shift()`；`op2 = v === undefined ? 0 : 1`；`op3 = v ?? 0`。
  ★`op3` 在空队列时引擎是**未初始化局部量**（raw 39392 的 `v8`，Hex-Rays 标注 "possibly undefined"），
  语料（`src/ATSEEK.txt:22-29`：`i134 0 (local-int 0) (local-int 1)` 后紧跟 `jcc (local-int 0)`）只读 `op2` ⇒
  写 0 是安全口径，须在 handler 注释里披露。
- **宿主缝**：**不动**（纯 VM 侧状态）。
- **`opcode-table.md` 要补什么**：三条各一行语义（容器 = `Engine+258` 起的 `Queue_int[11]`、构造 = `sub_407C50`、
  push/pop 语义 + 空队列口径），并回链本文。
- **守卫测试怎么写**：仿 `test/op-223-item-region.test.ts` 的 `run(op, vals)` 骨架，新增
  `test/op-132-134-queue.test.ts`：① `0x132` 后 `e.dispatchQueues[0]` 为空且**旧内容被丢弃**；
  ② `0x133` 压入 `0xDEADBEEF` ⇒ 队列长度 1；③ `0x134` ⇒ `dec(op3) === 0xDEADBEEF && op2 === 1`；
  ④ 再 `0x134` ⇒ `op2 === 0`；⑤ `0x132` 传 0xB（>0xA）⇒ 队列不变。

### 2.2 `0x22a` / `0x22c` / `0x22d` / `0x22f` / `0x233` / `0x234` —— Scene 立绘/图元变换面（**族**）

**引擎真源**：`sub_49A720`（raw 117117-117126，立即缩放，÷**100**）、`sub_49A820`（117153-117162，立即平移）、
`sub_49A870`（117165-117179，立即缩放+轴）、`sub_49A9C0`（117222 起，立即旋转轴）、
`sub_4AD7B0`（132260-132286，缩放窗）、`sub_4AD850`（132289-132314，平移窗）。
**这些字段的消费端在 emulator 已建模**：窗的 delay/dur/锁存起点 = `Item.wins[*]` + `animStart`（`drawitem/animWindow.ts`），
目标矩阵 = `scaleTarget`/`transTarget`/`rotTarget`（`setters.ts`），立即矩阵 = `applyDrawScale`/`applyDrawTranslation`。

- **改哪个文件**：`src/vm/handlers/gfx-item.ts`（新 6 个 `op_*` + 加进 `GFX_ITEM_NATIVE_OPS`）。
- **写哪些字段**：
  - `0x22a` → `native.setScale(handle, op2/100, op3/100, op4/100)`（★`sub_49A720` 与 `0x1FD` 同构，**÷100**）；
  - `0x22c` → `native.setDrawTranslation(handle, op2, op3, op4)`（不除）；
  - `0x22d` → `native.setScale(handle, op3/100, op4/100, op5/100)` + 轴 `(op1,op2)`（引擎另写 Scene 的 `+295/+300`，
    emulator 可按 `native.setRotationAnim(handle, 0, 0, …)` 的等价形式落目标轴即可，须注释披露近似）；
  - `0x22f` → 同 `0x22d` 的轴/角口径（`op3/4/5` 为 float，**不除**）；
  - `0x233` → `native.setScaleAnim(handle, 0, op2, op3/100, op4/100, op5/100)`（★delay=0：`+528=0` 是**锁存起点**，不是 delay）；
  - `0x234` → `native.setTranslationAnim(handle, 0, op2, op3, op4, op5)`（同上，**不除**）。
- **宿主缝**：`0x22d`/`0x22f` 若要严格，需要新缝 `native.setSceneRotation?(handle, axisIdx, ax, ay, az)`；
  其余复用现有 `setScale`/`setDrawTranslation`/`setScaleAnim`/`setTranslationAnim`。
- **`opcode-table.md` 要补什么**：6 行（各写「字段 = 哪个矩阵/哪个窗」+ `÷100` vs 不除的差异 + 与 `0x1FD`/`0x1FF`/`0x21E`/`0x220` 的对应关系）。
- **守卫测试怎么写**：仿 `test/op-23f-slot-size.test.ts` 的 `StubNative` 记录参数骨架，新增
  `test/op-22a-234-scene-transform.test.ts`：断言 `0x22a (h 64 64 64)` 让 stub 收到 `(1,1,1)`（÷100）、
  `0x233 (h 5 32 64 64)` 收到 `setScaleAnim(h, 0, 5, 0.32, 0.64, 0.64)`、`0x234 (h 5 1 2 3)` 收到 `setTranslationAnim(h, 0, 5, 1, 2, 3)`。

### 2.3 `0x230` / `0x231` / `0x232` / `0x235` —— 窗的「停/转/色/翻」四条（**族**）

**引擎真源**：`sub_4AD580`（raw 132151-132217，**停**）、`sub_4AD690`（132220-132239，**转**）、
`sub_4AD730`（132241-132258，**色**）、`sub_4A…`（`0x235` → `sub_4AD900`，132316-132342，**翻**）。

- **改哪个文件**：`src/vm/handlers/gfx-item.ts`。
- **写哪些字段**：
  - `0x232` → `native.setDrawColor(handle, 0, op2, ((op3 & 0xff) << 24) \| (op4 & 0xffffff))`
    （引擎 `+544 = op2 = 时长`、`+576 = α<<24\|rgb`，与 `0x202` 同字段）；
  - `0x235` → `native.setFlipbook(handle, 0, op2, op3, op4, op5)`（引擎 `+560/+568/+572`，与 `0x239` 同字段）；
  - `0x231` → `native.setRotationAnim(handle, 0, op2, ax, ay, az, deg)`（引擎 `+552 = 时长`、`+592` 起 16 float = 旋转矩阵）；
  - `0x230` → **新缝** `native.stopColorAnim?(handle)`：清 `Item.flags` bit2 + 把 `wins[W_COLOR].set = false`
    （`from` 不动 ⇒ 冻结当前色）。引擎本体是「`*v &= ~4u` + 6 个 `+540/+544/…/+564` 窗字段清零」，
    即「停掉全部动画窗、冻结当前 work 状态」。
- **宿主缝**：`0x230` 需要加 `stopColorAnim?`（`native.ts` + `stubNative.ts` + `headlessScene.ts` + `pixiBackend.ts` 四处）；
  实现可只做「清 bit2 + 清 `wins[W_COLOR].set`」。其余三条复用现有缝。
- **`opcode-table.md` 要补什么**：4 行，并**同时订正**该族旧的「bit2 渲染语义未建模」叙述（见 §4）。
- **守卫测试怎么写**：`test/op-230-235-windows.test.ts`：① `0x202` 起一个颜色窗 ⇒ `0x230` 后 `itemColor` 不再随时间变
  （等于冻结值）；② `0x232 (h 3 5 9)` ⇒ stub 收到 `setDrawColor(h, 0, 5, 0x09...)`；
  ③ `0x235 (h 1 2 3 4 5)` ⇒ `setFlipbook(h, 0, 1, 2, 3, 4)`。

### 2.4 单条

- **`0xd0`（id0，6/2）**：`src/vm/handlers/engine-fields.ts`（与 `0xAD` 秒计时器同族），
  `writeIntOperand(c, 1, Math.trunc(c.e.nowMs))`。
  ★**订正（实现轮实测）**：本页初稿写的 `Engine.wallClockMs` **在工程里不存在**（全仓无此标识符）；
  `timeGetTime()` 的既有等价物是 **`Engine.nowMs`**（`frame/loop.ts` 的 `e.nowMs = host.now()`，`0xAD` 秒计时器与 `0x23C` 帧时钟用的是同一个）
  ⇒ 落 `Math.trunc(c.e.nowMs) | 0`，**不新增同义字段**。已落地为 `ENGINE_FIELD_OPS` 的 `op_wall_clock_ms`（守卫 `test/op-d0-wallclock.test.ts`）。
  守卫：注入 `nowMs = 123456` ⇒ 读回 op1 = 123456；并断言**不注册进 no-op 表**。
  `opcode-table.md` 补：「op1 = `timeGetTime()`（墙钟 ms）；与 `0x2FA`/`0x2E9` 无关」。
- **`0x1c4`（i1c4，1/1）**：`src/vm/handlers/gfx-item.ts`（Scene 存在性族，与 `0x215` 同类）。
  引擎 = `sub_404CB0(_this+84128)`：容器 `[258]` 非空且前 3 槽里有「已挂项」⇒ 1；
  emulator 等价 = `c.native.hasDrawItems?.()` 或直接判 `Scene` 的 `drawItems.size > 0`。
  守卫：空场景 ⇒ op1=0；`draw-texture` 建一项后 ⇒ op1=1。
- **`0x23a`（i23a，1/1）**：`src/vm/handlers/gfx-item.ts`。
  `v2 = Engine[op2 + 91322]` ⇒ emulator 侧 = `e.nodeTable.get(op2)`（`0x344` 一族 572B 立绘节点，**已在 `0x344` 建模**）；
  `op1 = (v2 && (node.bool1068 !== 0)) ? 1 : 0`。若 `node +1068` 无对应字段 ⇒ **先补该布尔字段 + 消费端**，
  否则就是「有写无读」（`check:dead-writes` 会红）。守卫：缺节点 ⇒ 0；节点 `+1068` 置 1 ⇒ 1。

---

## 3. 归口 `deferred` 清单（逐条一句话扩展点）

| opcode | 助记符 | 语料/文件 | 一句话原因 | 扩展点（要让这条能实现需要先建什么） |
|---|---|---|---|---|
| 0x222 | i222 | 10/10 | 走 `sub_4B4460`（`sub_4Bxxxx` 设备族）= `Scene+80708` 的 150+ 行场景多边形拾取 | 宿主侧「场景多边形/拾取范围」原语（`Scene+1036/+1068/+1100/+16424` 四表按键范围选中） |
| 0x87 | i87 | 9/5 | 返回 `HCURSOR`（`sub_4B8660`）并走 DDraw 刷新（`sub_4B7D20`） | 宿主窗口/光标子系统（`Engine+174137` 设备对象） |
| 0x2fd | i2fd | 4/4 | 走 `sub_477A60` 读**鼠标点击队列**（`Input+6780` 的 40B 记录） | 鼠标点击队列 + `ScreenToClient` 等价物（宿主输入层） |
| 0x36 | i36 | 5/3 | 走 `sub_441410`/`sub_441060`（DDraw/2D 对象 `Engine+7912`） | DDraw/2D 特效的宿主 blit 缝 |
| 0x25 | i25 | 4/1 | 同上（`sub_441410`，`Engine+7912`） | 同上 |
| 0x2b | i2b | 1/1 | 走 `sub_445D70`（`Engine+7912`） | 同上 |
| 0x26 | i26 | 1/1 | 走 `sub_443B20`（`Engine+7912`） | 同上 |
| 0x32c | i32c | 4/1 | 写 Scene 的 `+41960..` 天气/粒子参数面（`sub_499CE0`） | 3D 天气/粒子参数面（与 `0x325`/`0x326` 同族） |
| 0x236 | i236 | 6/3 | 惰性建**网格对象**并从文件装载（`sub_489040`/`sub_488DC0`/`sub_4879B0`） | 网格/立绘节点子系统（`Engine[4*idx+378688]`）+ 3D mesh 装载 |
| 0x241 | i241 | 1/1 | 惰性建**音频播放对象**并设音量/时间轴（`sub_489040`/`sub_489230`/`sub_4885A0`/`sub_4879B0`） | 音频播放对象族（`sub_489xxx`）+ 音量档位与时间轴 |
| 0x82 | i82 | 1/1 | 走 `sub_466000`（GDI 文本对象 `Engine+21324`）+ `Engine+21032` 掩码层 | GDI 文本对象/字形度量/掩码层 |
| 0x85 | i85 | 1/1 | 走 `sub_45EBE0`（同一 GDI 文本对象的两条 `std::vector`） | GDI 文本对象的行/段容器模型 |
| 0x147 | i147 | 1/1 | `CreatePolygonRgn` + `PtInRegion`（GDI region 命中） | GDI region 原语（或宿主侧多边形命中测试） |
| 0x2f2 | i2f2 | 1/1 | `CreateEllipticRgnIndirect` + `PtInRegion` | 同 `0x147` |
| 0x144 | i144 | 1/1 | 走 `dword_55E1B4(10, …)`**外部服务**（静态定不了目标） | 运行时取得的外部服务表（须真机观察/动态调试） |
| 0x327 | i327 | 1/1 | 重建 3D 效果管理器 `[258]` = Rain（`sub_453280` + `&Rain___vftable_`） | 3D 效果/天气子系统（管理器 = `Engine[93384]`） |
| 0x329 | i329 | 1/1 | 从文件装载 3D mesh（`sub_4A0640`：`GlobalAlloc`+`ReadFile`+`sub_47A0E0`） | 3D 网格装载 + `Engine[4*槽+12677]` 表 |
| 0x328 | i328 | 1/1 | 重建 3D 效果 Leaf + 逐槽挂网格（`sub_4183F0`/`sub_4534F0`） | 同 `0x327`（Leaf 变体） |
| 0x32e | i32e | 1/1 | 下发 3D 图元变换+顶点色+时间参数（`sub_49A080`） | 3D 图元/效果参数面 |

> 另有 **6 条本轮由 `unimplemented` 改判 `deferred`**（`0x140`/`0x86`/`0x1ba`/`0x1d0`/`0x1d1`/`0xc1`）——
> 它们已按筛体规则读过体/既有族结论归口（见 §4）。

---

## 4. 筛体过程中订正的旧结论

1. **★整族订正：`0x230`/`0x231`/`0x232`/`0x235`（含已 `deferred` 的 `0x230`）旧注说「bit2 的消费端 = 引擎 `+536/+556/+560/+568/+572` 渲染字段，emulator 未建模 ⇒ 先写位即死写」——与体不符。**
   - 逐条读体：`+524/+528/+532/+536` = **四条窗的「延迟窗起点」字段**（`+540` 是第 5 条），
     `+544/+548/+552/+556` = **四条窗的时长**，`+560/+568/+572/+576` = flipbook 参数 / 颜色值，
     `+592..` / `+656..` = 缩放/平移目标矩阵。
   - 这些字段的消费端 = 逐帧求值器 `sub_49AA30` 的 **raw 118102-118360**（颜色 lerp / 缩放 / 旋转 / 平移 / flipbook），
     而这套逐帧语义 emulator **已经建模**（`drawitem/animWindow.ts` + `eval.ts` + `colorMath.ts`，含 `flags & 2` 门、
     delay/dur 窗、整数 lerp 截断）。
   - ⇒ 四条**不是卡渲染消费端**，而是与 `0x202`(色)/`0x239`(翻)/`0x21F`(转)/`0x220`(平移窗) **同字段、同宿主缝**；
     应改判「可实现」（详见 §2.3）。唯一需要新缝的是 `0x230`（停窗+冻结）。
2. **`0x232` 与 `0x202` 的关系**：`0x202` 的 handler（`sub_423390` 一族）与 `sub_4AD730` 写的是**同一组** `+524/+544/+576`；
   `0x232` 只是操作数编码不同（时长放 op2、颜色拆成 op3=α + op4=rgb），落地直接转发 `native.setDrawColor` 即可。
3. **旧注的语料数字过期**：`opcode-gaps.json` 里若干 note 写的「语料 N 处/M 文件」与本轮重算值不一致
   （例：`0x235` 注写 158/52、实测 4/2；`0x230` 注写 116/43、实测 1/1；`0x231` 注写 25/17、实测 1/1；
   `0x241` 注引 `0x23F` 的「同族 node 表」但实测 `0x241` 走的是**音频播放对象**）。
   ⇒ 建议后续一律以生成器实时值为准，note 里不再写死数字。
4. **`0x22f` 不是「图元尺寸动画」**：旧注/审计（`op-3-002`）把它记成读 `op3/4/5` float 的尺寸动画；
   体（raw 32087-32103）实为 **Scene 旋转轴/角度**（`sub_49A9C0`，写 `+280 \|= 2` / `+293/+295/+300` / `+306`）。
5. **`0x241` 与 `0x236` 不是消息窗/文本族**：两者都走 `Engine[4*idx + 378688]` 的对象族
   （`sub_489040` 建对象 + `sub_488DC0` 从 FileDB 装载 + `sub_4879B0`/`sub_4879E0` 收尾），
   即**音频播放对象 / 网格对象**，不是 `Engine+21324` 的 GDI 文本对象。
6. **`0x134` 的 op3 在空队列时是未初始化量**（raw 39392 的 `v8`，Hex-Rays 标 "possibly undefined"）——
   语料（`src/ATSEEK.txt:22-29`）只读 op2，所以实现写 0 是安全口径；须在 handler 注释披露。
7. **6 条旧注写「**未读体**⇒实现前必须先读体」的条目已被本轮读完**（`0x232`/`0x22f`/`0x22c`/`0x236`/`0x82`/`0x1c4`/`0x147`/…），
   相应 note 的「未读体」已不成立；`0x236` 尤其需要改（它是音频/网格对象族，不是文本族）。
8. **无「外部符号/无实现」类排除**：本轮涉及的所有被调都追到了真身（含 `j_D3DXMatrix*` 导入 thunk、
   `sub_453530` → `sub_453150` 一跳），**没有**任何条目以「无实现」为分类依据。

---

## 5. 附：本轮 32 条的判定汇总（速查）

- **可实现 13 条**：`0x133`(10) · `0x232`(8) · `0x22f`(7) · `0x22c`(6) · `0xd0`(6) · `0x22d`(5) · `0x132`(5) ·
  `0x134`(5) · `0x233`(5) · `0x234`(4) · `0x22a`(2) · `0x23a`(1) · `0x1c4`(1)。
- **`deferred` 19 条**：`0x222`(10) · `0x87`(9) · `0x236`(6) · `0x36`(5) · `0x25`(4) · `0x2fd`(4) · `0x32c`(4) ·
  `0x26`(1) · `0x2b`(1) · `0x241`(1) · `0x82`(1) · `0x85`(1) · `0x147`(1) · `0x2f2`(1) · `0x144`(1) ·
  `0x327`(1) · `0x329`(1) · `0x328`(1) · `0x32e`(1)。
- ★**与台账的对照**：本轮另把 §4 订正涉及的 **`0x230`/`0x231`/`0x232`/`0x235` 四条的 disposition 一并归口**——
  其中 `0x230`/`0x231`/`0x235` 由 `deferred` **改判可实现**（停在旧 `deferred` 会与新结论矛盾），
  `0x232` 由 `unimplemented` 改判可实现；因此上面「可实现 13 条」不含这 4 条旧账目，而实际可落地清单是
  **17 条**（13 + `0x230`/`0x231`/`0x232`/`0x235`；其中 `0x230` 需新增 `native.stopColorAnim?` 缝，
  `0x22d`/`0x22f` 建议新增 `native.setSceneRotation?`）。`opcode-gaps.json` 里这 4 条按「已评估、可落地、
  尚未接线」的现状**保留 deferred**（`0x232` 因原为 `unimplemented` 而改为 `deferred`），
  note 已逐条写清落地方案；接线完成后改为 `implemented`。
- **并排除**：`0x24f` / `0x250` / `0x251`（并行 agent）。

---

## 6. ★落地轮（2026-09，B3 接线）以体订正本文的地方

本页 §2.1/§2.3 的落地方案是**筛体时的推断**，接线时逐行读体后有 7 处与体不符。**真源以
`docs-new/03-engine/opcode-table.md` 对应行 + `analysis/opcode-gaps.json` 的 note 为准**（正文已订正）；
本节只登记"本文哪里错了"，防止后来者照抄本页。

| # | 本文原写法 | 体的真相（已落地） |
|---|---|---|
| 1 | §2.1 把 `0x234` 与 `0x233` 并列为「Scene 立绘/图元变换面」，§2.3 又把它当「平移窗」（`setTranslationAnim`） | `sub_4AD850` = **旋转窗**：`+0x214` 起点锁存槽、`+0x228` 周期、`+0x244/+0x248/+0x24C` 是**旋转轴**；消费端 raw 118228 `D3DXMatrixRotationAxis` ⇒ **匀速旋转**。已落地 `op_set_rotation_loop`；第一层字段已由 `trans_win_*` 更名为 `rot_win_*`/`rot_win_axis` |
| 2 | §2.3 把 `0x235` 当「flipbook 窗参数面」⇒ `setFlipbook` | `sub_4AD900` = **平移往复**（`+0x536` 起点、`+0x556` 周期、`D3DXMatrixTranslation(+656)`），消费端 raw 118232-118245 是**三角波**。已落地 `op_set_translation_loop` |
| 3 | §2.3 把 `0x231` 当「旋转窗参数面」⇒ `setRotationAnim` | `sub_4AD690` = **贴图换格循环**（`+0x540` 起点、`+0x560` 周期、`+0x568` 总格数、`+0x572` 每行列数）；`+0x568/+0x572` 与 A 层 `0x239` 共用，两层分支都在 `eval.ts`。已落地 `op_set_flipbook_loop` |
| 4 | §2.3 说 `0x230` 清「6 个窗字段 + 四个起点槽」，语义「停掉全部动画窗」 | 实际写集只有 `{540,544,548,552,556,560}`（`do{…}while(v<564)`，v=544..560），**不碰** `524/528/532/536`、不碰 bit1 ⇒ 只停 **B 层**。且它是该族**唯一不置 `Scene+0xB5AC` 脏位**的 |
| 5 | §2.3 说 `0x232` 的 `+576`「与 `0x202` 同字段」 | `+576`(=`+0x240`) 是 B 层颜色窗的**目标色**；`0x202` 写的是 A 层 `+56/+76/+100` ⇒ 同语义、不同层，不是同一格 |
| 6 | §2.1/§2.3 把 `+524..+536` 当「延迟窗起点（delay）」 | 它们是**起点锁存槽**：置 0 ⇒ 消费端下一帧把当前时钟锁存进来（raw 118105-118106 等），起点由引擎写、不是脚本给的 delay |
| 7 | §2.3 说族共用 `sub_4AD580`（"族共用"） | 只有 `0x230` 走 `sub_4AD580`；`0x231`→`sub_4AD690`、`0x232`→`sub_4AD730`、`0x233`→`sub_4AD7B0`、`0x234`→`sub_4AD850`、`0x235`→`sub_4AD900`（族共用的是"同一 `Item.flags` bit2 消费端"） |

**同时被订正的还有**：`0x22f` 实为 Scene 旋转轴/角（非「图元尺寸动画」）、`0x233` 实为缩放窗（非「尺寸动画」）、
`0x241`/`0x236` 走音频/网格对象族（不是消息窗/GDI 文本族）。另 `0x244`（原 unjustified no-op）已按体实现为
`op_clear_draw_item_anim_starts`（遍历三表清 `flags&2` 者的 `+52`/`node+24` 起点；两张 572B 表未建模 ⇒ 记缺口）。

**路线 C 的订正**（`0x1d0`/`0x1d1`）另见 `docs-new/03-engine/route-c-text-metrics-2026-09.md`：两条都**不是**
「GDI 文本度量族」，且真正的 `GetTextExtent` 缺口在 `set:BlankExtentMode`（新票 `T-0085`）。
