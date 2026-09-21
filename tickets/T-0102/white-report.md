# T-0102 白底取证报告（ANALYSIS-ONLY，`tickets/T-0102` acceptance 第 2 条）

作者：ANALYSIS-ONLY 子代理。未写任何产品代码/台账；中间产物只在 `.tmp/t0102w/`。
标记约定：**【实测/读码确认】**= 我打开过那一行或跑过那个探针；**【文档/票据说的】**= 引自文档或票据、我未独立复核；**【我没读到】**= 缺口，单列在 §6。

---

## 0. 一句话结论

1. **分支判死**：`global 708ada`（池下标 7,375,578）**在全宇宙没有任何写点**（脚本 0 处、引擎 0 处），池初始化成 0 ⇒ 它恒为 0 ⇒ 按 `op_jcc` 语义**永远走 `label_00003a88` 那一支（= `create-texture 48` + `i20b` 填 50% 灰）**。handoff/票据里那句「`708ada == -1` ⇒ 走 `label_00003a88`」**是错的**（−1 ≠ 0 时应当**落下句**走 `set-texture` 那一支；而且它根本不可能是 −1）。
   ⇒ **槽 48 那条"半透明黑底"在正常剧情里根本走不到**（它还额外被 `4fd9 != 0 && 708ad6 != 0` 两道门挡着，而 `708ad6 = 1` 全语料唯一写点是 `src/TITLE.txt:462` 的 **DEBUG 菜单**）⇒ 「白底 = 分支选错」这条线**可以判死**。
2. **白底的真正形状**：模拟器里「**纹理槽没有可用纹理的 `draw-texture` 项**」会被画成**纯白矩形**（尺寸 = 该项的源矩形）——`tickets/T-0102/changes.md` 甲-4 说的「占位块按 layer 派生绿调 tint、不是纯白」**是错的**：那个 tint 在下一行就被 diffuse 色覆盖成白色（`presenter.ts:479` → `:427`，`Item.from` 默认 `0xFFFFFFFF`）。
3. **「开合侧边栏之后才对」的机制（已实测复现）**：**正确路径比错误路径多做的唯一一件事 = 把同一条 `set-texture` 又发了一次**。第二次 `bind` 命中已缓存的图像 ⇒ `slotTex` **同步**落盘 ⇒ 紧随其后的 `i208`（尺寸 getter）与 `draw-texture`（取纹理）当帧就正确；第一次是**异步**的 ⇒ `i208` 读 **0×0**、`draw-texture` 取不到纹理（画成纯白）。引擎里 `set-texture` 本来就是同步的，所以引擎第一次就对。
   ★这条路径**已经有半个修复**：`renderer/app/session.ts:588-591` 的「`0x1F9` 之后的同步屏障」（2026-09 为「进 SN0000 全黑」加的）。**但仍有四个洞**（§4），本次白底最可能落在其中之一。

---

## 1. 甲、分支判死（acceptance Q1 + 订正）

### 1.1 `jcc` 语义（自己核过，不是转述）

**【实测/读码确认】**
- `docs-new/03-engine/opcode-table.md:149`（0xA0 行）：`op1≠0`→跳 `op2`（`op2==0xFFFFFFFF` 则落下句）；`op1==0`→跳 `op3`（同样 `-1` 落下句）。
- `app/amayui-emulator/src/vm/handlers/control.ts:65-89`（`op_jcc`）：`if (cond !== 0) { t = branchLab(2) ... } else { t = branchLab(3) ... }`，`branchLab` 把 `-1` 折成"不跳"（`:68-71`）。**与文档一致**。
- 独立佐证（不是同一份真源）：`docs-new/03-engine/opcode-table.md:244`（0x140 行）自己用同一套骨架解释语料：`jcc 1 ffffffff L` = 恒真落下一句、`jcc <imm> ffffffff <label>` = 编译器 if/else 骨架。我也在字节层核过：`raw-parts/DATA1/NOVEL.BIN` 0x338 处 `a0 00 00 00 | 03 00 00 00 | da 8a 70 00 | 00 00 00 00 | ff ff ff ff | 00 00 00 00 | d7 00 00 00` ⇒ op1 = `(global-int 708ada)`、op2 = 立即数 `0xFFFFFFFF`、op3 = 立即数 `0xD7`（被反汇编器渲染成 `label_00003a88`）。

### 1.2 包装的两支（`src/NOVEL.txt:42-55`、`src/SC0000.txt:1034-1047`，全库同型）

```
42  sub (local-int 0) 30d40 18a88
43  detach-texture 18a88 (local-int 0)      ← 删 DrawItem/Mesh 区间 [0x18a88,0x30d40)
44  jcc (global-int 708ad6) ffffffff label_0000043c   ← 708ad6==0 ⇒ 跳过整块
45  jcc (global-int 708ada) ffffffff label_00000398   ← 708ada==0 ⇒ 跳 label_00000398
46  sub (local-int 0) 0 1
47  set-texture (global-int 708ada) 48 (local-int 0)   ← 【分支 A】用已登记的 imgid
48  jmp label_000003f8
50  label_00000398
51  create-texture 48 500 2d0 0
52  i20b 48 0 0 500 2d0 ff 808080                      ← 【分支 B】建 1280×720 并填 #808080
54  label_000003f8
55  draw-texture 186a0 48 0 0 500 2d0 0 0
```

⇒ **分支 A**（`708ada != 0`，含 −1）：绑定该 imgid 到槽 48；
⇒ **分支 B**（`708ada == 0`）：`create-texture 48` + 填灰；
**handoff 的订正**：`708ada == -1` **不是**走 `label_00003a88`（那是 `== 0` 才走）；−1 会落下句走**分支 A**。原文两处错：(a) 判据反了；(b) 值也不可能是 −1（见下）。

### 1.3 `708ada` 在引擎里有没有写点（**答：没有**）

**【实测/读码确认】**
1. 它的下标在池内、而且就在池顶：`engine/…_utf8.c:22015` `ReadFile(FileA, _this + 698904, 0x12Cu)` 把索引文件头读进 `Engine+0xAAA18`；`raw 22259-22263` 把头的 **@276**（= `_this+699180` = 0xAAA18+276）写进 `Engine[382952]`（= `pool_int_count`，`fields.json:25`）。我直接量了原始索引文件：`raw/SYS4INI.BIN` @276 = **7,375,580 = 0x708ADC**（`install/SYS4INI.BIN` 同值）⇒ `0x708ada = count − 2`、`0x708ad6 = count − 6`，**都是合法池下标**。
2. 池初值 = 0：`raw 22278-22289` 用 `rand()%0x10000` 的 slack 在固定基址 `(rand()%30+48)<<24` 上 `VirtualAlloc(4*(slack+count)+4)`，`raw 22328-22329` 把 `count+slack+1` 项全部写成 `_this[388240]`（= `Engine[97060]` = `ENC(0)`；`raw 24240` 的 `key == ROL4(97060,11)` 校验证明它就是 enc_zero）。
3. 取值口径：`readIntOperand`（`sub_41BF50`，raw 26555）case 3 = `_this[95744] + 4 * *(_DWORD *)v2`（raw **26602-26603**）；`operandAddress`（`sub_42AEA0`，raw 36756）case 3 = `pool_int + 4*idx`（raw **36797-36798**）⇒ 操作数 dword **就是线性下标**（写侧同）。
4. **写点枚举**：全反编译里写 `pool_int` 的只有三类 —— ① 槽装载 `raw 19435/19453/19490`（顺序 `k++`）、`19583` memset、`19624` memcpy（都只覆盖 `0..count`）；② 操作数驱动的写（`raw 36850` / `37106` 用 `dword_55D528` / `dword_55D534` = 当条指令的操作数地址）；③ 初始化（`22328-22329`）。**没有任何固定下标 = 0x708ada 的写点**（`grep -n 708ada engine/*.c engine/*.lst` = 0 命中；`.lst` 里连 `+0AAB2Ch` 这种位移也只在 `sub_414AC0` 里被读一次：`.lst:34822`）。
5. **脚本侧**：`grep -rh "708ada" src/*.txt` 去重后只有两条形态 —— `set-texture (global-int 708ada) 48 …` ×182、`jcc (global-int 708ada) …` ×180，**0 个写点**。对照：`708ad6` 有 `mov … 0` ×181（就是各场景脚本调试入口的 `1019` 行）、`sub … 0 1` ×3、`mov … 1` ×1 = `src/TITLE.txt:462`（DEBUG 菜单）。

⇒ **结论：`708ada` 恒为 0 ⇒ 引擎与模拟器都只能走分支 B。**「白底 = 走了 `set-texture` 那一支」不成立；票据 甲-1/甲-3 的落点（槽 48）**与用户症状无关**。

### 1.4 顺手订正甲-1：槽 48 那块是 **DEBUG 场景试跑**的底板，不是正常 ADV 背景

**【实测/读码确认】**
- 槽 48 那一块外面还套着两道门：`4fd9 != 0`（`src/NOVEL.txt:41 jcc (global-int 4fd9) ffffffff label_00000448` ⇒ `4fd9 == 0` 时走**另一条**全屏 mesh 分支）**且** `708ad6 != 0`（`:44`）。
- 写这两个值的是同一段：`src/TITLE.txt:462 mov (global-int 708ad6) 1` + `:464 mov (global-int 4fd9) (global-int f8c52)` + `:466 i140 …`（选一个 `SC????.BIN` 试跑）—— `docs-new/03-engine/opcode-table.md:244` 已把这条路径定为「DEBUG 菜单 … 正常剧情零影响」（我独立复核了 `708ad6` 的写点枚举，与它一致）。
- 正常剧情（`4fd9 == 0`）走的是 `src/NOVEL.txt:60-78`：`create-mesh 19258`（满屏四边形，基色 = `f8c48/f8c4c` = 全白）+ `set-vertex-color 19258 0 ff 0`（黑）+ `4fd1..4fd5`；或者（`global 0 == 6`）ADV **窗口**用 `draw-texture 19640 11 0 0 43e 95 5d 22c`（槽 **0x11 = 17**，源 1086×149，目标 (93,556)）+ `set-draw-color-alpha 19640 0 (global-int f807d) (global-int a9db)`（`src/SN0000.txt:3094-3098`、`src/SC0000.txt:32681-32685`）。
- 槽 17 那张窗口图是**开机一次性绑的**：`src/SYSTEM4.txt:118-123`（`set-texture 525e f` / `525f 10` / `5260 11`，`5260` = `SO001.AGF` 1280×1792，见 `.tmp/amayui-emulator.log:88` `image 5260 -> SO001.AGF`）。
- `global f807d` = ADV 窗口的**不透明度**（343 处 `set-vertex-color 19640 0 (global-int f807d) 0` 与 `set-draw-color-alpha 19640 0 (global-int f807d) (global-int a9db)`，值由配置 `a9df/a9e0/a9e1` 派生：343 处 `mov (global-int f807d) (global-int a9df|a9e0|a9e1)`）⇒ 用户看到的"半透明黑"就是这个 `alpha = f807d` 的窗口。

---

## 2. acceptance Q2：模拟器运行时读到的 `708ada` 是什么

**【读码确认（构造性证明）】**：`Engine.globals` 是稀疏 `Map`（`src/vm/engine.ts:129-138`），未写过的下标读成 **0**（`src/vm/ref.ts:67-69` `decIntSlot(key, undefined) = 0`，`src/vm/operand.ts:228-230` case `TYPE_GLOBAL_INT`）。全仓 `grep -rn 708ada src/` 只有注释（0 个写点）⇒ **读 0 ⇒ 走分支 B**（与引擎一致）。也就是说：**这个变量的值不是本票的变量**。

**【实测探针（做了，但没能直接看到那一帧）】** `.tmp/t0102w/probe-plate.mts`（`HeadlessScene` + `SC0000.BIN` 冷载 + `runFrameLoop`，非交付物）：
- `708ad6 = 0`（正常）：`scripts` 轨迹为空、0 个 draw item、0 次槽操作。原因读码可解释：`src/SC0000.txt:1002-1009` ⇒ `call label_000047c4`（章节派发器），`3f3c == 0` 时它只写 `mov (global-int 0) 6` / `mov (global-int 1394) 74` 然后 `ret`（`:1281-1294`），回到入口后 `exit` ⇒ **冷载 SC0000 根本不会画 ADV 窗口**（它是章节入口，不自己演戏）。
- `708ad6 = 1`（DEBUG 入口）：在 `i140`（0x140，**未实现**）上**死循环 17,999,907 次/900 帧** —— `onUnknown → 'continue'` 既不执行也不推进 ip。**副产品结论：0x140 未实现 + 不推进 ip = 活锁**（正常剧情走不到这条入口，`opcode-table.md:244` 的 `deferred` 判定不受影响；但任何要走 DEBUG 入口的探针/工具都会挂死）。
- 因此**我没有拿到"跑真链到 ADV 帧"的 dump**（要跑到得走 TITLE→GAMESTART→INTGAME→SN0000→…；见 §6 缺口 1）。但 §1.3 的构造性证明足够回答本问。

---

## 3. acceptance Q3（唯一判决点）：为什么开合侧边栏之后会变正确

### 3.1 侧边栏做的事 = **把同一条窗口例程再跑一遍**（不是另一条代码路径）

**【读码确认】** `src/SN0000.txt:198-237` 就是 ADV 侧边栏的状态分派：
```
198 label_00001078: i1f4 ; mov f7ffb 2 ; call label_0000b884 ; i1f5 ; ret      ← 开（各档 2..9）
209 label_000010b4: i1f4 ; mov f7ffb 0 ; call label_0000b884 ; i093 ; i1f5 ;
                    call-script 2d CHARMEDIT ; call label_00000320 ; ret       ← 关 + **重画页面**
230 label_00001138: i1f4 ; sub 139a 1 139a ; call label_0000b884 ; i1f5 ; i093 ; call label_00000320 ; ret
```
而 `label_0000b884`（`src/SN0000.txt:3075-3106`；`SC0000` 同型 `:32662-32684`）就是 **ADV 窗口/暗幕例程**：`detach-texture 19640 2` + `detach-texture 19834 19` → 读当前页 → `global 0 == 6 ? draw-texture 19640 11 … : create-mesh 19640 … + set-vertex-color 19640 0 (global f807d) 0`。
⇒ **两次经过的是同一段指令**，差别只可能在"两次执行之间，宿主侧/脚本侧的状态变了什么"。

### 3.2 差别在哪：`set-texture` 第二次是**同步命中**

语料里的固定习语：`set-texture <imgid> <槽>` 紧跟 `i208 <槽> <w> <h>`（**我实测统计：543 对 / 355 个脚本**），脚本按 `i208` 给出的宽高分支。SN0000 的那一处是 `:3146-3158`：
```
3146 set-texture (local-ptr 1) 2a (local-int 1)     ← 绑到槽 0x2a=42
3147 i208 2a (global-int f8020) (global-int f8021) ← 立刻问尺寸
3148 eq (local-int 0) (global-int f8020) 500
3149 eq (local-int 1) (global-int f8021) 2d0
3150 and … 3151 jcc … label_0000bf54               ← 满屏图 ⇒ 走 A 支；否则走 0×0 分支
3154 draw-texture 30d40 2a 0 0 (global f8020) (global f8021) (global f803b) (global f803c)
```
`0x208` 是**会写回脚本操作数**的 getter（`docs-new/03-engine/opcode-table.md:352`；`src/vm/handlers/gfx-texture.ts:36-42`），它的文档自己就写着「漏实现会让脚本拿到未初始化的宽高并引发**脚本层逻辑错误**」。

**我用真 `TextureCache` 实测了这条时序**（`.tmp/t0102w/probe-slot-size.mts`，只覆写 `decodeImage` 闸门，**不改产品代码**）：

```
【第一遍】bind 之后立刻 size(0x2a) = { w: 0, h: 0 }   （引擎该给真尺寸）
         draw-texture 时 resolve = { tex: '无纹理', imgid: '0x2b37' }
【载入落地后】size(0x2a) = { w: 1280, h: 720 }        （此时才正确，脚本早已按 0×0 分支走完）
【第二遍】bind 之后立刻 size(0x2a) = { w: 1280, h: 720 }（这次对了 ⇒ 画面正确）
         resolve = { tex: '有', imgid: '0x2b37' }
日志：bindTexture … → getTextureSize slot=42 → 0x0（纹理尚未载入…） → bindTexture … →   bind slot 42 <- imgid 0x2b37
```
⇒ **「正确路径比错误路径多做了什么」= 第二次 `set-texture` 命中了 `#imgCache`（`textureCache.ts:209-213` 的同步分支）⇒ `slotTex` 当帧可用。** 引擎里第一次就是同步的（`sub_422CB0` 当场读文件+解码，见 `textureCache.ts:119-127` 的说明），所以引擎没有这个"第一遍错"。

### 3.3 白是怎么画出来的（甲-4 的订正）

**【读码确认】**
- `presenter.ts:386-391`：`const { tex, imgid } = this.textures.resolve(it); const spr = tex ? cropSprite(tex, rect) : this.#placeholder(it);`
- `presenter.ts:474-481`：`#placeholder` = `new Sprite(this.unit)`，`this.unit = Texture.WHITE`（`pixi/appSetup.ts:47`）⇒ **1×1 白纹理**，尺寸 = `it.srcW/srcH`。
- **`presenter.ts:427`：`spr.tint = color & 0xffffff;`** —— 这一行**无条件覆盖**了 `:479` 按 layer 派生的绿调 tint；而 `color = itemColor(it, clock)` 对新建项恒为 `it.from` = **`0xffffffff`**（`renderer/drawitem/model.ts:285`，`eval.ts:110-127` 无窗时返回 `state0`/`from`）。
  ⇒ **未解析槽的项 = 纯白不透明矩形**，尺寸就是 `draw-texture` 给的源矩形。**甲-4 的「带绿调的块，不是纯白」不成立**。
- 旁证（E4 级）：`.tmp/l2dfix-15-load-next.png`（T-0083 修槽表**之前**的抓图）里正是这种"整块发白"的方格（我在 2560×1440 抓图上采样到 `(127,127,115)`、`(127,127,91)` 这类灰白像素，而修后的 `.tmp/itemrestore-15-load-next.png` 同点是 `(59,26,30)` 的实景）——**说明"槽没纹理 ⇒ 白块"就是本模拟器长期的白底形态**（那一批正是 T-0083 修的"图像槽表没装回"）。

### 3.4 为什么白会**驻留**（而不是下一帧自愈）

**【读码确认】**
- 常规 `TextureCache` **没有** `onReady → #markDirty`：只有 L2D 纹理库有（`pixiBackend.ts:247-254` 的 `() => b.#markDirty()`），而 `this.textures = new TextureCache((m) => this.#pushLog(m))`（`pixiBackend.ts:274`）只接了一个 log 回调。⇒ 迟到的图像**本身不会**触发重新合成。
- 产品帧档是"没变就不重画"：`frame/loop.ts:126` + `:383`（`present: 'needsRender'`）；ADV 等玩家推进时脚本不再执行指令，`advanceModel` 也不置脏。
- 唯一的补偿是帧末屏障 `session.ts:267 present: async () => { await this.#native.texturesIdle(); … }`（`pixiBackend.ts:371-379`：`pendingCount === 0` **早退且不置脏**；有在途才 `waitIdle` 后 `#markDirty()`）与 `0x1F9` 之后的同步屏障（`session.ts:405` → `:588-591`）。另外 `present()` 在"撤幕留帧"期间会**直接早退**（`pixiBackend.ts:1396-1401` `跳过本次 present`）。
⇒ **一旦那次载入错过了这两道屏障（或屏障超时/被世代判据丢弃），白帧就留在屏上**，直到任何一条会置脏的脚本指令被执行 —— 而玩家能做的第一件事就是**开/关侧边栏**（§3.1 会重跑整段 ⇒ 重新 `set-texture` ⇒ §3.2 的第二次同步命中 ⇒ 正确）。

### 3.5 可复现的最小序列（判据）

**【实测（探针 ② 就是这条序列的最小形态）】**
```
① set-texture X 42              # X 未缓存 ⇒ slotTex 无 42（bind 走异步分支 textureCache.ts:215-230）
② i208 42 → (0,0)               # 引擎给真尺寸；emulator 给 0（textureCache.ts:411-424，并触发 preloadImage）
③ draw-texture 30d40 42 …       # resolve(42) = {tex: undefined, imgid: X}（:639-644）⇒ 纯白占位块
④ 载入落地 ⇒ slotTex[42] = X    # 但脚本已按 0×0 走完分支，模型（源矩形/位置）不会自己重算
── 玩家做任何"重跑同一段"的操作（开合侧边栏 / 下一页）──
⑤ set-texture X 42              # #imgCache 命中 ⇒ slotTex **同步**落盘（:209-213）
⑥ i208 42 → 真尺寸；draw-texture 取到纹理 ⇒ 正确
```
**两次之间不同的状态 = `#imgCache` 里有没有那张图**（等价地：`slotTex` 是否当帧可用）。这是唯一在两次执行之间改变的东西。

---

## 4. 落地建议（**未改代码**）

### 4.1 根因判定（★诚实分级）

| 结论 | 强度 | 依据 |
|---|---|---|
| `708ada` 恒 0、恒走分支 B；handoff 的 `== -1` 说法错 | **确证** | §1.2–1.3（raw + 语料 + 字节层） |
| 甲的落点（槽 48 底板）不是正常 ADV 背景（它是 DEBUG 试跑路径） | **确证** | §1.4 |
| 未解析纹理槽的 `draw-texture` 项 = 纯白矩形 | **确证（读码）+ E4 旁证** | §3.3 |
| "第二遍对" 的机制 = 第二次 `set-texture` 同步命中缓存 | **确证（探针实测真 `TextureCache`）** | §3.2/§3.5 |
| 用户那一次白的是**哪一个槽/handle** | **未证** | §6 缺口 1 |

**这是模拟器实现缺陷**（引擎侧 `set-texture` 同步、`0x1F9` 后 `0x208`/`0x1FB` 必然一致；raw 31246/31192 与 `sub_49ED60` 同步读 `CTexture+1040/+1044`）。**引擎依据**：`opcode-table.md:339/352`（draw-texture/纹理尺寸 getter 的定义）+ `sub_422CB0` 同步装载（`textureCache.ts:119-127` 引用）。**模拟器依据**：上面四条代码点。
★所以它**不是**"引擎没做"的那类常态能力，而是**宿主异步化的时序在 4 个地方没有补平**。

### 4.2 四个洞（按嫌疑排序）+ 最小修法

| # | 洞（代码点） | 最小修法（一句话） | 可自动化守卫 |
|---|---|---|---|
| **H1** | `session.ts:405` 的同步屏障**只认 `0x1F9`**；`0x249`（`op_load_texture_by_id`，**20 处 / 8 个脚本**，同样走 `native.bindTexture`，`gfx-texture.ts:75-85` / `:237`）后没有屏障 | `renderer/app/session.ts` 的 `#awaitTextureBound`：`if (t.opcode !== 0x1f9 && t.opcode !== 0x249) return;` | `test/texture-bind-race.test.ts` 旁加一条：对 0x249 步也要 `await texturesIdle()`（可用假 host 记账） |
| **H2** | **`waitIdle` 有 500 ms 超时**（`textureCache.ts:131-144`），超时后 `size()` 仍 0×0、`resolve()` 仍无纹理，而脚本已经按错分支走过去 | 对"会写回操作数的 getter"（`0x208`）与 `0x1FB` 之前的屏障**不设超时**（或超时时**硬停/记错**，不许静默按 0 走） | `test/texture-frame-barrier.test.ts` 加"超时必须留痕且不得被当成真尺寸"的断言 |
| **H3** | T-0102 甲-3 的世代判据把"陈旧回写"变成"**该槽永远没有纹理**"：`resolve`（`:639-644`）与 `size`（`:411-424`）**只读 `slotTex`**，而 `#slotImgid`/`#imgCache` 都有 ⇒ 一旦丢弃就**没有自愈点**（唯一自愈是 `create()` 的"沿用已绑定 imgid"分支 `:252-256`） | `TextureCache.resolve/size` 在 `slotTex` 缺项但 `#imgCache` 命中时**同步补一次 `slotTex.set`**（等价于"下次绑定即命中"提前到本次读取） | `test/texture-bind-race.test.ts` 加一条：回写被丢弃后，`resolve(slot)` **仍须**给出纹理（或至少给出 imgid 与明确日志） |
| **H4** | 常规 `TextureCache` 没有到货回调 ⇒ 迟到纹理不置脏；`present: 'needsRender'` + 帧留（`pixiBackend.ts:787-826`/`:1391-1401`）⇒ 白帧驻留到"下一批指令" | 给 `TextureCache` 加 `onReady`（照抄 `pixiBackend.ts:247-254` 的 L2D 写法）并在那里 `#markDirty()` | `test/texture-frame-barrier.test.ts`：载入落地后 `needsRender()` 必须为真 |

**诊断缺口（建议同时补）**：`presenter.ts:389-391` 只在 `imgid === undefined` 时记日志；**`imgid` 已知但 `slotTex` 无纹理**（= 我们这次的形状）**完全静默**。建议把日志条件放宽到 `!tex`，并把 `imgid` 一起打出来 —— 否则 E4 只能靠像素。

### 4.3 给下一位的"确认判据"（最便宜的一步）

拿用户那次会话的 `.tmp/amayui-emulator.log`（或让他重现一次），grep 四处：
1. `getTextureSize slot=… → 0x0（纹理尚未载入` —— 存在 ⇒ **H2**（超时）或首次载入来不及（`textureCache.ts:418-422`）。
2. `回写丢弃` —— 存在 ⇒ **H3**（世代判据把槽打成永久空）。
3. `未绑定纹理槽 → 占位块` —— 存在 ⇒ 该槽**从未绑定**（`imgid === undefined`），是另一条（与 `set-texture` 无关）的路径。
4. `bindTexture imgid=… slot=<白掉的那个槽>` 后面**有没有** `  bind slot … <- imgid …` —— 没有 ⇒ 复查 H2/H3。
我在这份仓库里已有的 `.tmp/amayui-emulator.log`（2026-09-20 21:49 的 itemrestore 跑）里：`纹理尚未载入` **0** 次、`回写丢弃` **0** 次（说明**读档续跑那条路**已被现有屏障覆盖），但那份日志**没有进入过 ADV 窗口帧**（`grep createTexture slot=48` / `draw-texture` 均 0 命中）⇒ **不能用来判本症状**。

### 4.4 若要自动化守卫

- **E2（合成单测，可立即写）**：`.tmp/t0102w/probe-slot-size.mts` 那条序列产品化成 `test/texture-slot-size-first-call.test.ts`：断言"首次 `bind` 后立刻 `size(slot)` 必须给出真尺寸（或明确报缺口），不得静默 0×0"，以及"回写被丢弃后 `resolve` 不得退化成无纹理"。
- **E3（真脚本场景断言）**：把 §2 的链路扩到"进 ADV 页首帧"（现成零件：`src/tools/gameStartChain.ts` 已跑到 SN0000 首文案；再往后 force-advance 到 `label_0000b884` 被调用即可），断言：`_this` 侧 `f8020/f8021`（`i208` 的答案）在 `set-texture` 后的**同一条指令序列内**等于真尺寸；并且每个 `scene.drawItems` 项的槽都在 `slotTex`/画布里。
- **为什么现在做不到纯 E4 目视替代**：白底的判定是像素（`.tmp/*.png`），而 `npm run shot` 本轮被禁（资源冲突）；且白块出现在"新场景首帧 + 等待输入"这个窗口里，抓图脚本现有的 `*-load-next` 场景不覆盖。

---

## 5. 与票据既有结论的关系（哪些要改）

1. **甲-1（落点 = 槽 48 底板）：不成立**（DEBUG 路径，见 §1.4）。票据 `evidence[4]`（`src/NOVEL.txt` 的 `i20b 48 …`）**应当降级为"DEBUG 试跑路径的底板"**。
2. **甲-3（异步陈旧回写）：方向对（异步 vs 同步），但结论面太窄** —— 它只堵了"回写覆盖脚本表面"，没有堵"回写被丢弃后该槽永久无纹理"（H3），也没有覆盖 `i208` 的 0×0（H1/H2）。（用户已复验"白底仍在"⇒ 取证是对的，修复不完整。）
3. **甲-4（"不是纯白，是绿调块"）：错**（§3.3），请直接删掉这条排除项。
4. **丙-1 的日志判据**（`fillSlotRect slot=48` / `bind slot 48 <-` / `回写丢弃`）**抓错了对象**：`fillSlotRect`/`bind slot 48` 只会出现在 DEBUG 路径上；应当改抓 `draw-texture 19640 11`（窗口槽 17）与 `getTextureSize … → 0x0` / `回写丢弃`。

---

## 6. ★缺口（我没做到的 / 没读到的）—— 不掩盖

1. **没能跑到"用户那一刻"的运行时 dump**：`SC0000.BIN` 冷载不画 ADV 窗口（它是章节入口，§2），DEBUG 入口在未实现的 `i140` 上活锁，而"TITLE→GAMESTART→INITGAME→SN0000→…→下一篇"的全链跑手我没有在本轮时限内接通（现成零件见 §4.4 E3）。所以 **"那一次白的是哪个槽/handle"我只有候选（槽 17 的 ADV 窗口 / 0x2a 的背景或 CG / 105000+ 的字格项），没有实测认定**。
2. **没有读**：`0x249` 的 handler 全body（只读了它与 `0x1F9` 共用颜色归一化的注释段）；`label_0000e870`（ADV 例程里决定 `global 0` 的那段）；`f807d` 的派生段（我只统计到 343 处 `mov f807d (global a9df|a9e0|a9e1)`，没定位那段代码的 `jcc` 结构）；`label_00000320`（侧边栏关闭时重画的页面例程）内部；`i073`（字格几何）与那 500 个字格项 `srcW/srcH` 的来源。
3. **没有验证**：`#imgCache` 里"X 已缓存"这个前提在用户那次是否成立（探针只证明了**机制**，没有证明**用户那次真的是这条**）。要证它，只需 §4.3 的日志 grep 或 E3。
4. **没读到的引擎细节**：`Engine+699180`（索引头 @276）的**写入方**在 `.c` 里看不见（只有 `raw 22015` 的 `ReadFile(_this+698904, 0x12C)` 一次整块读入；`.lst:34822` 只有一处 `+0AAB2Ch` 读）—— 这不影响 `708ada` 的结论（值来自那份索引文件，我直接量了文件），但"头里那 6 个计数在别处还会不会被改"我没证。
5. **本轮我没有运行** `npm run verify` / `npm run shot` / 任何写 `analysis/`、`tickets/`、`docs-new/`、`app/`、`src/`、`scripts/` 的命令（按只读纪律）。

---

## 7. 一句话交代给下一位

> 别再查 `708ada`（恒 0，分支 B，槽 48 是 DEBUG 路径）。白底 = **未解析纹理槽的 `draw-texture` 项被画成纯白**（`presenter.ts:388→475→427` + `model.ts:285`）；"开合侧边栏才对"是因为它把 `set-texture` 又发了一次，第二次**同步**命中 `#imgCache` ⇒ `slotTex`/`i208` 当帧正确（探针 `.tmp/t0102w/probe-slot-size.mts` 实测）。要落地就补 `session.ts:588-591` 那条 `0x1F9` 屏障的四个洞（H1 `0x249` 未纳入 / H2 `waitIdle` 500 ms 超时 / H3 世代判据把槽打成永久空 / H4 无 `onReady→markDirty`），并用 §4.3 的日志 grep 认定那一次到底是哪一个槽。
