# T-0153 · `src/renderer/**` + `src/arch/**` 子集（7 条）变更记录

> 本文件**只覆盖本票落在 `src/renderer/**` 与 `src/arch/**` 的那 7 条**（审计工作清单
> `app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` 的 T-0153 节里锚点在本范围的行）。
> 其余 15+ 条锚在 `src/vm/handlers/gfx-texture.ts`，**归另一位 owner**，本文件不碰、不改判。
> ★`tickets/T-0153/ticket.json` 的状态与 `tests[]` 由主 agent 结算（本子集**不动**那张票）。
>
> 权威 = 引擎函数体（`engine/天结_unpacked.exe_utf8.c`，行号 = raw）。下面每条都带自己读到的 raw
> 行区间；凡"没有/不存在"都写了搜索方式。

## 0. 一句话结论

| # | sev | 对象 | 结论 |
|---|---|---|---|
| ① | P3 | `0x1f8` mode==3 ⇒ DividedTexture | **修好**（建类 + 子纹理表；守卫 4 条） |
| ② | P3 | `0x208` 同步 getter 的近似 | **登记**（有意保留 + 扩展点 + 重评条件；守卫 1 条钉住当前口径） |
| ③ | P3 | `0x20b` 矩形夹取/空矩形早退 | **修好**（纯函数 + 源码棘轮 + 接线） |
| ④ | P2 | `0x23f` 有对象的槽要有尺寸可查 | **renderer 半边修好**（对象表 + 查询缝，两宿主），VM 半边交回 owner（§5） |
| ⑤ | P3 | `0x1fa` 释放要撤尺寸缓存 | **修好**（headless + Pixi **两宿主**；顺带订正审计对 Pixi 侧的判断，见 §5） |
| ⑥ | P2 | `0x1ab` 删槽要删真实目录那一份 | **修好**（两侧都删 + base 那一份先隔离；守卫 6 条） |
| ⑦ | P2 | `0x19E` 缺 overlay 时静默 no-op | **修好**（改成显式失败；守卫 2 条，含端到端结果码） |

命令与红→绿证据见 §3；**未做/受阻**见 §5；需要主 agent 应用到 `analysis/*.json` 的精确内容见 §4。

---

## 1. 逐条

### ① P3 `0x1f8` / missing-branch —— `mode == 3` 建的是**另一个类**

**现象（审计）**：emulator 只把 `mode` 存进槽记录（`scSetSlotMode`，供混合门控）+ 打印日志，
不建任何"分块纹理"模型。

**引擎体（本轮自己读的）**
- `sub_4A2C10`（`0x1F8` 的内核，**raw 122837-122893**）：
  `*(_DWORD *)(_this + 20 * a2 + 1864) = -1;`（raw 122847）、`*(_DWORD *)(_this + 4 * (5 * a2 + 470)) = 1;`（raw 122848）、
  先析构 `_this + 4*a2 + 42456`（该槽旧 CTexture，raw 122851-122856）、
  **`if ( a5 == 3 ) { v7 = operator new(0x460u); v8 = sub_43A5C0(v7, …); }`（raw 122857-122861）**
  **`else { v9 = operator new(0x450u); v8 = sub_48AB20(v9, …); }`（raw 122866-122871）**，
  最后 `(*(obj_vt+12))(obj, a3, a4, a5)` 建表面（raw 122876）。
- `sub_43A5C0`（raw 46561-46570）：`sub_48AB20(...)` 后换 `DividedTexture___vftable_`，并清
  `_this[276]/[277]/[278]` = **字节 1104/1108/1112**（子纹理 `std::vector` 的 begin/end/cap）。
- `sub_43A740`（DividedTexture 的 vtable+12，raw 46611-46798）：
  `v35 = a2 / dword_55052C + (a2 % dword_55052C != 0)`（列数，raw 46675）、
  `v11 = a3 / dword_55052C + (a3 % dword_55052C != 0)`（行数，raw 46677）；
  **逐格 `operator new(0x450u)` + `sub_48AB20`**（raw 46710-46715）append 进 vector（raw 46775）；
  满格边长 = `dword_55052C`，**末列**取 `a2 % dword_55052C`（raw 46777-46778）、**末行**取 `a3 % dword_55052C`（raw 46781-46782）；
  最后写表面记录 `[263..266] = (0,0,w,h)`（raw 46686-46689）。
- `dword_55052C`：`int dword_55052C = 256;`（raw 5663），**由 `0x248` 改写**（`sub_4252E0` raw 32705-32712：
  `result = sub_41BF50(_this, 1); dword_55052C = result;`）⇒ 分块边长是**脚本可配**的。
- 析构端 `sub_43A630`（raw 46573-46598）遍历那个 vector 逐个析构并 `operator delete` 它的存储。

**改了什么**
- 新增 `src/renderer/slotSurface.ts`：`DEFAULT_TILE_SIZE = 256`、`SurfaceClass`、`DividedTile`、
  `dividedTiles(w, h, tile)`（行主序 + 末行/末列截断；尺寸 ≤0 或 tile ≤0 ⇒ `[]`）。
- `TextureCache`：新增 `tileSize`（= `dword_55052C`）、`#slotClass`、`#slotTiles`；
  `create()` 按 `mode === 3 ? 'divided' : 'normal'` 记录类与子纹理表（**在 DOM 判断之前**，
  与引擎"先写槽记录、再建对象、最后建表面"同序）；`release()` 一并撤（dtor 语义）。
  公开查询：`surfaceClassOf(slot)` / `dividedTilesOf(slot)`。日志加 `class=`/`tiles=`（E4 归因）。
- 未做（**如实登记**）：没有为 DividedTexture 建"多张子画布"—— 引擎的 8 处 `sub_4A4C70`/绘制
  路径都走 vtable 通用口，像素结果在宿主侧仍是一张画布；且**语料 mode 3 = 0 处**（审计实测
  {0:286, 1:263, 2:756}），当前不可观测。类与子纹理表是"查询/分派口径"的载体（见 ④）。

**守卫**（`test/texture-renderer-gaps.test.ts`）
`★0x1F8 mode==3 ⇒ DividedTexture：分块表按 ceil(w/格子)×ceil(h/格子)，末行/末列按余数截断`、
`★0x1F8：分块边长 = 引擎 dword_55052C（默认 256，0x248 可改；raw 5663 / 46675）`、
`★0x1F8：换类/释放 ⇒ 旧类的分块表随之撤（sub_43A630 的 dtor 释 vector，raw 46573-46598）`、
`★0x1F8：dividedTiles 纯函数边界（0/负尺寸、恰好整除、tile 非法值）`。

**★顺带发现（不属于本条，但同族、给 owner 参考）**：**装载路径也建 DividedTexture** ——
`sub_49E9D0`（`0x1F9`/`0x249` 共用的装载内核，raw 119605-119771）在 `if ( a5 )`（= `sub_4A3800`
第 6 参；`0x249` 传 1、`0x1F9` 传 0）时 `operator new(0x460u)` + `sub_43A5C0`（raw 119738-119748），
否则 `0x450` + `sub_48AB20`（raw 119750-119760）。⇒ `0x249` 建的表面**也是 DividedTexture**，
而 emulator 的 `bindTexture(imgid, slot)` 拿不到那个 flag（`NativeBridge` 没这一位）。
`0x249` 语料 20 处/8 脚本，是否可观测待 owner 判；要建模需在宿主缝上加"类/flag"参数。

### ② P3 `0x208` / approximation —— 同步 getter 的近似（**登记，不修**）

**引擎体**：`sub_4302E0`（raw 39865-39878）→ `sub_49ED60`（raw 119773-119798）读该槽
`+1040`（宽）/`+1044`（高）；表项为 0 ⇒ 写 `0/0`。因为 `set-texture` 是**同步**读+解码
（`sub_422CB0` raw 31192-31243 → `sub_4559C0`），**同一批指令**里 `0x208` 立刻能拿到真宽高。

**本工程现状**：图像经 `window.api.image()`（IPC + 主进程解码）**异步**到货 ⇒ 同批
`bind` + `0x208` 只能答 `0×0`（`TextureCache.size()`），到货/帧屏障之后才是真值。
这是 `tickets/T-0102` 已经查过的那条链（`image 尚未载入 ⇒ 0×0`、唯一自愈 = 再发一次 `set-texture`）。

**为什么本轮不修（写清楚，别让后人以为是漏了）**：修它必须让"装载"变得**同步**，而两条路线
都在本子集之外：
1. 把 `NativeBridge.bindTexture` 改成可 `await`（`Promise<void>`）并在 `op_set_texture` 里 `await`
   —— 这正是引擎的语义（指令返回时图已在内存），但要动 `src/vm/**`；
2. 主进程提供**同步**的 `imgid → {w,h}` 缝（`.c` 侧已有现成实现：`NodeFileSource.readHeaderSync`
   + `agfSizeOf`，见 `src/arch/agfSize.ts`；缺的是 `electron/preload.ts` 的 `sendSync` 通道与
   `ipcProtocol` 的声明，也不在本子集）。

**重新评估条件**：出现"同批 `set-texture` 后立刻 `0x208`"的真语料用法（E4 现场），或上面任一条缝落地。
**扩展点**：`TextureCache.size()`（答案）+ `PixiBackend.getTextureSize`（缝）。

**守卫**：`test/texture-renderer-gaps.test.ts` 的
`★0x208 已知近似（T-0153 登记项）：同批 bind+查询 ⇒ 0×0；屏障后才是真值`
（钉住"当前口径 + 唯一的自愈路径"，并断言重复查询不重复发起载入）。
★这条守卫**生来就是绿的**（它登记的是保留项，不是修复项）—— 不算红→绿单元，如实标注。

### ③ P3 `0x20b` / missing-branch —— 先夹到表面记录、夹空不画

**引擎体**：`sub_4A4C70`（raw 124572-124649）：
```c
v7 = _this[a2 + 10614];               // 该槽 CTexture
v8 = v7[263]; v18 = v7[264]; v9 = v7[265]; v10 = v7[266];   // raw 124608-124613，表面记录 = (0,0,w,h)
if ( *a3 < v8 )  *a3 = v8;            // 左取 max（raw 124614）
if ( a3[1] < v18 ) a3[1] = v18;       // 上取 max（raw 124616）
if ( a3[2] > v9 )  a3[2] = v9;        // 右取 min（raw 124618）
if ( a3[3] > v10 ) a3[3] = v10;       // 下取 min（raw 124620）
if ( *v5 >= v5[2] ) return 1;         // ★空 ⇒ 直接返回，不画（raw 124631-124632）
if ( v5[1] >= v5[3] ) return 1;       // raw 124633-124634
```
表面记录 `[263..266]` 由建面路径写成 `(0,0,w,h)`：NormalTexture raw 107024-107032、
DividedTexture raw 46683-46689（两份都读过）。

**改了什么**：`slotSurface.ts` 新增纯函数 `clampFillRect(bw, bh, x, y, w, h)`（返回夹取后的
`{x,y,w,h}` 或 `null`）；`TextureCache.fillSlotRect` 改为"先夹、`null` 就记一条日志并 return"，
再 `ctx.fillRect(r.x, r.y, r.w, r.h)`；日志在被夹时标 `（被表面边界夹取）`。
（`0x20B` 的 op4/op5 是**宽/高**这一点早已锁在 `test/op-20b-fill-texture.test.ts`，未改。）

**守卫**：`★0x20B：矩形夹到表面记录 [0,0,w,h]（左上取 max、右下取 min），夹空则早退`（纯函数，8 个边界）、
`★0x20B（源码棘轮）：fillSlotRect 必须走 clampFillRect，不得把 x/y/w/h 原样交给 canvas`。

### ④ P2 `0x23f` / missing-consumer —— "有对象的槽"要有尺寸可查（**renderer 半边**）

**引擎体**：`0x23F` = `sub_4307B0`（raw 40019-40030）：
```c
v2 = _this[sub_41BF50(_this, 2) + 94672];      // ★对象表（字节 +378688）
if ( !v2 ) return sub_42B4B0(_this, 1, -1);    // 没有对象 ⇒ op1 = −1
v3 = sub_4080B0(v2) * dbl_51FB50;              // 有对象 ⇒ 尺寸 ×1000（raw 40028-40029）
```
`sub_4080B0`（raw 12960-12979）按 `node[+1084]` 分派：`== dword_52839C`（= **0**，raw 4867）⇒
`(**(node+1044)+40)(node+1044, &v3)`；`== dword_5283A0`（= **1**，raw 4868）⇒ `(**(node+1080)+68)(…)`；
**都不是 ⇒ 返回 `0.0`**（⇒ ×1000 = 0，**不是** −1）。对象由 `0x20F`（`sub_4237B0` raw 31627-31644：`if (!_this[4*v2+378688]) new(0x480)+sub_489040`）与
`0x236`（`sub_4246B0` raw 32245-32264，同一张表）**惰性创建**；`0x1F8`/`0x1F9`/`0x1FA` 把它置 0
（raw 31171-31183 / 31211-31221 / 31255-31265）。
★`0x208` 读的是**另一张表**（表面表 `Scene + 4*slot + 42456`，`sub_49ED60` raw 119786-119795）——
两张表不许混（这正是审计 0x23f 条 `host-invented` 那一半）。

**改了什么（renderer 半边，两个宿主同判据）**
- `slotSurface.ts`：`SlotNode {kind,id,mode}` + `slotNodeSizeOf(node, surface)`（三态：无对象 ⇒
  `present:false`；有对象 + 有表面 ⇒ 该表面尺寸；有对象、尺寸不可得 ⇒ `0`）。
- `TextureCache`：`#slotNodes` + `noteSlotNode(slot,kind,id,mode)`（返回 **是否新建**，= 引擎
  `if (!obj)` 那条门）/ `slotNodeOf` / `clearSlotNode` / **`slotNodeSize(slot)`**；`release()` 一并清。
- `PixiBackend.playMovie`：不再只 `#pushLog` —— 建/复用该槽对象（日志区分"新建/复用"）；
  `PixiBackend.slotNodeSize(slot)` 公开成查询缝。
- `HeadlessScene`：新增 `slotNodes` / `playMovie` / `slotNodeSize`（旧实现**连方法都没有** ⇒
  `native.playMovie` 的缺口只落进 DropRecorder）。
- 三个销毁点接上：`createTexture`(0x1F8) / `bindTexture`(0x1F9) / `releaseTexture`(0x1FA)
  ⇒ 与引擎"先把 `Engine[slot+94672]` 置 0"同序（raw 31171-31183 / 31211-31221 / 31255-31265）。

**★为什么"对象的尺寸"取该槽的表面尺寸**：引擎那条链要 `obj[+1044]` 的子对象（影片的目标表面），
而**唯一语料现场**是同槽：`src/FIELD.txt:13718-13721` = `create-texture 2a 78 78 0` → `i236 …` →
`i23f (local-int 80e8) 2a`（120×120 正方形）。所以 `slotNodeSizeOf` 在"有对象"时优先答该槽的
**create-texture 表面**尺寸，拿不到 ⇒ 0（与 `sub_4080B0` 未分派类型的 `0.0` 同码）。这是**披露的近似**，
不是"已复刻"。

**未做（VM 半边，交 owner，见 §5）**：`op_get_slot_size` 现在只信 `Engine.texSizes`
（`0x1F8` 记的**表面**尺寸），没有读对象表 ⇒ 上面两条分支（`present` 决定 −1 vs 尺寸×1000）
在 emulator 侧还没有接线。`test/op-23f-slot-size.test.ts` 现在钉的是"create-texture 无对象也答 120000"
（与引擎相反的那条 `host-invented`），改判时**必须一起 retarget**。

**守卫**：`★0x23F：有对象的槽可查尺寸；无对象 ⇒ present=false（引擎写 −1）`、
`★0x23F：0x1F8/0x1F9/0x1FA 都销毁该槽对象（raw 31211-31221 / 31245-31269 / 32245 一族）`、
`★0x23F：PixiBackend.playMovie 不再只是 pushLog —— 真的有 per-slot 对象状态`。

### ⑤ P3 `0x1fa` / missing-operand-io —— 释放要把宿主侧尺寸缓存一起撤

**引擎体**：`0x1FA` = `sub_422E00`（raw 31245-31268）→ ① 析构该槽 movie 对象（raw 31255-31265）、
② `sub_49E980`（raw 119586-119603，**门内**）：`_this[5*a2 + 466] = -1`（raw 119594）+ 析构
`_this[a2 + 10614]`（raw 119595-119600）。⇒ 释放后 `0x208` 必答 `0×0`（表项为 0，raw 119786-119795）。

**改了什么**
- `HeadlessScene.releaseTexture`：补 `slotSize.delete(slot)`（审计点名的 `headlessScene.ts:258-261`）
  与 `slotNodes.delete(slot)`。
- `TextureCache.release`：`#slotImgid.delete(slot)`（= `Scene[5*slot+466] = -1`）+ 撤表面尺寸/类/
  子纹理表/槽对象。
  ★**这里订正了审计对 Pixi 侧的判断**：审计写"PixiBackend 侧同族…`size()` 会先查 `#canvasSlots`、
  再退回 `#slotImgid` 自愈 ⇒ 行为与引擎一致"。**不成立**：`release()` 不删 `#slotImgid`，
  `size()` 于是走 `#healSlot` 用**旧 imgid** 答出**旧尺寸**（引擎此时必答 0×0）。
  反证守卫：`★0x1FA：Pixi 侧同族 —— 释放必须撤掉槽→imgid 记录`（红：`273 !== undefined`）。
  这一条与 VM 侧 `0x1fa` 的 `missing[]` #2（"从不清 `Engine.texSlots`"）是**同一个引擎事实在
  渲染侧的那一份**，两处都要撤才对得上。

**守卫**：`★0x1FA：释放把 headless 的尺寸缓存一起撤（引擎销毁 CTexture ⇒ 0x208 答 0×0）`、
`★0x1FA：Pixi 侧同族 —— 释放必须撤掉槽→imgid 记录（否则 size() 会靠自愈答出旧尺寸）`。

**★前提被取代的既有断言（最小 retarget，未删断言）**：
`test/texture-slot-resolve.test.ts` 原断言"release：解除槽的纹理（**保留 imgid 绑定**，与引擎
release-texture 同口径）"+ `assert.equal(cache.imgidOf(5), 0x88, 'release 只解纹理，不改写绑定记录')`
—— 那条"同口径"的说法与体相反（raw 119594 就是写 −1）。已 retarget 为
"release：解除槽的纹理**并把槽记录写 −1**" + `assert.equal(cache.imgidOf(5), undefined, …)`，
保留全部锚点与强度（`slotCount` 归零那条不动）。**未删任何断言**。

### ⑥ P2 `0x1ab` / missing-branch —— 删的是**真实存档目录**里那一份

**引擎体**：`sub_42DFC0`（raw 38462-38483）：
```c
sub_408A40(_this, ArgList, 0x100u);                          // 真实存档目录
v2 = sub_41BF50(_this, 2);
sub_408050(FileName, 256, "%s\\SAVE%2.2d.DAT", ArgList, v2); // raw 38474-38475
v4 = !DeleteFileA(FileName);                                 // raw 38477：删成功 ⇒ 0
v5 = sub_41BF50(_this, 2);
sub_408050(FileName, 256, "%s\\SAVE%2.2d.STH", ArgList, v5);
if ( !DeleteFileA(FileName) ) v4 = 2;                        // raw 38480-38481：`.STH` 失败盖成 2
return sub_42B4B0(_this, 1, v4);
```
（`sub_41BF50(_this, 2)` 在体里读了两次同一个操作数 —— 与 `save-slot.ts:740` 的三态映射
`r.dat ? (r.sth ? 0 : 2) : 1` 同构，审计已核。）

**改了什么**：`NodeFileSource.deleteSaveSlot` → 新的 `#removeSlotFile(rel)`：**overlay 与 base 两侧都试**，
`true` = 至少删掉一份（= `DeleteFileA` 的"存在且删成功"口径；两侧都不存在 ⇒ false ⇒ `op1 = 1`，
与引擎同）。**base 那一份先隔离**到 `<overlay>/SAVE/.deleted/<原名>` 再 unlink：本次删除报失败
（不静默丢字节）的条件是隔离副本写不出来。
★**安全规则的边界（写清楚，别让后人以为破了 T-0018）**：`T-0018` 的"真存档一个字节都不动"是
**写**路径的规则 —— `writeSaveSlot`/`writeSlotThumb`/`writeSaveData`/`saveConfig` 仍然只写 overlay
（守卫最后一个用例逐字节核了这条）。删槽是玩家显式动作，且引擎删的就是真实目录那一份；不删 base
的后果是"只存在于 base 的槽删不掉（返回码 1 对引擎的 0）+ 删掉自己那份会让基座旧槽复活"。
**这是本票唯一一处需要 owner 知情的策略面**：如果 owner 决定"绝不碰 base"，等价的替代实现是
**墓碑**（在 overlay 写一个 `<rel>.$$deleted` 标记 + 读路径认它），可观察行为相同、base 永远不动；
本轮选了"引擎原样 + 隔离副本"，因为墓碑是本工程**新造**的机制（会被下一次审计归为 host-invented）。

**守卫**（`test/save-delete-slots.test.ts`）
`★0x1AB：只存在于 base（overlay 缺失）的槽 —— .DAT 删得掉、.STH 不在 ⇒ 返回 2（引擎同码）`、
`★0x1AB：两侧都有 ⇒ 两侧都删（引擎只有一个真实目录 ⇒ 读到的"那一份"必须真的消失）`、
`★0x1AB：两侧都没有 ⇒ 两个 false（引擎 !DeleteFileA ⇒ 1）`、
`★0x1AB：base 的那一份**先隔离**再删（SAVE/.deleted/，字节不丢 —— T-0018 的"真存档不损坏"）`、
`★写路径（0x19E/0x1AE/SAVE.DAT/INI）仍然不碰 base —— 只有删槽会碰它`。

**★前提被取代的既有断言（最小 retarget，未删断言）**：`test/save-slot.test.ts` 原注释
"删槽只删 overlay（base 那份仍在 ⇒ 引擎语义下"删了又继承回来"是正常的）" +
`assert.ok(fs.existsSync(baseTarget), 'base 那份不动')` ⇒ 已 retarget 成
`assert.ok(!fs.existsSync(baseTarget), '★base 那份同样被删（引擎语义：删的就是真实目录里那一份）')`，
该文件其余断言（含"写盘只写 overlay、真存档槽字节不变"）**一字未动**。

### ⑦ P2 `0x19E` / host-invented —— 缺 overlay 时**不许静默**

**引擎体**：`sub_42D980`（raw 38287-38331）：`CreateFileA(FileName, 0x80000000, …)` 只读探一下
（raw 38306-38316）⇒ 再 `CreateFileA(FileName, 0x40000000, …)`（GENERIC_WRITE，raw 38317）；
拿不到句柄 ⇒ `sub_40A4C0(…, aE, 5)`（错误串「セーブデータの保存に失敗しました。」）+ `op1 = 1`
（raw 38320-38321）。成功 ⇒ `sub_40CD10(...)` 的结果码。

**改了什么**：`NodeFileSource.writeSaveSlot` 在 `#overlay` 为 null 时**抛**（消息含"没有配置
系统存档目录"），由 `saveSlotFromEngine` 的 `catch` 落成非 0（当前是 **2**）。旧行为是
`if (!this.#overlay) return;` ⇒ 什么都没写却不报 ⇒ `0x19E` 返回 **0**（"已保存"）。
**残留口径差（如实登记）**：引擎那一格返回 **1**，emulator 返回 **2**（`saveSlotFromEngine` 的
catch 写死 2）；两者都非 0（脚本侧"失败"判据一致），但精确码不同 ⇒ 见 §4 的 `0x19E` 条目改写。

**守卫**：`★0x19E：宿主没配 system ⇒ writeSaveSlot 必须显式失败（旧行为静默 return，一个字节都没落盘）`、
`★0x19E：端到端 —— 无处可写时结果码必须非 0（引擎 raw 38317-38321 返回 1）`（后者直接跑
`saveSlotFromEngine`，红时实际值 = 0）。

---

## 2. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/src/renderer/slotSurface.ts` | **新增**：两宿主共享的纯模型（分块表 / 矩形夹取 / 槽对象与尺寸三态） |
| `app/amayui-emulator/src/renderer/pixi/textureCache.ts` | `tileSize`、`#surfaceSize`/`#slotClass`/`#slotTiles`/`#slotNodes`、`create` 记类与分块、`fillSlotRect` 夹取、`size()` 兜底、`release()` 全撤、`surfaceClassOf`/`dividedTilesOf`/`noteSlotNode`/`slotNodeOf`/`clearSlotNode`/`slotNodeSize` |
| `app/amayui-emulator/src/renderer/pixiBackend.ts` | `playMovie` 建对象（不再只 pushLog）、`slotNodeSize` 缝、`createTexture`/`bindTexture`/`releaseTexture` 清该槽对象 |
| `app/amayui-emulator/src/renderer/headlessScene.ts` | `slotNodes`/`playMovie`/`slotNodeSize`、`releaseTexture` 撤 `slotSize` |
| `app/amayui-emulator/src/arch/nodeFileSource.ts` | `writeSaveSlot` 缺 overlay ⇒ 抛；`deleteSaveSlot` → `#removeSlotFile`（两侧都删 + base 先隔离）；`DELETED_DIR` 与文件头/段落注释同步 |
| `app/amayui-emulator/test/texture-renderer-gaps.test.ts` | **新增** 12 条守卫（①–⑤） |
| `app/amayui-emulator/test/save-delete-slots.test.ts` | **新增** 7 条守卫（⑥⑦ + 写路径棘轮） |
| `app/amayui-emulator/test/native-tap.test.ts` | **登记册同步**（T-0013 的守卫要求）：`DECLARED_HOST_DIVERGENCE` 去掉 `playMovie`（headless 已实现 ⇒ 差异收敛）、两份 `NON_BRIDGE` 加 `slotNodeSize` |
| `app/amayui-emulator/test/save-slot.test.ts` | **最小 retarget 2 处**（文件头 E2 那句"槽读写只碰 overlay" + 删槽断言，见 ⑥） |
| `app/amayui-emulator/test/texture-slot-resolve.test.ts` | **最小 retarget 1 处**（见 ⑤） |

**未动**：`src/vm/**`、`src/text/**`、`src/tools/**`、`analysis/*.json`、`tickets/T-0153/ticket.json`、
`tickets/T-0153/changes.md`、`tickets/T-0153/notes.md`、`test/recall-page-0x1d1.test.ts`、
`test/no-dead-writes.test.ts`、`test/opcode-gaps*.test.ts`、`test/text-*.test.ts`。

## 3. 命令与红→绿证据

```powershell
cd app/amayui-emulator
# ① 先写守卫、跑红（renderer 子集：模块尚不存在 ⇒ 12 条里 9 红 / 3 绿）
node --import tsx --test test/texture-renderer-gaps.test.ts
#   ✖ ★0x1F8 mode==3 …（浅红：slotSurface.js 不存在）
#   ……（纯函数落地后重跑：9 ✖ / 3 ✔，失败形状 =
#      tc.surfaceClassOf is not a function / tc.slotNodeSize is not a function /
#      h.playMovie is not a function / b.slotNodeSize is not a function /
#      源码棘轮 fillSlotRect 未走 clampFillRect /
#      slotSize 必须一起撤（true !== false）/ imgidOf(5) 273 !== undefined）

# ② 先写守卫、跑红（arch 子集：6 条真断言失败）
node --import tsx --test test/save-delete-slots.test.ts
#   ✖ ★0x1AB：只存在于 base … { dat: false, sth: false } vs { dat: true, sth: false }
#   ✖ ★0x1AB：两侧都有 ⇒ 两侧都删（base `.DAT` 也删：true !== false）
#   ✖ ★0x1AB：base 的那一份**先隔离**再删（隔离区文件不存在）
#   ✖ ★0x19E：宿主没配 system ⇒ 必须显式失败（Missing expected rejection）
#   ✖ ★0x19E：端到端 —— 无处可写时结果码必须非 0（actual 0）

# ③ 实现后绿
node --import tsx --test test/texture-renderer-gaps.test.ts test/save-delete-slots.test.ts
#   ℹ tests 19  pass 19  fail 0

# ④ 受影响既有套件（纹理族/宿主/存档/覆盖层）
node --import tsx --test test/texture-bind-race.test.ts test/texture-lifecycle.test.ts \
  test/texture-slot-resolve.test.ts test/texture-frame-barrier.test.ts \
  test/op-20b-fill-texture.test.ts test/op-23f-slot-size.test.ts test/native-tap.test.ts \
  test/no-boot-preload.test.ts test/frame-capture-seam.test.ts test/op-020c-render-target-capture.test.ts
#   ℹ tests 47  pass 47  fail 0
node --import tsx --test test/save-slot.test.ts test/save-slot-chain.test.ts test/save-slot-tdz.test.ts \
  test/save-slot-thumb.test.ts test/save-thumb.test.ts test/save-data.test.ts test/overlay.test.ts \
  test/host-service.test.ts test/host-instance.test.ts test/engine-slot.test.ts test/slot-load-screen.test.ts \
  test/slot-load-resume.test.ts test/slot-load-transfer.test.ts test/slot-save-resume.test.ts
#   ℹ tests 93  pass 90  fail 2  skipped 1
#   fail 2 = CONTEXT §6 的基线红（engine-slot SAVE70/71 storedDwords、save-slot 真槽 format）⇒ 无新增红

# ⑤ 类型/组织/死写/台账
npm run typecheck        # exit 0（tsconfig ×3）
npm run typecheck:test   # exit 0
npm run test:org         # ✅ 分类一致性：0 条问题（197 文件）
npm run check:dead-writes # ★ 无新增死写（基线 14 / 当前 14）
node --import tsx --test test/harness-convergence.test.ts test/no-dead-writes.test.ts \
  test/ticket-ledger.test.ts test/capability-ledger.test.ts test/script-ledger.test.ts \
  test/organization.test.ts test/native-tap.test.ts test/audit-report-completeness.test.ts
#   ℹ tests 44  pass 41  fail 3 —— 3 条红**全部来自并行 agent 的在飞改动**，与本次改动无关：
#     · harness-convergence「自造帧循环」→ recall-page-0x1d1.test.ts（T-0170，禁改文件）
#     · ticket-ledger「看板与真源同步」→ 缺 T-0170（等 owner 跑 build-tickets.mjs）
#     · （另一次运行里 check:dead-writes 曾报 Engine.recallRepaint，重跑已消失 ⇒ 并行竞态）

# ⑥ 全量
npm run test:all
#   ℹ tests 1309  pass 1298  fail 9  skipped 2
#   9 条红逐条归类（**没有一条落在我改的文件/守卫上**）：
#     · 基线 3（CONTEXT §6）：engine-slot SAVE70/71 storedDwords、save-slot 真槽 format、scene-report 可绘制项
#     · T-0020「自造帧循环」→ recall-page-0x1d1.test.ts（T-0170，禁改文件）
#     · ★0x1D1 必须落在 OPS → T-0170（opcode-gaps 处置未结算）
#     · ★0x10C ③ 位号越界 → 并行 agent 的 input/keyboard 改动
#     · config1-chain-advreturn-{real,seed} 「记录表条数 6 ≠ 3」→ 并行 agent 的 `src/vm/textItems.ts`(+279)、
#       `src/vm/handlers/msgwin.ts`(+145) 在飞：探针读的是 `e.textItems.records.length`
#       （`config1Chain.ts:888`），种子 3 条 + 链路新 push 的 3 条 = 6（我的改动不写这条路径）
#     · 死写 ratchet：那一次运行失败是并行竞态，单独重跑 7/7 绿
```

**`npm run test:all` 的实测（含 T1 档，2026-09-24 本轮）** = `tests 1309 / pass 1298 / fail 9 / skipped 2`；
9 条红里 3 条是 `CONTEXT.md` §6 的基线红，其余 6 条全部来自并行 agent 的在飞改动
（T-0170 的 `0x1D1`/`recall-page-0x1d1`、text 族的 `src/vm/textItems.ts`/`handlers/msgwin.ts` 记录表、
input 的 `0x10C`），**没有一条落在我改的文件或我新增的守卫上**。逐条归类见上方代码块。

## 4. 台账待应用（请主 agent 应用到 `analysis/opcode-gaps.json`）

> 工具/落地方式：直接改 `analysis/opcode-gaps.json`（唯一真源）→
> `node scripts/build-opcode-gaps.mjs` 重生成 `docs-new/03-engine/opcode-gaps.md` →
> `cd app/amayui-emulator && npx tsx --test test/opcode-gaps.test.ts`（棘轮）。
> 每条我给了**精确的字段与文本**；`counts` 由工具/脚本重算，不要手改。
> ★下面"删除"= 从该条目的 `missing[]` 里删掉那**一个对象**，不是删条目。

### 4.1 `opcode 504`（`i1f8` create-texture）— 删 1 条 `missing[]`

- **删除** `missing[]` 里 `raw: "122855-122872"` 的那一条（`what` 以 "mode == 3 时引擎建的是另一个类" 开头）。
- `note` 里 "仍缺 3 条分支/消费端/写者" → "仍缺 **2** 条分支/消费端/写者"（若该句是 T-0149 工具生成的
  固定话术，按工具的口径重跑即可）。
- 依据：`test/texture-renderer-gaps.test.ts` 的
  `★0x1F8 mode==3 ⇒ DividedTexture：分块表按 ceil(w/格子)×ceil(h/格子)，末行/末列按余数截断`
  （+ 同文件另外 3 条 `0x1F8` 守卫）。
- **保留**另两条（`raw 31171-31188`「先销毁该槽已有的对象」、`raw 122847-122848`「擦掉颜色记录与槽状态两格」）
  —— 它们描述的是 **VM 侧 `Engine[slot+94672]`/槽记录**，本轮只在**宿主侧**建了对象表（见 ④）。

### 4.2 `opcode 523`（`i20b` FillTexture）— 删 1 条 `missing[]` ⇒ 可改回 `implemented`

- **删除** `missing[]` 里 `raw: "124609-124634"` 的那一条（`what` 以 "sub_4A4C70 会先把矩形夹到" 开头）。
- `missing[]` 清空 ⇒ 按 `dispositions.partial` 的说明把 `disposition` 改回 **`implemented`**，
  `note` 追加一句：
  「★T-0153（renderer 子集）：`0x20B` 的夹取/空矩形早退已按体实现 —— `clampFillRect`（`sub_4A4C70`
  raw 124608-124634）+ `TextureCache.fillSlotRect` 接线；守卫 `test/texture-renderer-gaps.test.ts` 的
  `★0x20B：矩形夹到表面记录 [0,0,w,h]` 与 `★0x20B（源码棘轮）`。」
- 依据：`test/texture-renderer-gaps.test.ts#★0x20B`。

### 4.3 `opcode 414`（`i19e`）— **改写**（不是删除）`missing[]` 里 `raw: "38317-38322"` 且 `ticket: T-0153` 的那一条

原来的 `what`（"宿主 overlay 缺失时 NodeFileSource.writeSaveSlot 是静默 no-op…"）已不成立
（现在**抛**）。建议替换为：

```json
{
  "what": "宿主没有 system 目录时 writeSaveSlot 已改为**抛**（不再静默 no-op，见 T-0153 的 renderer/arch 子集），但结果码仍是 `saveSlotFromEngine` catch 里写死的 **2**，而引擎在写打开失败那一格是 `sub_42B4B0(_this, 1, 1)` ⇒ **1**（raw 38320-38321）",
  "ticket": "T-0159",
  "raw": "38317-38322"
}
```
（`ticket` 从 `T-0153` 改成 `T-0159`，因为剩下的只是精确码口径，属存档槽簇。）
- 依据：`test/save-delete-slots.test.ts` 的
  `★0x19E：宿主没配 system ⇒ writeSaveSlot 必须显式失败` 与 `★0x19E：端到端 —— 无处可写时结果码必须非 0`。

### 4.4 `opcode 427`（`i1ab`）— 删 1 条 `missing[]` ⇒ 可改回 `implemented`

- **删除** `missing[]` 里 `raw: "38476-38481"` 的那一条（`what` 以 "引擎的 DeleteFileA 作用于真实存档目录" 开头）。
- `missing[]` 清空 ⇒ `disposition` 改回 **`implemented`**，`note` 追加：
  「★T-0153（arch 子集）：删槽改为 **overlay ∪ base 两侧都删**（`#removeSlotFile`），base 那一份删前
  先隔离到 `<overlay>/SAVE/.deleted/`；`op1` 三态与体 `v4 = !DeleteFileA(DAT) ? 1/2` 同构。守卫
  `test/save-delete-slots.test.ts`（6 条）。★披露的保留偏差：隔离副本写不出来时该侧**不删**
  （宁可报失败也不静默丢字节）⇒ 那种环境下 emulator 返回 1、引擎返回 0。」
- 依据：`test/save-delete-slots.test.ts#★0x1AB`。

### 4.5 `opcode 506`（`i1fa`）— 删 1 条 `missing[]`

- **删除** `missing[]` 里 `raw: "119786-119795"` 的那一条（`what` 以 "宿主侧的**尺寸缓存**在释放时没有一起撤" 开头）。
- **改写**另一条 `raw: "31245-31269"`（`what` 以 "引擎先销毁该槽的 movie 播放器对象" 开头）：宿主侧
  已经建了这张对象表并在三个销毁点清它，剩下的是 `0x236` 的 handler 未注册：

```json
{
  "what": "宿主侧的 per-slot movie 对象已建模（T-0153 的 renderer 子集：`TextureCache.noteSlotNode` / `HeadlessScene.slotNodes`，且 `0x1F8`/`0x1F9`/`0x1FA` 都清它，raw 31171-31183 / 31211-31221 / 31255-31265）；仍缺 `0x236` 的 handler（`sub_4246B0` 未注册）⇒ 由 `0x236` 建的对象在 emulator 从不出现",
  "ticket": "T-0153",
  "raw": "31245-31269"
}
```
- **保留** `raw: "119585-119603"` 的两条（`0x216` 的槽记录 + `if (!_this[a2+11676])` 外层门）——
  ★但要在其 `what` 里点明：**渲染侧那一份已经撤**（`TextureCache.release` 现在 `#slotImgid.delete`），
  剩下的是 VM 的 `Engine.texSlots`：
  「（T-0153 renderer 子集已撤渲染侧那份：`TextureCache.release` 删 `#slotImgid`；本条剩 VM 侧 `Engine.texSlots`）」
- 依据：`test/texture-renderer-gaps.test.ts` 的两条 `★0x1FA` 守卫 + `test/texture-slot-resolve.test.ts` 的 retarget。

### 4.6 `opcode 575`（`i23f`）— **保留 2 条** `missing[]`，但改写 `raw: "31627-31644"` 那条

（VM 侧接线未做 ⇒ **不许**改成 `implemented`。）

```json
{
  "what": "对象表已在**宿主侧**建好（T-0153 的 renderer 子集：`PixiBackend.playMovie` → `TextureCache.noteSlotNode`、`HeadlessScene.playMovie`，并新增查询缝 `slotNodeSize(slot)`（两宿主同判据，`test/native-tap.test.ts` 已登记））；**仍缺 VM 侧接线** —— `op_get_slot_size` 只信 `Engine.texSizes`（`0x1F8` 记的**表面**尺寸），没有读对象表 ⇒ 「无对象 ⇒ −1 / 有对象 ⇒ 尺寸×1000」这两条分支在 emulator 还没有落点",
  "ticket": "T-0153",
  "raw": "31627-31644"
}
```
- **保留** `raw: "40018-40032"` 那条（`host-invented`：两张表混用）不动。
- ★**协调警告**（给 owner）：`test/op-23f-slot-size.test.ts` 现在钉的是"`create-texture` 后即使没有
  对象也答 `120000`"（= 引擎会答 −1 的那条反例）。谁动 `op_get_slot_size`，**必须同时** retarget
  那个测试（按仓库纪律：最小 retarget，不许删断言）。

### 4.7 `opcode 520`（`i208`）— **新增条目**（当前 `analysis/opcode-gaps.json` 里**没有** `0x208`；

我在 §2 的搜索方式是 `$j.entries | ? opcode -eq 520` ⇒ 无命中）

```json
{
  "opcode": 520,
  "mnemonic": "i208",
  "name": "",
  "handler": "sub_4302E0",
  "handlerBodyLine": 39865,
  "argc": 3,
  "docStatus": "已核对",
  "source": "audit-partial",
  "disposition": "partial",
  "ticket": "T-0153",
  "note": "纹理尺寸 getter（写回 op2/op3）：`sub_4302E0`（raw 39865-39878）→ `sub_49ED60`（raw 119773-119798）读该槽 `CTexture+1040/+1044`；越界/表项为 0 ⇒ 0/0。引擎的 `set-texture` 是**同步**读+解码（`sub_422CB0` raw 31192-31243 → `sub_4559C0`）⇒ 同批指令里立刻可读（= 同帧真宽高）。\n\n★T-0153（renderer 子集）：**有意保留的近似** —— 本工程走 IPC 异步载入，同一批 `bind` + `0x208` 只能答 0×0，到货/帧屏障之后才是真值（`tickets/T-0102` 已查过这条链）。扩展点两条（都在本子集之外）：① `NativeBridge.bindTexture` 改成可 await 并在 `op_set_texture` 里 await（= 引擎的同步装载语义，动 `src/vm/**`）；② 主进程提供**同步** `imgid → {w,h}` 缝（`.c` 侧已有 `NodeFileSource.readHeaderSync` + `agfSizeOf`，缺 preload 的 sendSync 通道）。重新评估条件：出现「同批 set-texture 后立刻 0x208」的真语料用法，或上面任一条缝落地。守卫 `test/texture-renderer-gaps.test.ts` 的 `★0x208 已知近似（T-0153 登记项）`。",
  "missing": [
    {
      "what": "近似：图像经 IPC 异步到货，同一批指令里的 0x208 只能答 0×0（引擎此时已是真宽高）；唯一自愈是脚本再发一次 set-texture 或帧屏障之后",
      "ticket": "T-0153",
      "raw": "39865-39878"
    }
  ]
}
```
- 落地后重跑 `node scripts/build-opcode-gaps.mjs` + `npx tsx --test test/opcode-gaps.test.ts`。

### 4.8 不应用（但 owner 应知情）

- **`analysis/engine-capabilities.json`**：本次 7 条**都不属于"引擎常态能力"**（都是逐 opcode 的
  分支/消费端），故**不新增能力条目**。若 owner 认为"两套 CTexture 类（Normal/Divided）+ `dword_55052C`
  分块"值得作为**资源生命周期/渲染常态**记一条，建议 id `texture-surface-classes`（subsystem `资源`/
  `渲染`），`engine.fns = sub_4A2C10, sub_43A5C0, sub_43A740, sub_4252E0`、`engine.raw = 122837-122893`、
  `emulator.status = partial`、`guard = test/texture-renderer-gaps.test.ts`、`whySilent` = "mode 3 语料
  0 处；缺它不报错，只表现为『分块纹理』这一口径不存在"。**我未擅自新增**（那是 owner 的台账）。
- **`docs-new/03-engine/opcode-table.md`** 的 `0x23F` 行现在写着"emulator：`op_get_slot_size`（`Engine.texSizes`…）"
  —— 该行等 §4.6 落地后应补一句"宿主侧对象表见 `slotNodeSize`"。**我未改**（生成物 + 不属本子集）。

## 5. 未做 / 受阻 / 需要别的 owner 接手的

1. **④ 的 VM 半边**（`op_get_slot_size` 读对象表）：`src/vm/**` 属另一位 owner。我已把宿主侧的
   缝备好（`PixiBackend.slotNodeSize` / `HeadlessScene.slotNodeSize`，两宿主同判据，`test/native-tap.test.ts`
   已按 T-0013 的登记册规则补 `NON_BRIDGE`）。接线建议：
   `op_get_slot_size` 改为 `const n = c.native.slotNodeSize?.(slot)` ⇒ `!n || !n.present ? -1 : Math.trunc(n.w*1000)`，
   并把 `slotNodeSize?(slot): {present,w,h}` 声明进 `NativeBridge`（`src/vm/native.ts`）。
   ★连带：`test/op-23f-slot-size.test.ts` 需要最小 retarget（见 §4.6）。
2. **② 的两条同步缝**（await-able `bindTexture` / preload `sendSync`）：不在本子集，已登记 + 写清扩展点与重评条件。
3. **① 的"装载路径也建 DividedTexture"**（`sub_49E9D0` raw 119738-119760，`0x249` 传 `a6 = 1`）：
   宿主缝（`NativeBridge.bindTexture`）没有"类/flag"参数 ⇒ 未建模；`0x249` 语料 20 处，是否可观测需 owner 判。
4. **Pixi 侧"多张子画布"**：DividedTexture 的像素级分块未实现（语料 mode 3 = 0 处；引擎的
   填色/绘制都走 vtable 通用口 ⇒ 宿主侧一张画布等价）。若将来出现 mode 3 的真语料用法，需按
   `sub_43A740` 的格子表建 `ceil(w/256)×ceil(h/256)` 张子画布。
5. **`0x248 → 宿主 tileSize` 的接线**：VM 侧 `op_set_render_cfg_248` 只写 `engineValues['-248']`，
   没有到宿主的缝 ⇒ `TextureCache.tileSize` 目前恒 256（引擎初始值）。要接需在 VM 里加一条
   `native.setRenderConfig?.(v)`（或在 `PixiBackend` 装配处读 `-248`）。**未做**（`src/vm/**` 范围外）。
   `0x248` 语料量未测（本轮未扫）—— 若要判"可不可观测"，先扫 `i248` 的语料。
6. **`0x236` 未注册**（`analysis/opcode-gaps.json` 里 `deferred`，ticket `T-0076`）：由它建的
   对象在 emulator 仍不出现；宿主侧的入口是 `TextureCache.noteSlotNode(slot,'node',…)`（现成）。
7. **并行 agent 的红（与我无关，交回时实测仍在）**：
   - `test/harness-convergence.test.ts`「自造帧循环」红：`recall-page-0x1d1.test.ts`（T-0170，禁改文件）；
   - `test/ticket-ledger.test.ts`「看板与真源同步」红：缺 `T-0170`（等 owner 跑 `node scripts/build-tickets.mjs`）；
   - `test/config1-chain-advreturn-{real,seed}.test.ts`「记录表条数 6 ≠ 3」：并行 agent 的
     `src/vm/textItems.ts`(+279)/`handlers/msgwin.ts`(+145) 在飞（探针读 `e.textItems.records.length`，
     `config1Chain.ts:888`；种子 3 + 链路新 push 的 3）；
   - `★0x10C ③`（input/keyboard，另一位）、`★0x1D1 必须落在 OPS`（T-0170）、
     `npm run test` 里的 `★真进程 --idle-sec 1`（缺 `dist/web` 产物，环境）；
   - `npm run check:dead-writes` 曾在一次运行里报 `Engine.recallRepaint`（`src/vm/handlers/msgwin.ts`，
     T-0170 在飞），重跑消失 ⇒ 并行竞态；我改完后为 **基线 14 / 当前 14 / 无新增**，
     `test/no-dead-writes.test.ts` 单独重跑 7/7 绿。

## 2026-09-24

## 主 agent 复核补充（2026-09-24）：⑥ 的结果码优先级分歧（已修）

读体复核 ⑥（`0x1AB`）时发现一处**结果码优先级**分歧 —— **实现与守卫同错**，所以 A6 的红→绿自证是自洽的，只有回到体才看得出来：

- 引擎（`sub_42DFC0` raw **38463-38483**）：`v4 = !DeleteFileA(.DAT)` ⇒ 1，**随后** `if ( !DeleteFileA(.STH) ) v4 = 2;`
  ⇒ **`.STH` 的失败码覆盖 `.DAT` 的** ⇒ **两份都失败时返回 2**（不是 1）。
- emulator 实现与守卫都写成 `r.dat ? (r.sth ? 0 : 2) : 1` ⇒ 那一格给 **1**。
- ★**同型错误也在 `0x1AC`**（`sub_42E0A0` raw **38505-38511**：`v5 = !CopyFileA(.DAT)` → `if (!CopyFileA(.STH)) v5 = 2`）。

修：
- `src/vm/handlers/save-slot.ts`：`op_slot_delete` / `op_slot_copy` 都改成 `r.sth ? (r.dat ? 0 : 1) : 2`，并把**覆盖顺序**写进各自的文档注释；
- `test/save-delete-slots.test.ts`：`op1Of` 同步改成同一表达式（并把"旧映射那一格给 1、与体不符"写进注释）；"两侧都没有 ⇒ 两个 false"那条断言由 **1 改成 2**（消息附体证据 raw 38477-38481）。
- 验证：`node --import tsx --test test/save-delete-slots.test.ts` → **tests 7 / pass 7 / fail 0**。
