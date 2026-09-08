# 版权页「frame 效果」机制记录（LOGO.txt — 已收敛）

> 本文档是 `src/LOGO.txt` 版权页（大理石+文字整屏页）"出现→等待→淡出→切影片"效果的**权威机制记录**。
> 反编译源 `engine/天结_unpacked.exe_utf8.c`（Hex-Rays，模块基址 0x400000，引擎单例 `this`，字节偏移）。所有结论经实机改脚本/逐帧验证。

---

## 1. 组成

主题：2 张整屏图（大理石 `layer 2a`、文字 `layer 2b`）+ **2 个顶点色满屏四边形**（mesh#1、mesh#2）+ 1 个文字图专属的颜色动画窗。

| 对象 | 句柄 | LOGO 行 | 角色 |
|---|---|---|---|
| 大理石图 | 0x30d40 | L10 | 背景层 2a（纹理 5245）|
| 文字图 | 0x30d41 | L12 | 文字层 2b（纹理 5246）|
| mesh#1 | 0x30d42 | L22/38/40 | 黑覆盖层**淡出 = 揭示** |
| mesh#2 | 0x30d43 | L32/42/44 | 黑覆盖层**淡入 = 整体淡出** |

对象句柄由 `add (local-int 0) 30d40 N` 生成，**绝对赋值** `$0 = 0x30d40 + N`（非累加）。L33/L35 `add 30d40 1`→$0=0x30d41，故 **L34 `set-draw-color-alpha` 与 L36 `set-draw-color` 都作用于 0x30d41（文字图）**，非 mesh#1。

---

## 2. 动画时钟（唯一时间源）

**时钟不是帧计数器，是 `timeGetTime()`（Windows 毫秒表）。**

- 字段：引擎 `(_this + 369332)`（DWORD 下标 `[92333]`；= 池基 `322832+46500`，mesh-draw 以池基读成 `[46500]`、`sub_407E20` 以池基读成 `[11625]`）。上一帧值存 `(_this + 369336)`=`[92334]`。
- 每帧写入（主循环，`WinMain`/消息循环）：
  - 20445 `v3 = (fn)timeGetTime`
  - 20465 `v94 = v5 = timeGetTime()`
  - 20468 `if (!this[429752] || (effect_flags & 0x400))` → 20571 `else if (this[667860] || (flag & 0x2400))` → 20575-20576 `[369336]=[369332]; [369332]=v94`；20583 条件满足时 present。
  - **关键**：`0x2400` 含 `0x400`（版权页等待旗标），故脚本停那时时钟仍每帧推进。
- 意义：**按墙钟毫秒走（每秒约 +1000），与帧率无关**。⇒ 所有窗口/时长单位都是 **ms**。
- 脚本级显式时间戳 op：`0x1F4`(sub_41A090)、`0x20C`(sub_41A1A0, 时间戳+present)、`0x23C`(sub_41A2C0)，均 `[92334]=[92333]; [92333]=timeGetTime()`。

**字段读写**：`sub_49A300`/`sub_4AF1C0` 用 `this[46500]`（池基读法）或引擎 `[92333]`；`this[46512]`=强制冻结，`this[46516]`=挂起工作旗标（置1 让 0x400 卫门保持）。

---

## 3. 两组正交颜色动画（"背景先、文字后"的真正来源）

不是覆盖层 z 序、不是 LAYER 次序、不是 mesh 间 z——是**两个对象各自独立的颜色动画槽**，**逐像素相乘**合成。

### 3a. 背景(2a) = mesh#1 的 vertex-color 动画（CalcDiffuse）

- 配置：L38 `set-vertex-color(0x322)`、L40 `set-vertex-color-alpha(0x323)`。
- 字段（`sub_426C20`→`sub_4AE2C0`(130789) / `sub_426CF0`→`sub_4AE330`(130806)）：`entry[0]|=2`(动画位)、`entry[10]`=窗起点、`entry[11]`=start、`entry[12]`=count、`entry[13]`=state0、`entry[14]`=state1。
- 逐帧（`sub_4AF1C0`(131435) RenderPolygon，131491-131501）：
  ```
  if (entry[0]&2 && entry[12]>0 && clock < entry[10]+entry[11]+entry[12] && !this[46512]) {
     if (clock > entry[11]+entry[10]) a3 = (clock-entry[11]-entry[10])/entry[12];
     CalcDiffuse(entry, a3);  this[46516]=1;
  } else {  // 收尾：冻结在 state1
     entry[11]=0; entry[12]=0; entry[13]=entry[14]; entry[14]=-1; CalcDiffuse(0.0);
  }
  ```
- **CalcDiffuse**(`sub_4A2050`, 120438) = 逐字节通道 lerp `blend = state1·b·a3 + state0·b·(1-a3)`，再乘到每顶点基础色写入 VB+16 ⇒ 渲染色 = 顶点基础色 × 插值态色。
- mesh#1：state0=0xff000000(不透明黑) → state1=0x00000000(透明)，窗 `[0,0x1f4]=[0,500]ms` ⇒ **黑罩淡出 = 揭示下方内容**。
- mesh#2：state0=0x00000000 → state1=0xff000000，窗 `[0x1194,0x1f4]=[4500,5000]ms` ⇒ **黑罩淡入 = 整体淡出**。

### 3b. 文字(2b) = draw-item 的 diffuse-alpha 动画

配置（都作用于 0x30d41）：
- L34 `set-draw-color-alpha(0x203)` → `sub_4ACF60`(129850)：写 `item+48`(混合模式, 0 默认)、`item+96`(FROM 色)。
- L36 `set-draw-color(0x202)` → `sub_4AD0C0`(129936)：`item\|=2`(启用动画位)、`+52`(START)、`+56`(DELAY)、`+76`(COUNT)、`+100`(TO 色)。

逐帧（`sub_49A300`(115116) 组装的窗，用 `this[46500]`）：
```
if (flags&2) {                     // bit1 门控
   if (!item+52) item+52 = clock;  // 首帧锁存起点
   if (clock >= start+delay+count) item+96 = item+100;        // 完成
   else if (clock > delay+start) 在 item+96↔item+100 按 (clock-start-delay)/count 插值;
}
```
工作色 = **item+96**，作为 **a7(diffuse)** 传纹理绘制（`sub_4AEEA0`(131306)→`sub_4A2D50`(121065)→texture-slot vtable+20）。

#### 字段语义表（文字图 0x30d41）
| 字段 | 写入点 | 文字值 | 语义 |
|---|---|---|---|
| `+0` flags | sub_4AD0C0 129948 `\|=2` | bit1 | 启用该颜色动画（sub_49A300 115663 `&2` 门控）|
| `+48` | sub_4ACF60 129857 | 0 | 混合模式 a6（0=默认；非动画窗成员）|
| `+52` | sub_4AD0C0 129949 | 0→首帧写时钟 | **START** |
| `+56` | sub_4AD0C0 129951 | 0x12c=300 | **DELAY** |
| `+76` | sub_4AD0C0 129953 | 0x12c=300 | **COUNT/时长**（实机改：1→瞬现、4500→慢现）|
| `+96` | sub_4ACF60 129859 | 0x00FFFFFF | **FROM**（alpha=0 透明白，RGB 白）|
| `+100` | sub_4AD0C0 129955 | 0xFFFFFFFF | **TO**（alpha=255 不透明白，RGB 白）|

**为何是 alpha 而非 RGB**：FROM↔TO **仅 alpha 字节不同（0x00→0xFF），RGB 恒白**。若做 RGB tint，RGB 不变→零视觉变化⇒排除。⇒ **逐像素 alpha 淡入**（diffuse.alpha × 纹理.alpha）——SO005（多色+阴影）唯一干净成立的方式，整幅含阴影一起淡入。

---

## 4. 时间轴（ms 墙钟）

| 区间 | 事件 |
|---|---|
| `0→500` | mesh#1 黑罩淡出 → **背景(2a, mesh#1 vertex-color)** 渐显 |
| `300→600` | 文字(2b, draw-item diffuse-alpha: delay 300 + count 300) 透明→不透明 **渐显** |
| `500→4500` | 版权页静止显示（mesh#1 已揭示、mesh#2 未到）；配合 `wait`(L46, 0x21C) 置 `0x400` 卫门挂起脚本 ip（L47）|
| `4500→5000` | mesh#2 黑罩淡入 → **整页（含背景+文字）整体淡出到纯黑** |
| `5000`（墙钟） | 脚本执行 `release-texture`(0x1FA) 硬 COM-Release 两图 + `play-movie`(0x20F) → **纯黑→影片第一帧瞬时硬切**（无交叉淡化）|

**为何"背景先、文字后"**：两槽正交、逐像素相乘。mesh#1 装 `0~1` 时黑罩瞬撤→背景瞬现，但文字(diffuse-alpha 槽)仍按自身窗口（300/600ms）渐显→文字仍拖后；mesh#1 装 `0~4500` 时黑罩慢撤、两层都被罩住，文字额外叠上自身淡入被主导→视觉同步。

---

## 5. 严格 flag 校验策略（emulator 实现准则）

**实现时不得静默忽略未知 flag——必须立即中断（throw/interrupt）。**

### 已知 flag 位（各对象类型）
**draw-item（图像，`+0` flags）**
- bit0 `|1`：item 已创建/存在（draw-texture, sub_4ACE50 129805；渲染前检查 `&1`）。
- bit1 `|2`：**颜色动画启用**（set-draw-color, sub_4AD0C0 129948；sub_49A300 115663 `&2` 门控 + 逐帧求值）。
- bit2 `&4`：额外渲染分支（sub_4AEEA0 131368 `(item[0]&4)==0` 决定是否调 sub_49BCC0）。

**mesh（顶点色四边形，`entry[0]` flags）**
- bit0 `|1`：mesh 已创建/存在（`sub_40DC30` 节点）。
- bit1 `|2`：颜色动画启用（set-vertex-color-alpha, sub_4AE330 130806；sub_4AF1C0 131491 `entry[0]&2`）。

### 校验规则
1. 每对象类型定义**已知位掩码**：`KNOWN_DRAW_ITEM_FLAGS = 0b101`（bit0|bit1|bit2）、`KNOWN_MESH_FLAGS = 0b011`（bit0|bit1）。
2. 每次对 flags 做**读**（进渲染/动画）或**写**（opcode setter）前，先校验：`(flags & ~KNOWN_MASK) != 0` ⇒ 抛出 `UnknownFlagError`（含 opcode、对象类型、值与未知位），**终止运行**。
3. 写路径只允许置/清已知位；出现未知位立即中断，绝不"顺手清掉"继续。
4. 保留 `unhandled`（未实现 opcode）与 `UnknownFlagError`（已实现但遇未知 flag）两级硬中断，杜绝"静默误渲染"。

---

## 6. 关键代码索引（engine/天结_unpacked.exe_utf8.c）

| 概念 | 函数/行 |
|---|---|
| 时钟每帧写 | 主循环 20445/20465/20571-20583 |
| mesh 渲染 + CalcDiffuse | `sub_4AF1C0` 131435 / `sub_4A2050` 120438 |
| draw-item 颜色动画求值 | `sub_49A300` 115116 |
| set-vertex-color(-alpha) | `sub_4AE2C0` 130789 / `sub_4AE330` 130806 |
| set-draw-color-alpha | `sub_4ACF60` 129850 |
| set-draw-color | `sub_4AD0C0` 129936 |
| draw-item 渲染 | `sub_4AEEA0` 131306 |
| draw-texture 处理器 | `sub_422E70` 30846 → `sub_4ACE50` 129796 |
| image 绘制器 | `sub_4A2D50` 121065 → texture-slot vtable+20 |
| 0x400 等待门 | `sub_407E20` 12679（图形池 pending `_this[369348]`）|
| 淡出后的硬切 | `release-texture` 0x1FA `sub_422E00` 30822、`play-movie` 0x20F `sub_4237B0` 31165 |

---

## 7. 关于"先后"的最终判定（重要，附判定法）

**背景(2a)先、文字(2b)后** 的成因是 **两组正交颜色动画**，**不是**覆盖层 z 序 / LAYER 次序 / mesh 间 z：
- **背景(2a)** = mesh#1 的 **vertex-color** 动画（CalcDiffuse 黑罩淡出，窗 `[0,0x1f4]`）。
- **文字(2b)** = draw-item 的 **diffuse-alpha** 动画（L34+L36 作用于 0x30d41，`+56=300/+76=300`，from 0x00FFFFFF→to 0xFFFFFFFF，窗 ≈`[300,600]`ms，**逐像素 alpha 淡入**）。
- 二者**逐像素相乘** ⇒ 文字不随 mesh#1（独立动画槽）、mesh#1 慢速时文字被主导。实机改 mesh#1 为 `0~1`(瞬时)/`0~4500`(慢)→文字保持默认速度/跟随，以及改 L36 `12c 12c` 为 `0 1`(瞬现)/`0 4500`(慢现)——**全部吻合**。image-swap 跟随槽位（内容是"文字/大理石"互换后仍先出现 2a 槽内容）亦由此解释（各自动画槽，非内容/感知）。

> 曾被（错误地归因）为"单一均匀黑覆盖层 + LAYER 2a<2b 依次暴露"，经判定法证伪并推翻；真相为上述两组正交动画。

## 8. Emulator 实现落点

机制已在 emulator 落地（`PixiBackend` 场景图 + 引擎式 present + 严格 flag + 文件日志）。具体实现模型/改动文件/验证见 **`docs-new/04-app/emulator-copyright-effect.md` §0「实现状态」**；本文件为**引擎机制权威记录**，实现细节以该文件为准。
