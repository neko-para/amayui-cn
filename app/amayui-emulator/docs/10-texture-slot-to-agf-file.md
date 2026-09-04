# 10 纹理 slot 与 AGF 文件名的对应关系（实证）

> 状态：**结论明确**。回答「纹理 slot 到底对到哪个 AGF 文件」。
> 依据：`src/LOGO.txt`、`src/TITLE.txt`、`src/SYSTEM4.txt` 等脚本；`engine/engine.cpp`
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

## 5. 相关代码位置

- 模拟器解析：`src/arch/nodeFileSource.ts`（`resolveEntry`）+ `src/script/alf.ts`（`resolveFileEntry`）。
- 当前渲染占位：`src/renderer/pixiBackend.ts` 的 `drawTexture`（现在按纹理号着色，未用真实图）、`setTexture`（只打日志）。

## 6. 待确认 / 遗留

- `draw-texture` 的 `tex` 句柄 → 具体子矩形/图集切片的精确映射（仅在需要逐碎片渲染时追）。
- `create-texture`（0x1F8）`sub_422C20` 会在图形子系统造纹理对象（LOGO 用 `create-texture 2a 500 2d0 0`），其与 `tex=0x30d40` 的从属关系待定。
