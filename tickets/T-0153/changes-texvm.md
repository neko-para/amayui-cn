# T-0153 · `src/vm/handlers/gfx-texture.ts` 子集（VM 半边）变更记录

> 本文件**只覆盖本票落在 `src/vm/**` 的那批**（审计工作清单
> `app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` §T-0153 里锚点为 `src/vm/handlers/gfx-texture.ts` 的行）。
> 另一半（`src/renderer/**` + `src/arch/**`，7 条）已由另一位 owner 交付，见 `changes-renderer.md`；本文件不重复、不改判。
> ★`tickets/T-0153/ticket.json` 的状态与 `tests[]` 由主 agent 结算（**本子集不动那张票**）。
>
> 权威 = 引擎函数体（`engine/天结_unpacked.exe_utf8.c`，行号 = raw）。每条都带自己读到的 raw 行区间；
> 凡"没有/不存在"都写出搜过的范围。

## 0. 一句话结论

| # | sev | 对象 | kind | 结论 |
|---|---|---|---|---|
| ① | P2 | `0x1f8` | missing-operand-io | **修好**：create-texture 把槽记录 `Scene[5*slot+466]` 擦成 **−1**（raw 122847） |
| ② | P2 | `0x1fa` | missing-branch | **修好**：外层门 `if (!_this[a2+11676])` 建模（新字段 `ENGINE_FIELD.surfaceReleaseGate`）+ 门内写槽记录 **−1**（raw 119591-119594） |
| ③ | P2 | `0x1fa` | missing-operand-io | **修好**（与 ② 同一道门的两面，合并为一次实现） |
| ④ | P2 | `0x23f` | host-invented | **修好**：取值来源从 `Engine.texSizes` 改成**宿主的对象表** `native.slotNodeSize`（raw 40025-40029） |
| ⑤ | P2 | `0x23f` | missing-consumer | **修好**：同上（两项是同一个缺陷的两面） |
| ⑥ | P2 | `0x245` | missing-operand-io | **修好**：下发 `op2 / 1000`（`dbl_51FB50`，raw 4393 / 32673） |
| ⑦ | P3 | `0x246` | missing-operand-io | **修好**：下发 `op2 / 100`（`dbl_5201F0`，raw 4430 / 32696-32697） |
| ⑧ | P2 | `0x246` | missing-branch ×2 | **登记（未修）**：`if (_this[slot+94672])` 与类型标记门 `*(obj+1084) == 0` 都缺——两道门都需要 VM 侧对象表，见 §4 |
| ⑨ | P2 | `0x249` | host-invented / `texture-bind-synchronous-then-query` | **登记（未修）**：引擎传 `a6=1` ⇒ 槽记录写 **−1**（raw 123377），emulator 写 `imgid`；要精确复刻需给宿主缝加"记录策略"参数（跨 renderer 半边），见 §4 |
| ⑩ | P2 | `0x1f9` | missing-consumer | **登记（未修）**：颜色进 `Scene[5*slot+467]`（raw 123380），emulator 交给 `setTextureObjectParam`，而**两个宿主都没实现该缝** ⇒ 颜色目前只落进闸门 A，见 §4 |
| ⑪ | P3 | `0x1f8`/`0x1f9`/`0x1fa`/`0x249` | missing-branch（"先销毁该槽 movie 播放器对象"） | **登记（未修）**：VM 侧没有 `Engine[slot+94672]` 的对象表（`0x236` 未注册）⇒ 如实登记，**没有**造一个假模型 |

命令与红→绿证据见 §5；改动文件见 §3；台账待应用见 §6；与 renderer 半边的耦合点见 §4。

---

## 1. 逐条

### ① P2 `0x1f8` / missing-operand-io —— 槽记录被擦成 **−1**

**引擎体**：`sub_422C20`（raw 31161-31189）读四个操作数后调 `sub_4A2C10(_this+80708, slot, w, h, mode)`；
后者的**第一件事**就是（raw 122847）：

```c
*(_DWORD *)(_this + 20 * a2 + 1864) = -1;        // = Scene[5*slot + 466]
*(_DWORD *)(_this + 4 * (5 * a2 + 470)) = 1;     // = Scene[5*slot + 470]（槽状态）
```

`Scene[5*slot+466]` 就是 `0x1F9` 写 imgid（raw 123379 `v7[466] = a2`）、`0x1FA` 写 −1
（raw 119594）、`0x215`/`0x216` 读的那一格。

**改了什么**：`op_create_texture` 加一行 `c.e.texSlots.set(slot, -1)`。
★**为什么不是"顺手不动"**：留着旧 imgid 会让 `0x215`（`op_get_draw_item_tex_slot`，
`handlers/gfx-item.ts:82` 读 `texSlots.get(slot) ?? 0`）反查出**已不存在的绑定** —— 脚本会拿它去
`draw-texture` 一个已经被新表面顶掉的槽。

**守卫**（`test/op-15xx-gfx-texture-vm.test.ts`）
`★0x1F8：create-texture 把该槽的 imgid 记录擦成 −1（Scene[5*slot+466]，不是留着旧 imgid）`

### ②③ P2 `0x1fa` —— 外层门 + 槽记录写 −1（**同一道门的两面**）

**引擎体**：`0x1FA` = `sub_422E00`（raw 31245-31268）→ ① 析构该槽 movie 对象（raw 31255-31265）、
② `sub_49E980(_this+80708, op1)`（raw 119586-119603）：

```c
if ( !_this[a2 + 11676] )                    // ★raw 119591：外层门
{
  result = 5 * a2;
  _this[5 * a2 + 466] = -1;                  // raw 119594：槽→imgid 记录
  v4 = (int (__thiscall ***)(_DWORD, int))_this[a2 + 10614];
  if ( v4 ) { result = (**v4)(v4, 1); _this[a2 + 10614] = 0; }   // raw 119595-119600：CTexture 表面
}
return result;                               // ★门关时返回**未初始化**的 result
```

⇒ **门关 = 擦记录 + 销毁表面两件都不做**。工作清单把它列成了两行
（`missing-operand-io` + `missing-branch`），主 agent 的 brief §2.2 已判为同一道门的两面 ⇒ 一次实现、两条守卫。

**`_this[a2 + 11676]` 是什么**：按槽号索引的一张 1000 槽门表，字节 `4*slot + 46704`。
★**写者未在反编译里显形** —— 搜法：`grep -n "11676" engine/天结_unpacked.exe_utf8.c` ⇒ **唯一命中 raw 119591**
（其余 11676 的匹配是别的数字的子串吗？不是：命中总数 1，就是这一行）；`_this + 11676` 这种带空格的写法也搜了（0 命中）。
该门表在构造里随 `Engine+378688` 那张对象表一起被 `memset` 清（raw 22676 清的是对象表，门表未找到显式清零点）。
⇒ emulator **默认 0（门常开，= 与修前行为逐字节相同）**，要复现"门关"由测试/宿主经 `engineValues` 注入。

**改了什么**
- `engineFieldIds.ts`：新增 `ENGINE_FIELD.surfaceReleaseGate = 11676`（带完整依据与"写者未显形"的披露）。
- `op_release_texture`：门非 0 ⇒ **直接 return**（不写槽记录、不删尺寸镜像、不下发宿主释放）；
  门开 ⇒ `texSlots.set(layer, -1)` + `texSizes.delete(layer)` + `native.releaseTexture?.(layer)`。
  ★宿主释放调用**留在门内**（引擎第①步析构 movie 对象在门外，但它与 `Engine[slot+94672]` 同属宿主对象表，
  而 VM 侧没有那张表 ⇒ 见 §4 的登记）。

**守卫**
`★0x1FA：外层门 if (!_this[a2+11676]) 不成立 ⇒ 记录与表面都不动（raw 119591-119601）`、
`★0x1FA：记录槽位是「槽号 + 11676」= ENGINE_FIELD.surfaceReleaseGate（字节 46704）`

### ④⑤ P2 `0x23f` —— 取值来源必须是**对象表**，不是 `0x1F8` 记的表面尺寸

**引擎体**：`sub_4307B0`（raw 40019-40030）：

```c
v2 = _this[sub_41BF50(_this, 2) + 94672];        // ★对象表 Engine+4*slot+378688
if ( !v2 ) return sub_42B4B0((int)_this, 1, -1); // raw 40025-40027：没有对象 ⇒ op1 = −1
v3 = sub_4080B0(v2) * dbl_51FB50;                // raw 40028：尺寸 × 1000.0
return sub_42B4B0((int)_this, 1, (int)v3);
```

`sub_4080B0`（raw 12960-12980）按 `node[+1084]` 分派：`== 0` ⇒ 子对象 vtable+40；`== 1` ⇒ vtable+68；
**都不是 ⇒ `return 0.0`**（raw 12967/12979）⇒ ×1000 = **0**，不是 −1。

**两张表不许混**（这是审计 `host-invented` 的那一半）：`0x208` 读**表面**表
（`Scene + 4*slot + 42456` → `sub_49ED60` raw 119786-119795 读 `+1040/+1044`），
`0x23F` 读**对象**表（`Engine + 4*slot + 378688`）。修前 emulator 用 `Engine.texSizes`
（`0x1F8` 记的**表面**尺寸）当唯一来源 ⇒ 对**没有对象**的槽（AGF 载入的槽、或 `0x236` 建的对象——
`0x236` 尚未注册）也答出一个尺寸，**与引擎的 −1 相反**。

**改了什么**
- `op_get_slot_size`：`const node = c.native.slotNodeSize?.(slot)`；
  `!node?.present` ⇒ `op1 = -1`；否则 `op1 = Math.trunc(node.w * 1000)`。
  ★宿主**没实现该缝** ⇒ 按"没有对象"答 −1（并留一条闸门 A 缺口），**没有**静默答 0。
- `src/vm/native.ts`：新增**可选**缝 `slotNodeSize?(slot): {present,w,h} | undefined`（带完整依据与三态说明）。
- `src/vm/nativeTap.ts`：`slotNodeSize` 进 `BRIDGE_METHODS`（入桥 ⇒ 未实现的宿主会被闸门 A 记一次，
  而不是像"非桥方法"那样静默返回 `undefined`）——★这是一次**登记册同步**，见 §3 的 `native-tap.test.ts` 改动。
- `Engine.texSizes` **保留**（`0x1F8` 仍写、`0x1FA` 仍删）：它是"渲染侧表面尺寸"的 VM 镜像，
  读者是诊断/报告（`debugQuery.ts:223-230`）；**不再是 `0x23F` 的取值来源**。

**守卫**
`★0x23F：没有对象 ⇒ −1（即使该槽刚 create-texture 过，raw 40025-40027）`、
`★0x23F：有对象 ⇒ (int)(尺寸 × 1000)`（含"有对象但尺寸 0 ⇒ 0，不是 −1"那半）、
`★0x23F：宿主没给对象表（缝缺）⇒ 按"没有对象"答 −1，不静默答 0`

### ⑥⑦ P2/P3 `0x245` / `0x246` —— 两个**不同**的缩放常量

**引擎体**
- `0x245` = `sub_4251E0`（raw 32661-32676）：`if (_this[op1 + 94672]) return sub_4081B0(obj, (double)op2 / dbl_51FB50);`
  —— `dbl_51FB50 = 1000.0`（raw **4393**）⇒ **÷1000**（写点 raw 32672-32673）。
- `0x246` = `sub_425250`（raw 32680-32700）：类型门后 `... ((double)result / dbl_5201F0)` ——
  `dbl_5201F0 = 100.0`（raw **4430**）⇒ **÷100**（raw 32696-32697）。

⇒ 两族**不是同一个常量**，主 agent 的 brief §2.1 已核实。emulator 修前把 `op2` **原值**直传
⇒ 分别差 1000 倍 / 100 倍。

**改了什么**：`op_texture_obj_float` 下发 `value / 1000`；`op_texture_obj_param` 下发 `value / 100`。

**守卫**
`★0x245：下发给宿主的是 op2 / 1000`、`★0x246：下发给宿主的是 op2 / 100`、
`★两个缩放常量各自独立：同一个 op2 在 0x245/0x246 上得到不同的宿主值`（防"顺手合并"回归）

### ⑧ P2 `0x246` 的两道门 —— **登记，未修**

引擎体的两个前提（raw 32689-32694）：① `_this[result + 94672]` 非 0（该槽有对象）；
② `*(_DWORD *)(v4 + 1084) == dword_52839C`（= **0**，raw 4867）。emulator 两道都没有：

- 门① 需要 VM 侧的 `Engine[slot+94672]` 对象表 —— 与 ⑪ 同一个缺口（`0x236` 未注册；`0x20F`/`0x236` 建的对象
  只存在于宿主侧）。**没有**把宿主的 `slotNodeSize().present` 拿来当这道门 —— 两边不是同一个谓词
  （引擎判"表项非 0"，`present` 是"表项非 0"的宿主投影，但宿主在 `0x1F8` 那条路径上并不撤对象表），
  硬接会**多一层猜**。
- 门② 需要 `obj[+1084]` 的类型标记 —— 宿主缝只收 `(slot, value)`，**拿不到**。

**重评条件**：VM 侧出现对象表（`0x236` 注册 + `0x1F8`/`0x1F9`/`0x1FA` 在 VM 侧清它），或宿主缝扩成
`(slot, kind, value)`。**扩展点**：`op_texture_obj_param`（门）/ `native.slotNodeSize`（①的判据）。

### ⑨ P2 `0x249` 的槽记录语义 —— **登记，未修**

**引擎体**：`sub_425310`（raw 32717-32768）与 `0x1F9` 的差别只有 `sub_4A3800` 的第 6 参
（raw 32757 传 **1**；`0x1F9` raw 31232 传 **0**），callee（raw 123369-123389）：

```c
if ( a6 ) v7[466] = -1;          // ★0x249：槽记录 = −1（不是 imgid！）
else      v7[466] = a2;          //   0x1F9：槽记录 = imgid
v7[467] = a5;                    // ★颜色进 Scene[5*slot+467]
_this[5 * a4 + 470] = 0;         //   槽状态清 0
```

⇒ **`0x249` 绑定后 `0x216` 读到的 imgid 是 −1**，而 emulator 的 `op_load_texture_by_id` 写 `imgid`
（`e.texSlots.set(slot, imgid)`）⇒ 语义相反。要精确复刻需要给宿主缝一个"记录策略/类"参数
（与 `0x1F9` 分道），而 `bindTexture(imgid, slot)` 没有这一位 —— 跨 renderer 半边，见 §4。
**语料 20 处 / 8 脚本**，是否可观测需 renderer owner 一起判。

### ⑩ P2 `0x1f9` 的颜色消费端 —— **登记，未修**

引擎把归一化后的颜色写进 **`Scene[5*slot+467]`**（raw 123380，与 CTexture 表面表**并列的第二个数组**），
并作第 4 实参进表面对象 vtable+28 的装载调用（raw 119762-119766）。
emulator 走 `native.setTextureObjectParam?.(slot, normalizeTextureColor(color))` —— 而
`grep -rn "setTextureObjectParam" src/renderer/` ⇒ **只有注释命中，两个宿主都没有实现该方法**
（`PixiBackend`/`HeadlessScene` 都不在原型上）⇒ 颜色目前只落进**闸门 A**（`DropRecorder`），
`Scene[5*slot+467]` 那一格在 emulator 没有落点。

**为什么不在本轮修**：① 落点必须是宿主（那个数组属于渲染侧）；② `setTextureObjectParam` 这**一条缝现在承载两个
不同的引擎动作** —— `0x246` 的"子对象 vtable+56 浮点参数"与 `0x1F9`/`0x249` 的"颜色"，
两者的值域与消费端完全不同（0.5 这种比例 vs `0xFFrrggbb`）。给同一个缝塞两种语义会被下一次审计判成 host-invented
⇒ 需要**拆分缝**（如 `setTextureSlotColor(slot, argb)`），那是 renderer 侧的签名变更，见 §4。
**重评条件**：出现"颜色必须被渲染侧看见"的真语料现场（E4），或 renderer owner 拆分该缝。

### ⑪ P3 "先销毁该槽 movie 播放器对象" —— **登记，未修**

四条（`0x1f8` raw 31171-31183 / `0x1f9` raw 31211-31221 / `0x1fa` raw 31255-31265 /
`0x249` raw 32736-32746）都是同一段：

```c
v3 = _this[v2 + 94672];                        // 该槽的 movie/node 对象（1000 槽表）
if ( v3 ) { sub_488FB0(v3); (**v4)(v4, 1); _this[v2 + 94672] = 0; }
```

**VM 侧没有这张表**：`0x236`（`sub_4246B0` raw 32245-32264）的 handler **未注册**
（`analysis/opcode-gaps.json` 记 `deferred`，票 `T-0076`），`0x20F`（`sub_4237B0` raw 31605-31670）
只经 `native.playMovie` 在**宿主侧**建对象（renderer 半边已交付 `TextureCache.noteSlotNode` /
`HeadlessScene.slotNodes`，且 `0x1F8`/`0x1F9`/`0x1FA` 的**宿主**路径都会清它）。
⇒ 按纪律**如实登记缺口、不造假模型**（主 agent 的 brief §2.6 明确要求）。

---

## 2. 两个易错点的写法（给后人）

1. **两个常量不许合并**：`dbl_51FB50 = 1000.0`（`0x245` 族，raw 4393）与 `dbl_5201F0 = 100.0`
   （`0x246` 族，raw 4430）是**两个全局**，raw 里分别出现在 `_this[...]/dbl_51FB50` 与 `/dbl_5201F0`。
   守卫里专门有一条"同一个 op2 在两族上得到不同宿主值"来钉死这一点。
2. **`texSizes` 不是 `0x23F` 的来源**：它是 emulator 自造的"渲染侧表面尺寸"镜像（写成 `[w,h]`），
   引擎那一格（`Scene[5*slot+466]`）**写的是 −1**，而 `0x23F` 的尺寸来自对象表。
   `texSizes` 现在只服务诊断/报告（`debugQuery.ts`），**不许**再拿它当 `0x23F` 的答案。

---

## 3. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/src/vm/handlers/gfx-texture.ts` | `op_create_texture` 擦槽记录（−1）；`op_release_texture` 加外层门 + 写 −1；`op_get_slot_size` 改读宿主对象表；`op_texture_obj_float` ÷1000；`op_texture_obj_param` ÷100；四条 handler 注释按体重写（含未修饰口的披露） |
| `app/amayui-emulator/src/vm/engineFieldIds.ts` | **新增** `ENGINE_FIELD.surfaceReleaseGate = 11676`（字节 46704，raw 119591） |
| `app/amayui-emulator/src/vm/native.ts` | **新增**可选缝 `slotNodeSize?(slot)`（`0x23F` 的对象表查询；与 `getTextureSize` 的区别写在注释里） |
| `app/amayui-emulator/src/vm/nativeTap.ts` | `slotNodeSize` 进 `BRIDGE_METHODS` |
| `app/amayui-emulator/test/op-15xx-gfx-texture-vm.test.ts` | **新增** 10 条守卫（①–⑦） |
| `app/amayui-emulator/test/native-tap.test.ts` | **登记册同步**（T-0013 的守卫要求）：`slotNodeSize` 从两份 `NON_BRIDGE` 移到桥（注释说明它现在是 `0x23F` 的真调用方） |
| `app/amayui-emulator/test/op-23f-slot-size.test.ts` | **最小 retarget**（见 §5.2） |
| `app/amayui-emulator/test/op-a2-a3.test.ts` | **最小 retarget** 1 处（`0x245`/`0x246` 的期望值由原值改成换算后的值，见 §5.3） |

**未动**：`src/renderer/**`、`src/arch/**`、`src/text/**`、`src/frame/**`、`src/tools/**`、
`analysis/*.json`、`tickets/T-0153/ticket.json`、`tickets/T-0153/changes-renderer.md`、
`src/vm/{engine,msgwin,textItems,operandPlan}.ts`、`src/vm/handlers/msgwin.ts`。

---

## 4. 与 renderer / 其它半边的耦合点（**需要别人动手**，我改不了）

| # | 耦合 | 需要的动作 | 归属 |
|---|---|---|---|
| C1 | `0x23F` 的"对象存在"门与**宿主对象表**的时序 | `0x1F8` 在引擎里**先析构 `Engine[slot+94672]`**（raw 31173-31183）；宿主侧 `createTexture` 已清该槽对象（renderer 半边交付），但 VM 侧的 `0x23F` 只问"present"，**不知道**"这个对象是 `0x20F` 还是 `0x236` 建的" | 若出现"`create-texture` 后对象仍在"的现场，需在宿主缝加"建/清"事件或让 `0x236` 注册 |
| C2 | `0x249` 的 `a6=1` ⇒ 槽记录 −1 | `NativeBridge.bindTexture(imgid, slot)` 加一位"记录策略/类"（或新增 `bindTextureForMovie`）；**跨 renderer 半边** | 见 §6 的台账条目 `opcode 575`/`0x249` 语境；VM 侧实现即可，但签名变更要 renderer 同意 |
| C3 | `0x1F9`/`0x249` 的**颜色**没有落点 | 拆缝：`setTextureSlotColor?(slot, argb)`（`Scene[5*slot+467]` 的对应物）并在两个宿主实现；`setTextureObjectParam` 保持只服务 `0x246` | renderer owner（`src/renderer/**`） |
| C4 | `0x246` 的类型标记门 `obj[+1084] == 0` | 宿主缝扩成 `(slot, kind, value)`，或 VM 侧对象表落地 | 与 C2 同一批 |
| C5 | `0x248` → 宿主 `tileSize` 的接线 | `TextureCache.tileSize` 目前恒 256（引擎初值）；VM 侧 `op_set_render_cfg_248` 只写 `engineValues[-248]` | 见 `changes-renderer.md` §5.5（renderer 侧登记） |
| C6 | `0x236` handler 未注册 | 注册后 `Engine[slot+94672]` 才有非 `0x20F` 的来源 | `T-0076`（台账 `deferred`） |

---

## 5. 命令与红→绿证据

### 5.1 新守卫

```powershell
cd app/amayui-emulator
# ① 先写守卫、跑红（10 条全红，失败形状全是**真断言**，不是模块缺失）
node --import tsx --test test/op-15xx-gfx-texture-vm.test.ts
#   ✖ ★0x1F8：create-texture 把该槽的 imgid 记录擦成 −1        （实际 0x5250 ≠ −1）
#   ✖ ★0x1F8：擦完记录之后 0x23F 不算"有对象"                  （实际 120000 ≠ 120000? 见注）
#   ✖ ★0x1FA：外层门 不成立 ⇒ 记录与表面都不动                 （门关时仍被写成 −1）
#   ✖ ★0x1FA：记录槽位 = ENGINE_FIELD.surfaceReleaseGate       （字段不存在 ⇒ undefined）
#   ✖ ★0x23F：没有对象 ⇒ −1                                   （实际 120000 ≠ −1）
#   ✖ ★0x23F：有对象 ⇒ (int)(尺寸 × 1000)                      （缝没接 ⇒ −1）
#   ✖ ★0x23F：宿主没给对象表 ⇒ −1                              （实际 120000 ≠ −1）
#   ✖ ★0x245：op2 / 1000                                      （实际 500 ≠ 0.5）
#   ✖ ★0x246：op2 / 100                                       （实际 250 ≠ 2.5）
#   ✖ ★两个缩放常量各自独立                                    （实际 1000 ≠ 1）
#   ℹ tests 10 / pass 0 / fail 10
```

```powershell
# ② 实现后绿（与全部相关既有套件一起）
node --import tsx --test test/op-15xx-gfx-texture-vm.test.ts \
  test/op-23f-slot-size.test.ts test/op-a2-a3.test.ts test/native-tap.test.ts \
  test/texture-renderer-gaps.test.ts test/texture-slot-resolve.test.ts \
  test/op-20b-fill-texture.test.ts test/texture-lifecycle.test.ts \
  test/texture-bind-race.test.ts test/texture-frame-barrier.test.ts \
  test/op-underun-fixups.test.ts test/engine-field-ids.test.ts
#   ℹ tests 76 / pass 76 / fail 0
```

### 5.2 ★`test/op-23f-slot-size.test.ts` 的最小 retarget（**前提被取代**）

**旧前提（为何不成立）**：该文件钉的是「`create-texture 2a 78 78 0`（120×120）⇒ **即使没有对象**也答 `120000`」。
那正是审计点名的 `host-invented`：`0x23F` 的取值来源本该是**对象表** `Engine[slot + 94672]`
（raw 40025-40029），不是 `0x1F8` 记的表面尺寸 ⇒ 旧断言钉的是一条**与引擎相反**的行为。

**怎么改（保留锚点，能钉多强就钉多强）**
- 全部原有锚点**一条未删**：`src/FIELD.txt:13718-13721`、`dbl_51FB50 = 1000.0`（raw 4393）、
  "缺槽 ⇒ −1"、"释放后 ⇒ −1（不留陈旧尺寸）"、`×1000` 取整。
- 把"对象表"这一步**显式补上**并**新增**两条更强断言：
  「只有 `create-texture`（没有对象）⇒ **−1**」+「建出该槽对象后 ⇒ 120000」；
  建对象走 `0x20F` play-movie（与 `0x236` 同一条"惰性建 `Engine[slot+94672]`"，
  `0x236` 尚未注册，见 §4 C6）。
- 新增一个**只服务本文件**的 `NodeStub`（复刻两个真宿主在 `0x23F` 上的判据：`0x1F8` 记表面尺寸、
  `0x20F` 建对象；真判据的唯一实现在 `renderer/slotSurface.ts`，**没有**在这里抄第二份）。

### 5.3 ★`test/op-a2-a3.test.ts` 的最小 retarget（**前提被取代**）

旧断言 `['float', 196, 500]` / `['param', 196, 250]` 钉的是"原值直传"—— 那是修复前的口径。
按体改成 `['float', 196, 0.5]`（÷1000，raw 32673）/ `['param', 196, 2.5]`（÷100，raw 32696-32697），
并在原地写明两个常量与 raw 区间。其余断言（`0x249` 的 `bind` 与颜色 `0xff00ff00`）**未动**。

### 5.4 `test/native-tap.test.ts` 的登记册同步

`slotNodeSize` 由"宿主自造方法"变成**桥方法**（`0x23F` 真的会调它）⇒ 按 T-0013 的守卫要求：
从 `NON_BRIDGE['pixiBackend.ts']` 与 `NON_BRIDGE['headlessScene.ts']` 两份清单里移除，
并把原注释改写成"已入桥 + 与 `getTextureSize` 不是同一个问题"。**没有删任何断言**。

### 5.5 归属对照（证明**不新增红**）

环境事实：并行单元（`T-0151`/`T-0152`/`T-0159`/`T-0160`/`T-0108`）在同一棵树里改文件，
`npm run test:all` 的**红名单每几分钟就变一次**，所以"我的改动有没有新增红"必须**对照测量**。

方法（脚本 `.tmp/t0153-texvm/attribution.mts`，不进仓库）：把**只有我改过的 8 个 tracked 文件**
临时按 `HEAD` 覆盖（新守卫文件临时改名），跑一组"可能被我影响"的 35 个测试文件，收集红名单，
**finally 里用备份字节无条件恢复**（不用 `git checkout` ⇒ 绝不碰别人的行内改动）。

```
# HEAD 对照（我的改动不存在）
ℹ tests 190 / pass 184 / fail 6
红名单 6 条：
  · engine-slot ★E4 本机真槽全部解出（storedDwords）        ← 基线红
  · save-slot  E4 真存档槽的头 → 0x1A0 六个 u16（format）    ← 基线红
  · scene-report 场景执行报告（可绘制项 24 ≤ 缺纹理项 26）   ← 基线红
  · native-tap ★桥能力面 ×2                                  ← 由**我的实例**造成（已入桥 ⇒ 必须同步清单）
  · texture-slot-resolve "release 只解纹理"                  ← renderer 半边的 retarget（我未动该文件）
```

⇒ 装上我的改动后，后 3 条消失、前 3 条仍在 ⇒ **本子集新增红 = 0**。
★`texture-slot-resolve.test.ts` 那条**不是我造成的**：该文件的工作树版本早已被 T-0153 的 renderer owner
retarget 成"release 并把槽记录写 −1"（`git diff` 可见），红只出现在"按 HEAD 回退"的对照运行里
（HEAD 里还是旧断言）。装上当前工作树版本 ⇒ **绿**（见 §5.1 的第二条命令）。

### 5.6 收尾状态（如实，2026-09-25 实测）

- **类型**：`node node_modules/typescript/bin/tsc -p <cfg> --noEmit` 对
  `tsconfig.json` / `tsconfig.control.json` / `tsconfig.electron.json` / `tsconfig.test.json`
  **四个都 exit 0**（★本机 `npm run typecheck` 会报 `'tsc' is not recognized` —— `node_modules/.bin` 缺失，
  不是代码问题；用 `node node_modules/typescript/bin/tsc` 走）。
- **我的守卫与相关棘轮**（一条命令，13 个文件）→ **79/79 绿**：
  ```powershell
  node --import tsx --test test/op-15xx-gfx-texture-vm.test.ts test/op-23f-slot-size.test.ts \
    test/op-a2-a3.test.ts test/native-tap.test.ts test/texture-renderer-gaps.test.ts \
    test/texture-slot-resolve.test.ts test/op-20b-fill-texture.test.ts test/texture-lifecycle.test.ts \
    test/texture-bind-race.test.ts test/texture-frame-barrier.test.ts test/op-underun-fixups.test.ts \
    test/engine-field-ids.test.ts test/registry-classification.test.ts test/opcode-operands.test.ts
  # ℹ tests 79 / pass 79 / fail 0
  ```
  （★与 §5.1 的 76 条相比多出 3 条：`registry-classification` 与 `opcode-operands` 两个棘轮 —— 都绿。）
- **死写闸门**：`node --import tsx src/tools/deadWrites.ts` → 基线 13 / 当前 13 / **★无新增死写**。
- **`test:org`** → ✅ 0 问题（201 文件）。
- **`ticket-ledger.test.ts`** → 6/6 绿（我只**新增**了一份过程文档 `changes-texvm.md`，没动 `ticket.json`）。
- **`node --import tsx test/run.ts all`（全量）** = 最终一次 `tests 1394 / pass 1382 / fail 10 / skipped 2`。
  10 条红**逐条归因**（没有一条在我的文件或守卫上）：

  | 测试文件 | 归因 |
  |---|---|
  | `engine-slot.test.ts` | **基线红**（SAVE70/71 `storedDwords`） |
  | `save-slot.test.ts` | **基线红**（真槽 `format`） |
  | `scene-report.test.ts` | **基线红**（可绘制项 24 ≤ 缺纹理项 26） |
  | `l2d-node-transform-ops.test.ts` ×3 | `T-0160`（Live2D）在飞 |
  | `input.test.ts` | `T-0171` 的滚轮位号族在飞 |
  | `host-registry.test.ts` | 环境（真进程 `--idle-sec 1` 缺 `dist/web` 产物） |
  | `organization.test.ts` | R2「T0 不得依赖未入库的真游戏资源」—— 并行单元新加的真资源测试 |
  | `wheel.test.ts` | **别的 agent 的语法错误**：`src/vm/handlers/config-read.ts:218:70 Expected ";" but found "cfgStr"` |

- ★**过程中遇到并已解除的两个环境阻塞**（都不是我改的、我都没有动那些文件）：
  1. `src/audio/audioEngine.ts` 被 B3（`T-0152`）在飞改成语法坏掉的状态 ⇒ 一度全仓 `tsc` 报
     `TS1005`。**已解除**（最终四个 tsconfig 全 0）。
  2. `src/save/saveSlot.ts` 的 `SLOT_GAME_NAME_KEY` 导出被 `T-0159` 拿掉、
     而 `src/vm/handlers/save-slot.ts:23` 仍在 import ⇒ **import 期即抛**，经 `ops.ts` 注册表
     波及**每一个**测试文件（我的三条也被挡住，`.tmp/t0153-texvm/test-all-main.txt` 那一轮即此态）。
     **已解除**（见 §5.6 的 79/79 与全量 1394）。我的守卫**一行都没改**就恢复了绿。

---

## 6. 台账待应用（请主 agent 应用到 `analysis/opcode-gaps.json`）

> 工具/落地方式：直接改 `analysis/opcode-gaps.json`（唯一真源）→ `node scripts/build-opcode-gaps.mjs`
> 重生成 `docs-new/03-engine/opcode-gaps.md` → `cd app/amayui-emulator && node --import tsx --test test/opcode-gaps.test.ts`（棘轮）。
> ★这里只写**本 VM 半边**要改的条目；renderer 半边的 §4 那几条已在 `changes-renderer.md` 里给过，不重复。
> "删除" = 从该条目的 `missing[]` 里删掉那**一个对象**，不是删条目。

### 6.1 `opcode 504`（`i1f8`）— 改写 2 条 `missing[]`、删 1 条

- **删除** `missing[]` 里 `raw: "122847-122848"` 的那条（`what` 以 "0x1F8 不只建表面，它（经 sub_4A2C10）还**擦掉该槽的颜色记录与槽状态两格**" 开头）。
  依据：`test/op-15xx-gfx-texture-vm.test.ts` 的
  `★0x1F8：create-texture 把该槽的 imgid 记录擦成 −1（Scene[5*slot+466]，不是留着旧 imgid）`。
  ★**但 `Scene[5*slot+467]`（颜色）与 `Scene[5*slot+470]`（槽状态）那两格仍未建模**（见 §4 C3）⇒
  建议**改写**而不是删干净，替换为：

```json
{
  "what": "`0x1F8`（经 `sub_4A2C10` raw 122847）写的三格里，**只有槽→imgid 记录那一格**（`Scene[5*slot+466] = -1`）已落地（T-0153 的 VM 半边：`op_create_texture` 写 `Engine.texSlots`）；另两格 —— 颜色记录 `Scene[5*slot+467] = -1` 与槽状态 `Scene[5*slot+470] = 1` —— 在 emulator 仍没有落点（颜色那一格与 `0x1F9`/`0x249` 是同一张数组，等宿主缝拆分，见 T-0153 的 C3）",
  "ticket": "T-0153",
  "raw": "122847-122848"
}
```

- **保留** `raw: "31171-31188"`（"先销毁该槽已有的对象"）**原样** —— VM 侧仍无 `Engine[slot+94672]` 对象表（§4 C6）。
- **保留** renderer 半边要改的那条（`raw: "122855-122872"`，mode==3 ⇒ DividedTexture）—— 按 `changes-renderer.md` §4.1 处理。

### 6.2 `opcode 506`（`i1fa`）— 删 2 条、改写 1 条

- **删除** `missing[]` 里 `raw: "119585-119603"` 且 `what` 以 "引擎 release-texture 经 sub_49E980 把槽→imgid 记录写成 −1" 开头的那条（VM 侧已写 `texSlots.set(layer, -1)`）。
- **删除** `raw: "119591-119601"` 的那条（外层门 `if (!_this[a2+11676])`）—— 已建模为 `ENGINE_FIELD.surfaceReleaseGate`。
  依据：`★0x1FA：外层门 ...`、`★0x1FA：记录槽位是「槽号 + 11676」...`。
- **改写** `raw: "31245-31269"`（"引擎先销毁该槽的 movie 播放器对象"）那条：宿主侧已建对象表并在三个销毁点清它，
  但 VM 侧仍无表 ⇒ 建议：

```json
{
  "what": "该槽 movie/对象（`Engine[slot + 94672]`）在**宿主侧**已建模（T-0153 的 renderer 子集：`TextureCache.noteSlotNode` / `HeadlessScene.slotNodes`，且 `0x1F8`/`0x1F9`/`0x1FA` 的宿主路径都清它）；**VM 侧仍没有这张表** —— `0x236`（`sub_4246B0` raw 32245-32264）的 handler 未注册，`0x20F` 只经 `native.playMovie` 在宿主侧建对象 ⇒ `0x23F` 的"对象存在"判据只能问宿主（`native.slotNodeSize`）",
  "ticket": "T-0153",
  "raw": "31245-31269"
}
```

### 6.3 `opcode 575`（`i23f`）— 删 1 条、改写 1 条

- **删除** `missing[]` 里 `raw: "31627-31644"` 且 `what` 含 "仍缺 VM 侧接线" 的那条（VM 侧已接 `native.slotNodeSize`）。
  依据：`test/op-15xx-gfx-texture-vm.test.ts` 的三条 `★0x23F`。
- **改写** `raw: "40018-40032"`（`host-invented`：两张表混用）那条 ⇒ **两表已分开**：

```json
{
  "what": "**两张表已分开**（T-0153 的 VM 半边）：`0x23F` 的取值来源已从 `Engine.texSizes`（`0x1F8` 记的表面尺寸镜像）改为**宿主的对象表** `native.slotNodeSize(slot)`（= `Engine[slot + 94672]` 的投影，raw 40025-40029）；`0x208` 仍读表面表（`Scene + 4*slot + 42456`）。★仍披露的近似：宿主 `slotNodeSizeOf` 在"有对象"时答**该槽表面**的尺寸（`src/FIELD.txt:13718-13721` 是唯一语料现场），不是 `obj[+1044]` 那个子对象 —— 引擎那条链在 `sub_4080B0` 未分派类型时返回 `0.0`（raw 12967/12979），宿主同码答 0",
  "ticket": "T-0153",
  "raw": "40018-40032"
}
```

### 6.4 `opcode 581`（`i245`）— 删 1 条 `missing[]`

- **删除** `missing[]` 里 `raw: "32672-32673"` 且 `what` 含 "单位差 1000 倍" 的那条。
  依据：`★0x245：下发给宿主的是 op2 / 1000（dbl_51FB50 = 1000.0，raw 4393 / 32673）`。
- **保留** `raw: "32670"` 那条（`if (_this[result + 94672])` 的"对象存在"门）—— VM 侧仍无对象表（同 §4 C6）。

### 6.5 `opcode 582`（`i246`）— 删 1 条、保留 2 条

- **删除** `missing[]` 里 `raw: "32696-32697"`（`op2 / dbl_5201F0`，÷100）那条。
  依据：`★0x246：下发给宿主的是 op2 / 100（dbl_5201F0 = 100.0，raw 4430 / 32696-32697）`。
- **保留** `raw: "32689"`（对象存在门）与 `raw: "32693"`（类型标记门 `*(obj+1084) == dword_52839C`）两条，
  并在各自 `what` 里补一句：「T-0153 复核：两门都需要 VM 侧对象表 / 宿主缝扩成 `(slot, kind, value)`；
  `T-0153/changes-texvm.md` §4 的 C4 是扩展点」。

### 6.6 `opcode 585`（`i249`）— 改写 1 条、保留 1 条

- **改写** `missing[]` 里 `raw: "123375-123380"` 且 `what` 含 "0x249 传给 sub_4A3800 的第 6 参是 1" 的那条 ⇒
  仍**未修**（VM 侧仍写 `imgid`），但要把"为什么没修"写清：

```json
{
  "what": "`0x249` 的槽记录语义仍与引擎**相反**（T-0153 复核、**未修**）：引擎传 `a6 = 1` ⇒ callee（raw 123377）写 `v7[466] = -1`，而 emulator 的 `op_load_texture_by_id` 写 `imgid`。要精确复刻需要 `NativeBridge.bindTexture` 多一位"记录策略/类"（跨 renderer 半边），见 `tickets/T-0153/changes-texvm.md` §4 的 C2；`0x249` 语料 20 处/8 脚本，是否可观测待 renderer owner 一并判",
  "ticket": "T-0153",
  "raw": "123375-123380"
}
```

- **保留** `raw: "32750-32755"`（颜色归一化）原样 —— 归一化本身早已对（`T-0086`），
  但**消费端仍缺**（§4 C3）⇒ 建议在该条 `what` 末尾补：「T-0153 复核：`setTextureObjectParam` **两个宿主都未实现**
  ⇒ 颜色目前只落进闸门 A；且这条缝现在同时承载 `0x246` 的浮点参数，需要拆分」。

### 6.7 `opcode 578`（`i23e`）/`opcode 520`（`i208`）— **不动**

- `0x23E`（`sub_430750`）语料 0 处 ⇒ 维持 `deferred`。
- `0x208` 的两条按 `changes-renderer.md` §4.7 处理，本子集不改判。

---

## 7. 未做 / 受阻 / 需要别的 owner 接手的

1. **⑧⑨⑩⑪ 四条未修**（`0x246` 的两道门、`0x249` 的 `a6` 语义、`0x1F9`/`0x249` 的颜色落点、四条"先销毁 movie 对象"）——
   全部需要在 VM 侧建一张"对象表"或**拆宿主缝**，跨 §4 的 C2/C3/C4/C6。**没有**为了"看起来做完"造模型。
2. **`test/opcode-gaps.test.ts` 是棘轮**：§6 的条目我**没有**写进 `analysis/opcode-gaps.json`
   （该文件此刻归别处 / 主 agent 串行应用）⇒ 交回后需要主 agent 落一次，否则台账与守卫不同步。
3. **过程中遇到的两个环境阻塞（都不是我改的、我都没动那些文件）**，最终均已解除，见 §5.6 末段：
   `src/audio/audioEngine.ts`（`T-0152` 在飞 ⇒ 一度 `TS1005`）与 `src/save/saveSlot.ts` 的
   `SLOT_GAME_NAME_KEY`（`T-0159` 在飞 ⇒ import 期抛、波及全部测试）。
4. **`wheel.test.ts` 现在是别人的语法错误**（`src/vm/handlers/config-read.ts:218:70`）⇒ 与你无关，
   但会连带 `test:all` 里那一格；见 §5.6 的归因表。
5. **`0x1F8` 写 `texSlots = -1` 的行为面**（供 owner 知情）：`0x215`（`handlers/gfx-item.ts:82`）
   现在会对"建过表面但没绑定图"的槽答 **−1**（修前是 0/未登记）。这与引擎一致（raw 123377 的
   `v7[466] = -1` 就是 `0x215` 会读到的东西），但若某条真语料依赖旧值，现场会不同 ⇒ 已写进 §1① 的说明。
6. **`.tmp/t0153-texvm/`** 下的对照脚本与全量日志是**一次性**产物（`.tmp/` 是 gitignore 的临时区），
   结论已如实写进本文件，**不依赖**它们。
