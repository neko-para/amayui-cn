# 10 纹理 slot 与 AGF 文件名的对应关系（实证）

> 状态：**结论明确**。回答「纹理 slot 到底对到哪个 AGF 文件」。
> 依据：`src/LOGO.txt`、`src/TITLE.txt`、`src/SYSTEM4.txt` 等脚本；`engine/天结_unpacked.exe_utf8.c`
> 的 `sub_422CB0`(set-texture)、`sub_4A3800`、`sub_4559C0`、`sub_422E70`(draw-texture)；
> 模拟器 `dist/arch/nodeFileSource.js` 的 `resolveEntry` 实测。

---

## 0. 一句话结论

**纹理 slot 与 AGF 文件的唯一绑定来自 `set-texture <imgid> <slot>` 这条指令。**

- `imgid`（第 1 操作数）= **统一文件 id**，经 `resolveEntry(imgid)` 解析成 `SOxxx.AGF` 文件名。
- `slot`（第 2 操作数）= 纹理槽号，引擎在运行时把它与 `imgid` 绑定（写进纹理槽表 `[5*slot+466]=imgid`）。
- 因此：**slot N 🌐 对应「最近一次 `set-texture <imgid> N` 里 imgid 解析到的那个 AGF 文件」。**
- 引擎没有其它任何把 slot 连接到文件的机制；slot 是**场景内复用**的，不同脚本可把同一 slot 重新绑定到不同文件。

⚠️ **必须区分三组独立的索引空间**（这是本文件要厘清的核心）：

| 索引空间 | 出现在 | 含义 | 是否 = 文件 |
|---|---|---|---|
| **imgid / file id** | `set-texture` 第 1 参数 | 统一文件 id | ✅ 经 `resolveEntry` 得文件名 |
| **slot** | `set-texture` 第 2 参数 | 纹理槽 | ❌ 只是个槽号 |
| **tex（纹理 id）** | `draw-texture` 第 1 参数 | 图形子系统内的纹理对象句柄 | ❌ 独立句柄 |
| **layer** | `draw-texture` 第 2 参数 | 绘制层（标题里 == slot） | ❌ 绘制目标层 |

---

## 1. 绑定链（引擎实测）

### 1.1 `set-texture` 处理器 `sub_422CB0`（engin.cpp:30769）

```c
v5 = readIntOperand(1);                 // op1 = imgid（统一文件 id）
ArgList = sub_4559C0(res, ..., v5, ...) // 按 imgid 打开文件
v6 = readIntOperand(3);                 // op3 = color
... color 打包成 v12 ...
v8 = readIntOperand(2);                 // op2 = slot
sub_4A3800(_this + 322832, v5=imgid, hFile, v8=slot, color, 0);
```

### 1.2 `sub_4A3800`（engin.cpp:121532）

```c
if ( sub_49E9D0(_this, hFile, a4=slot, a5=color, a6=0) ) {
    v7 = &_this[5 * a4];         // 纹理槽表：每槽 5 个 int
    v7[466] = a2;                // [5*slot + 466] = imgid   ← slot → imgid 绑定
    v7[467] = a5;                // [5*slot + 467] = color
    _this[5 * a4 + 470] = 0;
}
```

⇒ **`[5*slot + 466] = imgid`**，把文件 id 存入槽表。这与 docs/09 §4 结论一致。

### 1.3 `imgid → 文件名`：`resolveEntry`（统一文件 id 空间）

`resolveEntry(imgid)`：
- `imgid < 本体文件数` → 本体 `SYS4INI.BIN` 对应条目；
- 否则 `包号 = imgid >> 24`、`包内索引 = imgid & 0xFFFFFF` → `APPEND0n.AAI` 对应条目；
- 条目里带 `name`（如 `SO006.AGF`）与所属归档（如 `DATA1.ALF`）。

---

## 2. 标题 / 启动路径 slot ↔ AGF 文件实测表

用模拟器 `resolveEntry` 对脚本中的 `set-texture <imgid> <slot>` 逐条解析：

### 2.1 启动即画面（`SYSTEM4.txt`）

| slot | imgid | 文件 | 角色 |
|---|---|---|---|
| `0xc` | `0x5191` | `SO000.AGF` | 启动底 |
| `0xf` | `0x525e` | `SO002.AGF` | 启动画面 |
| `0x10` | `0x525f` | `SO027.AGF` | 启动画面 |
| `0x11` | `0x5260` | `SO001.AGF` | 启动画面 |

### 2.2 标题版权/背景（`LOGO.txt`）

| slot | imgid | 文件 | 角色 |
|---|---|---|---|
| `0x2a` | `0x5245` | `SO006.AGF` | 背景（步骤 1） |
| `0x2b` | `0x5246` | `SO005.AGF` | 版权叠加（叠在背景上） |

补充：LOGO 还引用 `0x5247` → **`LOGO.MPG`**（不是 SO007.AGF，**修正 docs/09 §1.1 的「SO007 相关」备注**），用于 `play-movie 5247 2a 20004`（视频/动画句柄）。

### 2.3 标题主菜单（`TITLE.txt`）

| slot | imgid | 文件 | 角色 |
|---|---|---|---|
| `0x4` | `0x5272` | `SO004.AGF` | 主菜单复合图（步骤 3） |
| `0x5` | `0x5273` | `SO004A.AGF` | Live2D 用菜单图（暂不管） |

`jcc (global-int a9d0)`：仅当标志 `a9d0` 非 0 才执行 `set-texture 5273 5`（SO004A）。

### 2.4 其它常用 slot 复用（贯穿全局）

| imgid | 文件 | 常被绑到 | 角色 |
|---|---|---|---|
| `0x39a8` | `SO023.AGF` | `0x49`/`0xc0`/`0xc1` 等 | 公共窗口/底 |
| `0x5101` | `SO020.AGF` | `0xc0` | 列表/框 |
| `0x5102` | `SO039.AGF` | `0xc2` | 列表/框 |
| `0x5168` | `SO010.AGF` | `0xc0`/`0xc3` | 公共 UI |
| `0x5159` | `SO008A.AGF` | `0xe` | 选图 |
| `0x515c` | `SO021.AGF` | `0x48` | 地图 |
| `0x5163`/`0x5164` | `SO021B/C.AGF` | `0x5c`/`0x5d` | 地图分页 |
| `0x56` | `BG008AA.AGF` | `0x49` | 背景 |

> 观察：slot 编号（`0xc/0xe/0xf/0x10/0x11/0x48/0x49/0xc0/0xc1/0xc2/0xc3/0x2a/0x2b/0x4/0x5`）在整个游戏里被反复使用，**同一 slot 在不同场景绑定不同的 AGF**。所以「slot ↔ 文件」不是全局固定表，而是**随脚本执行而动态变化**的绑定。

---

## 3. draw-texture 的 `tex`（第 1 参数）≠ slot ≠ imgid

`draw-texture <tex> <layer> x y w h p q`（opcode 0x1FB）处理器 `sub_422E70`（engin.cpp:30846）：

```c
v2 = readIntOperand(6);  v11 = readIntOperand(4) + v2;   // right  = y + h
v3 = readIntOperand(5);  v10 = readIntOperand(3) + v3;   // bottom = x + w
v4 = readIntOperand(3);  v9  = readIntOperand(4);        // left/top = x, y
v12 = (float)readIntOperand(7);                           // p
v13 = (float)readIntOperand(8);                           // q
v7  = readIntOperand(2);                                  // layer
v5  = readIntOperand(1);                                  // tex ← 纹理 id
return sub_4ACE50(_this+80708, v5=tex, v7=layer, rect, v12, v13, 0.0);
```

`sub_4ACE50`（engin.cpp:129796）把 `tex` 当作**绘制命令/纹理对象注册表的键**（`sub_4AAD40(_this+258, &tex)`），即 `tex` 是**图形子系统内的纹理对象句柄**。

### 3.1 两个空间确实不同（证据）

- LOGO：`set-texture` 绑到 slot `0x2a/0x2b`；但 `draw-texture` 用的是 `tex=0x30d40/0x30d41`，画在 `layer=0x2a/0x2b`。
- TITLE：`set-texture` 绑到 slot `0x4/0x5`；`draw-texture` 用的是 `tex=0xa/0x14/0x64/0x6e/0x76/0x77/0xc8/0xc9/0xd2…/0x12c…/0x135`，画在 `layer=0x4/0x5`。

### 3.2 但 `layer`（draw-texture 第 2 参数）== `slot`（set-texture 第 2 参数）

在标题场景里两者恒等：
- LOGO：`draw-texture 30d40 2a …`、`draw-texture 30d41 2b …` ↔ slot `0x2a/0x2b`。
- TITLE：`draw-texture a 4 …`、`draw-texture 14 5 …` ↔ slot `0x4/0x5`。

⇒ **set-texture 把一个 AGF 绑定到某个绘制层（layer/slot），draw-texture 在该层上贴 `tex` 句柄**。`tex` 是该层内从已加载图像切分/生成的具体纹理（子图/图集/插槽）。

---

## 4. 对渲染实现的启示

**（已按指令/引擎实证，且用真实标题菜单对照验证）裁剪 = draw-texture 的源矩形（op3-6），目标位置 = op7/op8。**

`draw-texture`（`sub_422E70`，engine.cpp:30846）语义（8 个操作数）：

```
draw-texture <tex> <layer> <srcX> <srcY> <srcW> <srcH> <dstX> <dstY>
```
- op1 `tex`：纹理对象句柄（图形子系统 tex id，`_this[4*texid+42456]` 取对象，见 `sub_49ED60`）。
- op2 `layer`：绘制层，标题里==set-texture 的 slot。
- **op3-6 = 源裁剪矩形**（图集内位置 `(srcX, srcY, srcW, srcH)`）。
- **op7/op8 = 目标屏幕位置** `(dstX, dstY)`；目标尺寸 = 源尺寸（1:1，handler 未做缩放）。
- （handler 里 `SetRect(&rc, op3, op4, op3+op5, op4+op6)` = 源矩形；op7/op8 转 float 存入命令 [9]/[10] = 目标位置。）

### 4.1 TITLE 菜单两态按钮（实证）
- tex 号编码状态：`normal=0x12c+2n`（偶）、`hover=0x12d+2n`（奇），n=按钮下标。
- **源矩形**（op3-6）：normal 用 SO004 **右列**（如 `0x5a0=1440,0,0x9c²`）、hover 用**左列**（`0x502=1282,0,0x9c²`）——两态分别为图集里相邻的两列子纹理。
- **目标位置**（op7/op8）：从数组 `(local-int 5)=[44e 3e0 365 2d9 453]`、`(local-int 69)=[126 192 1e5 21f 22a]` 每按钮取值，得到**散布**的屏幕位置：
  `(1102,294) (992,402) (869,485) (729,543) (1107,554)` —— 与真实菜单「Game Start 右上→…→Quit 右下」的散布布局一致。
- **视口 1280×720**：背景源 `(0,0,1280,720)` 铺满、按钮最大 `(1263,710)`，全部落在 1280×720 内。

### 4.2 结论
对每条 draw-texture：取 layer 绑定纹理，按 `(srcX,srcY,srcW,srcH)` 从图集裁剪，**1:1 贴到屏幕 `(dstX,dstY)`**。
- 默认（无输入）只画 normal（偶 tex）按钮；hover 时脚本画奇 tex 到其各自 dst 位置。
- 该模型已用无界面光栅产出与真实标题菜单**布局吻合**的渲染（标题 logo、5 个散布按钮、版权行、背景），已在 Pixi 渲染器实现。

> 关键教训：不能用「源==dest」这类从像素反推的近似。真实位置由 draw-texture 的 op7/op8 显式指定（散布按钮位置即来自这两个数组），源裁剪由 op3-6 指定。二者独立。

---

## 4.3 ★加载的**同步性**与纹理帧屏障（2026-09，实测时序错位的修法）

引擎的 `set-texture`(`sub_422CB0` raw 31191-31230) 是**同步**的：同一指令内
`sub_4559C0`（CreateFile/ReadFile 读 AGF）→ `sub_4A3800`（解码 + 装进 CTexture 槽）→ `sub_455C60`（关闭），
失败还会抛 `Command_ShowMessage`（`画像ファイル %s の読み込みに失敗しました`）
⇒ **指令返回时槽里已经有像素**，同一帧「绑定 + 绘制」不可能错位。

emulator 侧走 `window.api.image()`（renderer → 主进程 IPC + AGF 解码）是**异步**的，
若不补齐就会出现时序错位（2026 实测：**首次从主界面进设置时，ADV 样例文案先出现、CONFIG 背景晚几帧**）。
因此新增**纹理帧屏障**：

- `TextureCache` 记录在途载入（`#inflight` / `pendingCount`），`waitIdle(timeoutMs=500)` 等它们结束；
- `NativeBridge.texturesIdle?()`（`PixiBackend` 转发 `waitIdle`）由会话在**每帧合成（present）之前**等待；
- headless 宿主无纹理 ⇒ 不实现该钩子（直接放行，测试确定性不受影响）；
- 超时兜底 500ms，保证载入异常不会把帧循环挂死。

守卫：`test/texture-frame-barrier.test.ts`（bind 登记在途 / 热路径直接放行 / 失败也放行）。

---

## 4.4 ★**程序化槽**（`create-texture` + `draw-string`）与"中间一片纯白"

槽不只有"绑定 AGF 文件"一种来源：`0x1F8 create-texture`（`sub_422C20` → `sub_4A2C10(Scene, slot, w, h, mode)`）
建的是一张**空白离屏表面**，随后由 `0x204 draw-string`（→ `sub_456710`）往上**直绘文本**、
`0x207` 在槽之间搬运、`0x1F9` 也可以再把它绑成文件图。`CONFIG1`（设置界面）就是这套：

```
create-texture 196 628 360 0            # 空白表面（12 行 × 30px）
draw-string 196 <x> 6+30i "项目名 数值"  # 逐行直绘（CONFIG1.txt:2760/2773）
draw-texture … 196 0 (30i) 628 30 …     # 每行裁 628×30 贴到列表行上（:3019-3022）
```

**两个静默缺陷的组合**（2026 实测："设置界面中间的项目的文字没有渲染，而是全是纯白色"）：

| 缺陷 | 症状 |
|---|---|
| `create-texture` 只记日志、不建表面 | 该槽没有纹理 ⇒ 渲染器退回 **1×1 白纹理占位** ⇒ 中间一条**纯白** |
| `0x204 draw-string` 是宿主桩（调用被丢弃） | 即使建了表面也**一个字都不画** |

修法：`TextureCache.create` 真建一张 `w×h` **全透明** canvas 纹理（引擎新表面未初始化 ⇒ 不遮挡下层素材），
`drawString` 就地 `fillText` 后 `source.update()`；headless 侧把文本记进 `scene.slotText`（快照可断言）。
字形推进与描边副本放在纯函数 `text/layout.drawStringGlyphs`（可在 Node 单测）。
`create-texture` 重建表面 = 之前画上去的字一起丢（引擎语义）。

守卫：`test/draw-string.test.ts` + `test/config1-chain.test.ts`（槽 196 上 14 条行文本 / 每行都有控件）。

---

## 4.5 ★纹理的**销毁时机**：别在舞台还引用它的时候销毁（2026 黑屏事故）

症状：**切到「角色设定」页后整屏只剩 Pixi 的背景色**（`0x0a0d16`），VM 照跑、日志里没有任何异常，
切回别的页也不再恢复。

根因（`TextureCache.create` / `release`）：Pixi 的 ticker **每帧自己 `app.render()`**，
而我们的 `present()` 只在 **VM 跑完一批指令之后**才重建舞台 ⇒ 存在这个窗口：

```
VM: create-texture / release-texture  → 当场 texture.destroy(true)
                                        ↑ 舞台上仍挂着上一帧引用它的 Sprite
紧接着 ticker 的一次 render → 去画一个已销毁的纹理 ⇒ WebGL 批次状态损坏、此后画不出任何东西
（异常发生在 ticker 回调里、不在我们的调用栈上 ⇒ 日志空白，"指令还在跑、画面全黑"）
```

修法（两条）：

1. **同尺寸的 `create-texture` 复用画布**：`clearRect` + `source.update()`。
   引擎语义是"新建空表面"，像素结果完全一致，但从根上少一次销毁/新建；
2. 换尺寸 / `release-texture` 时把旧纹理推进 **`DestroyQueue`**，由 `present()` **之后**的
   `TextureCache.collectGarbage()` 统一销毁 —— 那一刻舞台已经换成新纹理，销毁是安全的。

另外给渲染进程加了"野异常"落盘（`[renderer-error]` / `[renderer-rejection]`）：
ticker 回调里的异常从此也能在 `.tmp/amayui-emulator.log` 里看到，不再隐身。

守卫：`test/texture-lifecycle.test.ts`（队列语义：push 不销毁 / flush 传 `destroy(true)` / 幂等）+
**E4 目视回归** `npm run shot`（主进程合成鼠标事件走一遍真实链路并截图，自动提示"几乎全黑"）。

---

## 5. 相关代码位置

- 模拟器解析：`src/arch/nodeFileSource.ts`（`resolveEntry`）+ `src/script/alf.ts`（`resolveFileEntry`）。
- 纹理缓存与帧屏障：`src/renderer/pixi/textureCache.ts`（`bind` / `preloadImage` / `waitIdle` / `create` / `drawString`）+ `src/renderer/pixiBackend.ts`（`texturesIdle`）。
- 程序化槽的共享模型（文本可观测）：`src/renderer/scene/ops.ts`（`scDrawString` / `scCreateTextureReset`）+ `src/renderer/scene/state.ts`（`slotText`）。

## 6. 待确认 / 遗留

- `draw-texture` 的 `tex` 句柄 → 具体子矩形/图集切片的精确映射（仅在需要逐碎片渲染时追）。
- `create-texture`（0x1F8）`sub_422C20` 会在图形子系统造纹理对象（LOGO 用 `create-texture 2a 500 2d0 0`），其与 `tex=0x30d40` 的从属关系待定。
- `mode`（op4）的取值语义未建模：emulator 一律按"全透明新表面"处理；若某处 `mode != 0` 表示预填底色/格式差异，需要再读 `sub_4A2C10`。

