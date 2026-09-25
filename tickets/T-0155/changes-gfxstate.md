# T-0155 · VM 半边（`src/vm/handlers/gfx-state.ts` + `src/vm/handlers/gfx-item.ts`）变更记录

> 范围：`app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` §T-0155 中**锚点列 = 这两个文件**的
> 10 行 = **P2 5 行**（`0x32` / `0x320`×2 / `0x321` / `0x32d` / `0x33f` 里的 P2 行）
> + **P3 5 行**（`0x20e` / `0x21e` / `0x24f` / `0x258`×2 / `gfx-prim-mesh-and-render-state`）。
> 其余行（锚点 = `src/renderer/**`）**不在本单元**。
> 纪律：**不写 `analysis/*.json`**（`T-0108` 正在重写那六份）⇒ 台账内容一律写在本文件
> 的「台账待应用」节，由主 agent 串行应用。
>
> 引擎真源：`engine/天结_unpacked.exe_utf8.c`（下称 raw）。命令一律在
> `app/amayui-emulator/` 下跑（本机 `node_modules` 无 `.bin` ⇒ 见 §6）。

---

## 1. 逐条处置

### 1.1 P2 `0x32d` · missing-operand-io —— **已修**

**现象**：`emulator` 把 `op2` 的**最低字节当红**（`(rgb & 0xff)/255`）、**第三字节当蓝** ⇒ 所有
`0x32d` 下发的颜色**红蓝互换**（不回写操作数、不报错，只在画面上错）。

**引擎证据**（raw 34033-34054，`sub_427040`）：
```
v2 = readIntOperand(1); v3 = readIntOperand(2);
if (v2 > 255) v2 = 255;                                              // 34046-34047：只判上界，负值不钳
v4 = (u8)v3 | ((BYTE1(v3) | (((v2 << 8) | BYTE2(v3)) << 8)) << 8);    // 34048：ARGB，B=u8 / G=BYTE1 / R=BYTE2 / A=v2
v6 = BYTE2(v4)·dbl_51FA60; v7 = BYTE1(v3)·dbl_51FA60;
v8 = (u8)v3·dbl_51FA60;    v9 = HIBYTE(v4)·dbl_51FA60;                // 34049-34052
sub_499DF0(Scene, v6, v7, v8, v9);                                    // 34053
```
**轴向靠被调体反推**（`sub_499DF0` raw 116583-116637）：`_this[13947] = v13 | ((v10 | ((v8 | (v15 << 8)) << 8)) << 8)`，
其中 `v8 ← a2`、`v10 ← a3`、`v13 ← a4`、`v15 ← a5`；而 raw 116693-116696 把同一份拼装交给
`SetRenderState(139, …)`（D3D `D3DRS_TEXTUREFACTOR` 的 `(R<<16)|(G<<8)|B`）
⇒ **`a2` = 红 = `BYTE2(v4)`、`a4` = 蓝 = 最低字节**。`dbl_51FA60 = 1/255`（raw 4392）。

**改了什么**：`gfx-state.ts` 的 `op_set_3d_color` 按上式重排分通道（`>>16` = 红、`>>8` = 绿、
`&0xff` = 蓝），`a` 的钳位去掉 `& 0xff`（体里只判 `> 255`），并补了整段体证注释；
文件头对照表那一行的 `0x32D` 描述同步订正。

**守卫**：`test/gfx-state-operand-io.test.ts` 的第一个用例（`0x336699` 非对称色 + 纯蓝 + `α>255`）。
**顺带 retarget**：`test/op-a4-a6.test.ts` 的 `['color3d', 1, 0, 0, 1]` → `['color3d', 0, 0, 1, 1]`
（见 §2）。

**命令与结果**：
```
node --import tsx --test test/gfx-state-operand-io.test.ts     # 改前 2/3 红 → 改后 3/3 绿
node --import tsx --test test/op-a4-a6.test.ts                 # 改前 1 红 → retarget 后全绿
```

### 1.2 P2 `0x320` · missing-behavior（顶点半像素）—— **已修（VM 半边）**

**现象**：引擎把顶点位置写成 `x − 0.5` / `y − 0.5`，emulator 直接取 op2/op3 的数组值当屏幕像素
⇒ 整块几何相对真机偏移 `(+0.5, +0.5)`。

**引擎证据**：常量为 `dbl_51D7F8 = 0.5`（raw **4197**）；**create-mesh 的那条路**是
`sub_432150`（raw 41069）→ `sub_4ADFE0`（raw 132786 `sub_4A1F00`）→
`sub_4A1F00` raw **122235-122238**：
```
v15 = *(float *)(v10 + a2) - v12;        // v12 = dbl_51D7F8
*(float *)(v10 + a2 - 36) = v15;
*(float *)(v10 + a2 - 32) = *(float *)(v10 + a2 - 32) - v12;
```
（`+0`/`+4` 两格各减一次 ⇒ **z 不动**）。同一句也在 DrawPrimitive 路 `sub_4A3590`
raw **123309-123316**（`*(float *)v23 = a2 - dbl_51D7F8; …`）。

**改了什么**：`gfx-item.ts` 的 `op_mesh_create` 在 `verts.push` 时对 `x`/`y` 减常量
`HALF_PIXEL = 0.5`（带 raw 注释指向 `dbl_51D7F8`）；docstring 写清"这条路"与"z 不减"。

**守卫**：`test/gfx-state-operand-io.test.ts` 的第二个用例（满屏四边形 ⇒
`(-0.5,-0.5)..(1279.5,719.5)`，逐顶点断言、并断言 z/uv 不受影响）。

**顺带 retarget**：`test/mesh-vertex-quad.test.ts` 的 E3 用例（见 §2）。

**命令与结果**：改前该用例红（`actual [[0,0],[1280,0],…]`）→ 改后绿；
`node --import tsx --test test/mesh-vertex-quad.test.ts` 7/7 绿（E3 用例耗时约 49 s）。

### 1.3 P2 `0x33f` · missing-operand-io —— **已修（操作数 I/O + 回退语义）**

**现象**：emulator 只读 op1，`op2`（α）/`op3`（颜色）两格**完全没读**，两格的下发能力整体缺失。

**引擎证据**（raw 34411-34448，`sub_427A90`，读序 = **op2 → op3 → op1（两次）**）：
```
34423 v2 = readIntOperand(2);   34424 v3 = readIntOperand(3);
34425-34431 if (v2 <= 255) { if (v2 < 0) v2 = (unsigned)sub_4ADD60(Scene, readIntOperand(1)) >> 24; }
34433-34435 else v2 = 255;
34437-34441 if (v3 < 0) v3 = sub_4ADD60(Scene, readIntOperand(1));
34442-34444 v6 = readIntOperand(1); v7 = _this[93384]; *(v7 + 1260) = v6;
34446       *(v7 + 1264) = (u8)v3 | ((BYTE1(v3) | (((v2 << 8) | BYTE2(v3)) << 8)) << 8);
```
⇒ `Scene+1260` = 场景默认混合选择子（消费点 `sub_4535F0` raw 65858-65889）；`Scene+1264` 的
**轴向与 `0x32d` 完全同款**；两格的负值回退源 = `sub_4ADD60(Scene, op1)`（该项**当前色**，
α 取 `>> 24`）—— 而这正是 emulator 已有的宿主缝 `getDrawItemColor`（`0x202`/`0x203` 同款）。

**改了什么**：`gfx-state.ts` 的 `op_set_scene_blend` 按体的读序与钳位/回退规则读满三格
（回退走既有 `getDrawItemColor`），`Scene+1264` 的装配口径写在注释里但**不落地**
（没有消费端 ⇒ 落地就是死写，见 §3）。

**守卫**：`test/gfx-state-operand-io.test.ts` 的第三个用例（触点 `[1,2,3]` + 回退实参 + `>255` 钳位）。
**顺带 retarget**：`test/op-underun-fixups.test.ts` 的 `touched(0x33f, …)` 断言
`[1]` → `[1,2,3]`；`test/opcode-operands.test.ts` 的 `ALLOW_UNDERRUN['0x33f']` 理由段（见 §2）。

### 1.4 P2 `0x321` · missing-branch（越界槽号）—— **已按"如实标注"处置（不改行为）**

**引擎证据**（raw 33839-33850 → `sub_4AE280` raw 132798-132807）：`result[a3 + 7] = a4` 是
**直接派生地址写，没有任何范围校验**（`a3` 是任意 int ⇒ 真机上越界写内存）。

**处置**：emulator 用 `Map<mesh, Map<index, value>>` 收下任意键（**比引擎安全**，且这条不回写
操作数、不改控制流 ⇒ 不产生脚本可见差异）⇒ **不补一个引擎没有的校验**（那会把"引擎会越界写"
这个事实洗掉）。改成在 `op_set_mesh_entry_attr` 的 docstring 里把两件事写清：
① 引擎**没有**合法槽号范围；② 引擎写的是**一个 dword**，而消费端 `meshColor` 按字节取倍率
（`presenter` 的 `meshAttrsTint` 只用下标 ≥2）⇒ handler **不截断**（截断会让快照/报告看不到原值）。

**守卫**：既有 `test/gfx-prim-mesh-consumers.test.ts`（`0x321` 端到端）+ `test/op-a4-a6.test.ts`
的宿主缝断言原样通过（本次**没有**改 `0x321` 的任何行为）。

### 1.5 P3 `0x21e` · stale-ledger —— **已修（一处陈旧注释）**

`gfx-item.ts` 派发表里 `[0x21e, …]` 的行内注释写「sx/sy/sz **÷256**」，与同文件 handler
（`op_set_scale_matrix` 的 `÷100`）和引擎除数 `dbl_5201F0 = 100.0`（raw **4430**）都不符
⇒ 只存在于派发表那一行。已改成 `÷100，dbl_5201F0 raw 4430`。
（`grep -n '÷256' src/vm/handlers/gfx-item.ts` 改后 0 命中；`÷100` 出现在 handler 与派发表两处。）

### 1.6 P3 `0x258` · missing-operand-io + noop-claim-unjustified —— **已按"如实标注"处置**

**引擎证据**（raw 33156-33185，`sub_425D20`）：
```
33162 v2 = readIntOperand(2);
33163 result = &_this[5 * readIntOperand(1) + 80708];         // = Scene + 20*槽（Scene = Engine + 322832）
33164-33173 if (v2 & 1) { result[468] = 1; result[5468] = 1; } else { … = 0; … = 0; }
33174-33183 if (v2 & 2) { result[469] = 1; result[5469] = 1; } else { … = 0; … = 0; }
```
⇒ 每条槽 **四格**：`Scene+1872/+1876` 与镜像 `Scene+21872/+21876`。

**处置**：emulator 只建模一张表（`Engine.texSlotFlags`，值 = `bit0|bit1<<1`）——**镜像表结构缺失**
（登记见 §3）。★按本条 P3 的第 2 点要求：字段**注释**已写明「**建模≠有消费端**」——
引擎那四格**只写不读**，emulator 侧也零生产读者（已在 `dead-writes.baseline.json` 的 `known`，
回链 `T-0154`）⇒ 照本工程判据（`0x238`/`0x2FA`：写一个没人读的字段等于死写、不建模）它**不是
"已经生效"的能力**。文件头对照表那一行也同步改成"四格 + 镜像表缺 + dead-writes 基线"。

**未做项**：`Scene+21872` 镜像表**没有对应物**（要真做，得先在 `SceneState` 里建第二张表并
接上装载路径 —— `src/renderer/**`，不在本单元范围）。

### 1.7 P3 `gfx-prim-mesh-and-render-state` · overreach —— **只交回台账修正（本文件 §3）**

审计说 `analysis/engine-capabilities.json` 该条目的 `reads` 漏列本族里唯二被建模的字段：
`0x238` 写的 `Engine[92338]/[92339]` 与 `0x243`/`0x24E` 用的 `Engine[92340]`。
**复核（raw）**：`sub_4248C0`（`0x238`）写 `Engine[92338] = 0` / `[92339] = op1`，
emulator 落 `Engine.gateWaitStart/gateWaitMs`（**有真读者**：`sub_407E20` raw 12762-12786 + 主循环
raw 21109）；`Engine[92340]` 全文件**只有 1 处写**（raw 32965，在 `0x24E` 的 `sub_425C4x` 家族里），
读点 = `0x243`（`op_reset_wait_timer` 的门 `gate & 2`，raw 26016-26031）。
★另发现该条目 `reads` 里 `Engine[92338]/[92339]（画布尺寸对）` 这个**标签**已被同一份条目的
`trigger` 自己否掉（`0x238` 的正确语义 = **等待计时器**，不是画布尺寸）⇒ 一并写进 §3 的替换文本。
本文件**不改** `analysis/*.json`（`T-0108` owner 在写）。

### 1.8 P3 `0x20e` · missing-branch / P3 `0x24f` · missing-consumer —— **未做（受阻，见 §4）**

两条都**已按体把语义与门/检查读清**并写进 `gfx-state.ts` 的 docstring，但**都没有落地**，
统一原因见 §4。

- `0x20e`（`sub_41A200` raw 25277-25287）：门 `Engine[80684] == 1 && Engine[92322] == -1` 成立时
  设备被 **Clear 两次**（raw 25282-25284 里一次 + raw 25286 无条件一次）；门假时一次。
  ★门的两格在 emulator 侧**都没有可信真值**（`80684`/`92322` 都没有定位到置位点）。
- `0x24f`（`sub_4AF6A0` raw 133703-133787）：写记录**之前**按 op2 检查 `Scene+42456` 槽表
  （raw 133743-133783）—— 槽不存在、或该纹理对象 `[262]`（字节 +1048）与当前渲染目标 id 不符
  ⇒ `sub_4A2C10(Scene, op2, v13[260], v13[261], v14)` 重建/换绑。★**记录照写**（两支都汇到
  `LABEL_8`）⇒ emulator 的记录那一半**本来就不受影响**，缺的是"工作纹理对象"这个宿主侧对象。
  ★**只有 `0x24F` 这条有**（`0x250`/`0x251` 的下落函数里没有这段）。

---

## 2. 既有断言的 retarget（**只改指、不删**；最小改动）

| 文件 | 旧断言 | 新断言 | 旧前提为什么不成立 |
|---|---|---|---|
| `test/op-a4-a6.test.ts` | `['color3d', 1, 0, 0, 1]`（`i32d 255 ff`） | `['color3d', 0, 0, 1, 1]` | 旧值是"最低字节当红"这个**修前缺陷**的镜像；`op2 = 0x0000FF` 按体是**蓝**（raw 34048-34051 + `sub_499DF0` raw 116637 逐位核对）。同一用例的其余 10 条断言与用例名（"参数与引擎一致"）一字未动 |
| `test/mesh-vertex-quad.test.ts` | `m.rect === '0,0..1280,720'` | `covers(m)`：`x0≤-0.5 && y0≤-0.5 && x1≥1279.5 && y1≥719.5` | 旧串钉的正是"**没有**半像素偏移"这个修前状态（raw 122235-122238）；新判据仍钉"顶点真的铺满视口"，并保留后续全部断言（`verts === 4`、`flags & 1`、两块幕布的端点色、终态检查） |
| `test/op-underun-fixups.test.ts` | `touched(0x33f, …)` = `[1]`，注"目前只承载混合选择子" | `[1, 2, 3]` | `[1]` 钉的是"op2/op3 整体没读"这个修前缺陷；体证 raw 34423-34424 是**先读 op2/op3**。白名单条目（`ALLOW_UNDERRUN['0x33f']`）**保留**，理由文本改为"只剩 `Scene+1264` 缺消费端" |
| `test/opcode-operands.test.ts` | `'0x33f'` 豁免理由："emulator 没有绘制项 `Item.+96` 当前 α/当前色模型…" | 同段保留（`sub_427A90` / `raw 34423-34446` / `T-0017` / `缺消费端` 四个被 `op-underun-fixups` 钉住的字串一字未动），追加"★2026-09（tickets/T-0155）订正：三格操作数现在都读…" | 该理由的前半（"没有当前 α/当前色模型"）已被本次修复取代（回退源 = 既有宿主缝 `getDrawItemColor`）；保留原句 + 追加订正段，避免删掉被锚定的字面串 |

★四处都**没有**放宽/删除断言：`test/op-underun-fixups.test.ts` 的"豁免条目必须留在白名单"
一节、`test/opcode-operands.test.ts` 的"1..argc 全被碰"棘轮、以及 `gfx-prim-mesh-consumers`
的 `0x321` 端到端断言全部原样通过。

**新增守卫文件**：`test/gfx-state-operand-io.test.ts`（3 个用例，复用 `test/harness.ts` 的
`mkEngine`/`instr`/`im`/`trackArgs`，无本地 `mk(`/`makeCtx(` 变体 ⇒ `harness-convergence` 不受影响）。
---

## 3. 台账待应用（**主 agent 串行应用**；本单元不写 `analysis/*.json`）

### 3.A `analysis/engine-capabilities.json` · `gfx-prim-mesh-and-render-state`

1. **`reads` 替换两行**（审计 overreach 项）：
   - 旧：`"Engine[92338]/[92339]（画布尺寸对）"`、`"Scene+1872/+21872 的两张纹理槽标志镜像表"`
   - 新：`"Engine[92338]/[92339]（0x238 装载 / 0x243 复位的**等待计时器**起点+时长；读者 sub_407E20 raw 12762-12786 与主循环 raw 21109 —— 不是"画布尺寸对"）"`、
     `"Engine[92340]（0x24E 写、0x243 读 bit1 做门；raw 32965 / 26016-26031）"`、
     `"Scene+1872/+1876 与其镜像 Scene+21872/+21876（0x258 写的四格；★镜像表在 emulator 侧缺失）"`
2. **`engine.raw` 收紧**：现为 `"31303-31345"`（只覆盖 `0x1FC`/`0x1FE`），本族实际跨度到
   `0x32D` 的 34054 与 `0x33F` 的 34448 ⇒ 建议改 `"25277-34448"`（或按票面只补一句说明）。
3. **`emulator.note` 追加**：`0x258` 的镜像表缺、四格引擎只写不读（dead-writes 基线，回链 `T-0154`）；
   `0x32d` 的轴向已按体订正（`T-0155`，守卫 `test/gfx-state-operand-io.test.ts`）；
   `0x20e` 的双 Clear 与 `0x24f` 的工作纹理检查**仍未建模**（各带票 `T-0155`）。

### 3.B `analysis/opcode-gaps.json`（若该条目不在台账里，请按 `T-0149` 口径补 `partial` + `missing[]`）

- `0x32`：`missing` += `{ what: "GDI 支（set:DrawMode == 0，本机 INI 实测缺省值）的 2D 对象转送未建模：引擎走 (*(vtable+64))(Scene+7912, …)，emulator 两条路共用 blitSlotToSlot（矩形相同 ⇒ 无画面差异）", ticket: "T-0155", raw: "27984-28000" }`
- `0x20e`：`missing` += `{ what: "门 Engine[80684]==1 && Engine[92322]==-1 成立时设备被 Clear 两次；两格均无置位点 ⇒ 无法照体实现", ticket: "T-0155", raw: "25280-25286" }`
- `0x24f`：`missing` += `{ what: "写记录前按 op2 检查 Scene+42456 槽表并在 +1048 不符时 sub_4A2C10 重建/换绑工作纹理；emulator 无宿主侧槽对象 ⇒ 缺 ensureWorkingTexture 缝（记录那一半不受影响）", ticket: "T-0155", raw: "133743-133783" }`
- `0x258`：`missing` += `{ what: "镜像表 Scene+21872/+21876 无对应物（emulator 只有一张 Engine.texSlotFlags）；且引擎这四格只写不读", ticket: "T-0155", raw: "33163-33183" }`
- `0x33f`：`missing` += `{ what: "Scene+1264 的效果常量通路未建模（op2/op3 现已按体读满并算出回退值，但装配结果无处安放）", ticket: "T-0155", raw: "34446" }`
- `0x321`：**登记为 `implemented` 但 note 补一句**"引擎对 op2 无范围校验（越界即派生地址写）；emulator 按任意 Map 键收下，不补引擎没有的校验"（raw 33848-33849 / 132804）。

### 3.C `analysis/fields.json`（可选，若 `T-0108` owner 认为值得）

- `Engine/0x5A2A8`（= `_this[92338]`）`wait_timer_start`：`meaning` 补"`0x238` 装载 / `0x243` 复位；
  读者 `sub_407E20` raw 12762-12786"。
- `Engine/0x5A2AC`（= `_this[92339]`）`wait_timer_ms`：同上。
- `Engine/0x5A2B0`（= `_this[92340]`）`msg_field_92340`：`meaning` 补"`0x24E` 写（raw 32965 是
  全文件唯一写点）、`0x243` 读 bit1 做门（raw 26016-26031）"。

---

## 4. renderer 半边的耦合点（登记，供后续 owner）

| # | 耦合点 | 现在缺什么 | 要动哪些文件（**都不在本单元范围**） |
|---|---|---|---|
| ① | **`0x32` 的 GDI/D3D 二选一**（P2 `0x32` missing-branch） | `set:DrawMode`（`Engine[166964]`，emulator 侧真值 = `config` 的 `set:DrawMode`，`frame/loop.ts:139`）在 handler 里完全没读。★**两路送给宿主的矩形完全相同**（只是实参顺序不同），差异全在被调体（GDI = `Scene+7912` 的 vtable+64；D3D = `sub_4A87A0` 的夹取/比例跟随 + 缺 surface 报错）⇒ 要真做，得**先建"2D 转送对象"**并让 `blitSlotToSlot` 按 DrawMode 选路，**不是**在 handler 里加一个 if | `src/vm/native.ts`（缝签名）、`src/vm/nativeTap.ts`（白名单）、`src/renderer/**`（两条路） |
| ② | **`0x20e` 的双 Clear**（P3 `0x20e` missing-branch） | 门 `Engine[80684] == 1 && Engine[92322] == -1` 的两格**都没有定位到置位点** ⇒ 连"门开是什么样"都无法取值。要落地需：给 `commitGraphics` 加"清几次"的实参 + 两个宿主按门值传 + 先定位两格的写者 | `src/vm/native.ts`、`src/vm/nativeTap.ts`、`src/renderer/{headlessScene,pixiBackend}.ts`，外加**引擎侧再研究**两格的写者 |
| ③ | **`0x24f` 的工作纹理检查**（P3 `0x24f` missing-consumer） | 缺 `ensureWorkingTexture(slot, w, h, renderTargetId)` 这类宿主缝 + 宿主侧的"纹理槽对象表"（引擎 `Scene+42456`，对象 `[260]/[261]` = 宽/高、`[262]` = 字节 +1048）。★记录那一半**不受影响**（体里两支都照写） | 同 ②（缝 + 两个宿主），另加槽对象表建模 |
| ④ | **`0x258` 的镜像表**（P3 `0x258` missing-operand-io） | emulator 只有一张 `Engine.texSlotFlags`；引擎写四格（两张表）。★真要做还得**先有消费者**（现在两边都只写不读 ⇒ 建第二张表会立刻新增一条死写） | `src/vm/engine.ts`（字段）、`src/renderer/**` 或装载路径（消费者） |
| ⑤ | **`0x33f` 的 `Scene+1264`**（P2 `0x33f`） | op2/op3 的**读与回退已修好**，但 `(α<<24)|(color&0xFFFFFF)` 的落点（效果对象的 shader 混合常量，raw 65904-65907）没有通路 ⇒ 不落地（落地即死写） | `src/renderer/scene/**`（效果通路）+ 可能的 `scene/state.ts` 字段 |
| ⑥ | **`0x320` 的 `baseColors` 初值**（P2 `0x320` missing-behavior，锚点 `src/renderer/drawitem/model.ts`） | 审计说"引擎新建 mesh 记录时把两格态色都初始化成 `-1`（白不透明白），emulator 的 `makeMesh` 初始化成 `0`"。★**本单元只能登记，不能改**（`src/renderer/**`）。★另注：`eval.ts:426` 对**缺失**的 `baseColors[i]` 已回落 `0xffffffff`，所以"建了几何但没发过色数组"这一形态**未必**表现成透明黑 —— 要按体判"`state0`/`state1` 初值 = −1"这条得看 `model.ts:323-335` 的 `state0/state1: 0` | `src/renderer/drawitem/model.ts`（`makeMesh`）、`src/renderer/drawitem/eval.ts` |

---

## 5. 未做项 / 受阻（具体到 `文件:行`）

| 条目 | 状态 | 落点 |
|---|---|---|
| P2 `0x320` 的**态色初值 −1** | **未做**（renderer 半边，不在本单元） | `src/renderer/drawitem/model.ts:328-329`（`state0: 0, state1: 0`）；耦合点 ⑥ |
| P2 `0x32` 的 **GDI 支** | **未做（受阻：需新建宿主缝 + renderer 通路）** | `src/vm/native.ts:314`（`blitSlotToSlot` 签名）、`src/vm/handlers/gfx-state.ts` 的 `op_stretch_texture`（已写缺口注释）；耦合点 ① |
| P3 `0x20e` 的**双 Clear** | **未做（受阻：门的两个字段无真值）** | `src/vm/handlers/gfx-state.ts` 的 `op_commit_graphics`；耦合点 ② |
| P3 `0x24f` 的**工作纹理检查** | **未做（受阻：缺宿主缝 + 槽对象表）** | `src/vm/handlers/gfx-state.ts` 的 `op_set_blind_wipe` docstring；耦合点 ③ |
| P3 `0x258` 的**镜像表** | **未做（且要先有消费者，否则是新增死写）** | `src/vm/engine.ts` 的 `texSlotFlags` 附近；耦合点 ④ |
| P2 `0x33f` 的 **`Scene+1264` 装配** | **未做（无消费端 ⇒ 按死写判据不落地）** | `src/vm/handlers/gfx-state.ts` 的 `op_set_scene_blend`（只读+回退已实现，装配值 `void` 掉并注明口径） |
| 台账六项 | **未做（本单元不许写 `analysis/*.json`）** | 见 §3（`T-0108` 正在重写那六份） |

> `0x238`/`0x243` 两行**本单元没有改动**（只在 docstring 里补了 `Engine[92340]` 的写/读点位置），
> 因为它们在 P1 轮已按体实现且**有真读者**（`Engine.gatePending`）。

---

## 6. 命令与结果（本机实测）

```powershell
cd E:\Games\Eushully\天結\app\amayui-emulator

# ① 新守卫：改前 2/3 红 → 改后 3/3 绿
node --import tsx --test test/gfx-state-operand-io.test.ts

# ② 相关既有守卫（78 个用例，全绿）
node --import tsx --test test/mesh-vertex-quad.test.ts test/gfx-prim-mesh-consumers.test.ts `
  test/op-a4-a6.test.ts test/op-underun-fixups.test.ts test/opcode-operands.test.ts `
  test/operand-plan.test.ts test/blend-mode.test.ts test/op-032-stretch-texture.test.ts `
  test/op-24f-250-251-transitions.test.ts test/op-223-transition-fade.test.ts `
  test/op-0202-negative-fallback.test.ts test/op-203-draw-color-alpha.test.ts
```

**本机工具链注意事项**（与主 agent 的提醒一致）：
`node_modules` 里**没有** `.bin` ⇒ `npm run typecheck` / `npm run check:dead-writes` 会报
`'tsc' is not recognized` / `'tsx' is not recognized`。等价命令：
```powershell
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit          # exit 0
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit     # 本单元 0 条；全树红在别人在改的文件
node --import tsx src/tools/deadWrites.ts                              # exit 0，14→13 基线内，★无新增死写
```

**结果**：
- `test/gfx-state-operand-io.test.ts` **3/3 绿**（红→绿证据见 §1）。
- 相关既有守卫（13 个文件）**79/79 绿**（`node --import tsx --test <13 个文件>`）。
- `tsconfig.json` typecheck **exit 0**；`tsconfig.test.json` 里**本单元 0 条**（`TS4117` 已修）。
- `check:dead-writes` **exit 0、无新增**（`Engine.texSlotFlags` 仍在 `known` 里，回链 `T-0154`）。
- `tickets.js --validate` ✅ 172 张（70 条既有行号漂移警告，无新增）。
- `git diff --stat`（本单元范围）：
  `gfx-item.ts` 23 行、`gfx-state.ts` 187 行、`mesh-vertex-quad.test.ts` 14 行、
  `op-a4-a6.test.ts` 6 行、`op-underun-fixups.test.ts` 12 行、`opcode-operands.test.ts` 2 行；
  新增 `test/gfx-state-operand-io.test.ts`（191 行）。

### 6.1 ★全量 `node --import tsx test/run.ts all` 的归因（实测 **737 / 606 pass / 130 fail**）

**本单元新增红 = 0，但本轮的全量口径已被并行单元打红，不能拿它当验收线**。逐条归因（都不是本单元）：

| 现象 | 归因（实测） |
|---|---|
| `ℹ tests 737`（基线口径是 1310） | 测试文件总数在涨（各单元新建），`run.ts all` 只跑 T0+T1 |
| 130 条红里的大多数（几乎每个文件 1 条、几百 ms） | **跨单元在改中**：`input.test.ts` 单文件独立跑也红（`L2Dモーションファイル TITLE.MTN の読み込みに失敗しました`，opcode 846 = `0x34e`）⇒ Live2D 单元在改中；`capability-ledger.test.ts` 的 `counts.modeled-verified 应为 76`、`md 的统计行与数据层不一致`、`叙述/生成物里出现沿革话术` ⇒ **`T-0108`（六份台账话术重写）+ 能力台账单元**在改中 |
| `harness-convergence.test.ts` 两条 | 新抄 `mk()/ctx` 变体的三个文件 = `agerc-module-error-paths.test.ts` / `config-t0161.test.ts` / `engine-fields-t0161.test.ts` ⇒ **不是本单元**（本单元的新守卫复用 `test/harness.ts`） |
| `no-dead-writes.test.ts` | 与 §6 的 `check:dead-writes`（13 = 基线 13、无新增）口径不同 —— 它是**测试内自检**，红在 `src/**` 在改中的字段 |
| 基线 3 条 | ✅ 逐条命中（`save-slot.test.ts:141` 真槽 `format 0 !== 3`、`scene-report.test.ts:53` 可绘制项 24 ≤ 缺纹理 26、`engine-slot` SAVE70/71）|

**结论**：判绿只能按"**不新增红**"——本单元的 14 个文件（2 个 handler + 11 个既有/新增守卫
+ 新守卫）在隔离口径下全绿，且 `tsconfig.json` / `check:dead-writes` / `tickets --validate` 三个
可用的闸门全绿。

## 7. 动过的"被锚定文件"申报

- `app/amayui-emulator/src/vm/handlers/gfx-state.ts`：票据锚点两条
  （`T-0024` 的 `op_load_wait_timer`、`T-0084` 的 `setTransition`）**逐字保留**（改动都在
  `op_set_3d_color` / `op_set_scene_blend` / `op_set_slot_flags` / `op_set_blind_wipe` /
  `op_commit_graphics` / `op_set_mesh_entry_attr` 与文件头注释上）。
- `app/amayui-emulator/src/vm/handlers/gfx-item.ts`：票据锚点两条
  （`T-0082` 的 `绘制项/场景变换族走操作数计划层`、`T-0087` 的 `const op_set_transition_fade: OpHandler`）
  **逐字保留**。
- `app/amayui-emulator/test/opcode-operands.test.ts`：票据锚点一条（`T-0082` 的
  `实参类型**跟着操作数计划走**`）**逐字保留**（改动只在 `ALLOW_UNDERRUN['0x33f']` 的字符串值里）。
- 改完已跑 `tickets.js --anchors-in`（三处）+ `tickets.js --validate`（✅ 172 张、无新增警告）。
