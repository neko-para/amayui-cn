# 08 渲染后端选型评估

> 状态：**评估完成，PixiJS v8（WebGL）已作为现役后端接入**（见 `src/renderer/pixiBackend.ts` +
> 共享场景层 `src/renderer/sceneModel.ts`）。早期用于跑通链路的 Canvas 2D 后端
> （原 `src/renderer/canvasNative.ts`）已被取代并删除——它没有任何调用方，却会被编译产出，
> 还带着一份与现役后端不一致的 `RenderStatus` 声明。需要回看可从 git 历史取。
> 目标：为 AGE 引擎重写的**渲染子系统**（`_this + 80708` 的 graphics 对象，opcode 0x1F7–0x208）
> 选择渲染技术，并把「VM draw 调用 → 屏幕上像素」的因果链接到 Electron。

---

## 1. 引擎的渲染模型（反编译依据）

AGE 的绘制是一条 **分层绘制队列 + 纹理 + D3D9 矩阵变换 + GDI 文本** 的 2D 合成器：

| 引擎侧事实 | 证据 |
|---|---|
| 每层（layer）一条绘制命令队列 | `graphics + 258` 的 `sub_4AAD40` 链表；`_this[11627]=1` 置「帧需重绘」脏标记 |
| 纹理（CTexture）对象池 | `_this[4*id+42456]` 槽；`sub_4A2C10`（create）`new CTexture` |
| 纹理变换 = D3D 矩阵 | `sub_4AC5F0`→`D3DXMatrixScaling`、`sub_4AC660`→`D3DXMatrixRotationAxis`、`sub_4AC750`→`D3DXMatrixTranslation` |
| 颜色 | 小端字节重排 `(BGR<<8)|A`（BGR→ARGB），`sub_4AD0C0`(0x202)/`sub_4ACF60`(0x203) 设 alpha/color |
| 文本 | GDI `GetTextMetricsA`+`TextOut`（`sub_456710`），有/无阴影两路（`sub_471180`/`sub_46F2D0`） |
| 绘制分辨率 | 回缓冲 `_this[699168]×[699172]`，默认 **640×480**（`sub_440A20` 创建） |

这些 opcode 已逐条核对（见 `docs/re/engine/06-opcode到handler映射表.md` 与本次上文的 0x1F7–0x208 语义表）：
`create-texture(0x1F8)`、`set-texture(0x1F9)`、`draw-texture(0x1FB)`、`draw-string(0x204/0x205)`、
`fill-rect/color(0x202/0x203)`、`scale/rotate/translate(0x1FD/0x1FE/0x1FF)`、`release(0x1FA)`。

结论：**这是一个纯 2D、按层合成、带仿射变换、带 alpha 合成的管线**，没有 3D 世界空间、没有深度缓冲、
没有逐像素自定义着色为主的常规内容（除 L2D）。这对「渲染技术选型」是决定性约束。

---

## 2. 候选技术对比

| 技术 | 与 AGE 映射 | 文本 | 变换 | 叠加/混合 | 实现成本 | 备注 |
|---|---|---|---|---|---|---|
| **Canvas 2D** | `drawImage(tex)`+`setTransform`≈D3D 矩阵；`fillRect`≈fill；`globalAlpha`≈alpha | `fillText` 原生 | 2D 仿射矩阵 | 大多可 | **最低** | 直接正确：纹理、颜色、文本、变换全有对应 |
| **WebGL2** | 顶点/片元着色器更贴近 D3D9 | 需 SDF/字形图集 | 完整 MVP 矩阵 | 原生 blend | 中高 | 性能/逐像素效果/L2D 需要；文本是最大成本 |
| **WebGPU** | 同 WebGL2，更现代 | 同上 | 同上 | 原生 | 高 | Electron/Chromium 已支持，但当下收益不明显 |
| **混合** | 纹理/特效走 WebGL2，文本/UI 走 Canvas2D | 分开 | 分开 | — | 中 | 最接近「真实引擎」的取舍 |

CPU/GPU 说明：Canvas 2D 在 Chromium 里也是 GPU 加速的（`drawImage`/`fillRect` 走 GPU 合成），
并非纯软渲染；对于 VN/2D 这种「每帧纹理不多」的场景性能足够。WebGL 的优势主要在**逐像素效果**（如 L2D、特效层）。

---

## 3. 建议：Canvas 2D 起步，接口抽象以预留 WebGL2

### 3.1 立即采用：Canvas 2D（已接入）

- **映射 1:1**：AGE 的 2D 绘制模型（纹理 quad / 颜色填充 / 文本 / 矩阵变换 / alpha）在 Canvas 2D 里全有直接对应。
- **文本零成本**：AGE 用 GDI 文本，Canvas `fillText` 是最省事的替代（字体图集另行处理 GDI 字体差异）。
- **可观测性**（本项目核心目标之一）：Canvas 每条 draw 都能 hook、叠加 HUD（已实现）、逐步回放。
- **低风险**：不改变 VM 核心，只实现 `NativeBridge`。

### 3.2 抽象接口，预留 WebGL2

在 renderer 侧抽一个 `GfxBackend` 接口（当前实现 = `CanvasBackend`）：

```
interface GfxBackend {
  resize(w,h): void;
  setTexture(slot, image: ImageBitmap, color): void;   // 0x1F9
  drawTexture(id, layer, x, y, w, h, p, q): void;     // 0x1FB
  fillRect(layer, x, y, w, h, argb): void;            // 0x202/0x203
  drawString(layer, x, y, text): void;                // 0x204/0x205
  setTransform(id, matrix): void;                     // 0x1FD/1FE/1FF（D3D 矩阵）
  drawTextLayer(layer): void;                         // 帧合成
  frame(): void;                                      // 置脏标记后合成
}
```

将来按需加 `WebGLBackend`（纹理/特效层）或 `Live2DBackend`（L2D 用 shader），
**VM/opcode 不动，只换 backend**。

---

## 4. 后续要实现的关键点（M5 真渲染）

1. **操作数解码**：当前 opcode→native 是**原始 raw** 直传（`stubSubsystem`），坐标/颜色/纹理号还是占位。
   需改为按 ADR-011 指针模型 `readIntOperand`/`readFloatOperand` 逐操作数解码，再调类型化的 native 方法。
2. **CG 图像解码**：`set-texture` 的 `sub_4559C0` 加载的是游戏 CG 文件，需要接图片解码器
   （AGP/PNG 等），否则只能画占位块。
3. **字体**：AGE 使用内部 ASCII/全角字体 + 阴影，需要加载游戏字体资源，映射到 Canvas `font`/`fillText`。
4. **L2D**：`setL2DMOC`/`0x341/0x345…` 的 Live2D 是最大头，只有 WebGL/shader 能真渲，建议后置、独立 backend。
5. **输入**：`getInputType`/key/mouse 回调把 TITLE 菜单轮询从「空转」解出来（AD-输入）。

---

## 5. 已完成（本阶段）

- Electron 依赖已装（`electron@44.2.0`），二进制就位。
- **渲染后端 = PixiJS v8（WebGL2/WebGPU）**：`src/renderer/pixiBackend.ts` 实现 `NativeBridge`，
  把 `draw-texture` 命令画成**批量 Sprite 矩形**（按纹理编号着色占位），`set-texture` 记录绑定。
  窗口 1280×720（内容区），Pixi 内部 1920×1080 画布并缩放显示。
- **窗口**：标题 `天結いキャッスルマイスター`（`SetGameName`）；`electron/main.ts` 开 1280×720。
- **文件流**：renderer `IpcFileSource` → 主进程 `NodeFileSource`（IPC `read-script`/`read-file`）。
- **AGF 解码就绪**：`scripts/agf/format.js` 的 `extractAgfToPng` 已验证（`SO017.AGF`→900×1280 PNG）。
- **验证**：启动链在窗口内跑到 **TITLE.BIN**（`reachedTitle=true`, ip=47，约 9.7 万步），
  Pixi 无报错渲染标题布局。运行：`npm run electron:dev`（沙箱环境需 `--no-sandbox`）。

### 5.1 待接（真实标题 CG/按钮纹理）

当前 `draw-texture` 仍是**原始 raw 参数**（`stubSubsystem`→`drawTexture`），布局/坐标正确但图像是**占位色块**。
要显示真实 CG 需三块：

1. **操作数解码**：按 ADR-011 用 `readIntOperand`/`readStringOperand` 解码 `draw-texture`/`set-texture`/`draw-string` 的操作数（坐标/资源/字符串）。
2. **纹理号→图像资源→AGF 文件 映射**：`draw-texture` 的纹理 id（如 `a`/`12c`）与 `set-texture` 的 slot（如 4/5）是**不同索引空间**；
   `set-texture 5272 4` 的资源 5272 需经 ALF/图像索引解析到实际 AGF 文件。
3. **AGF→PNG 载入 Pixi**：主进程用 `extractAgfToPng` 解码，经 IPC 把 RGBA 传给 renderer 包成 `Texture`。

> 该映射（哪个 AGF = 标题背景/按钮、资源 id→文件）需要结合图像索引确认，属下一步的关键。

---

## 6. 绘制项的**变换合成**（pivot / 立即缩放 / 「用世界矩阵」门）

> 2026 补：这一节是「滚动条拇指**只有上下两段**、中段不见」那类静默缺陷的根因记录。
> 相关 opcode：`0x1FD` 立即缩放、`0x1FF` 像素平移、`0x217` pivot、`0x219` 描画位置、`0x21E/0x21F/0x220` 三个变换窗。

### 6.1 引擎怎么合成（raw）

`sub_49AA30`（raw 117239-117934，逐帧求值器）对每个绘制项构造**世界矩阵**，`sub_4A2D50`（raw 122891）
再把它乘进投影链（raw 123055）后调纹理绘制：

```
世界矩阵 = T(-pivot) · [work 缩放] · [work 旋转] · [work 平移] · T(+pivot)      ← 全部「最右乘」
```

- `pivot` = DrawItem`+0x18/+0x1C/+0x20`（`0x217` 写），**绝对坐标**：四边形本身建在描画位置上
  （`sub_4A2D50` 把 `&v26[9]` = `+36/+40/+44` 交给纹理绘制，raw 133443/122974），
  故合成结果 = `v' = S·(v − pivot) + pivot`（`v` = 描画位置 + 局部偏移）。
  ⇒ **pivot 与描画位置同处一个坐标空间**；脚本里 `i217 <obj> <dstX> <dstY> 0`（`CONFIG1.txt:2962`）
  就是"以该项左上角为基准缩放"的写法。
- 渲染期真正吃的是 **work** 矩阵（`+0x6C`/`+0xEC`/`+0x16C`，raw 117431 `qmemcpy(v118, a2+27, 64)`）；
  `0x21E/0x21F/0x220` 写的是 **target**（`+0xAC/…`）+ 开窗，窗末 `work ← target`。
  ⇒ **`0x1FD`（`sub_4AC5F0`）写 work ⇒ 立刻生效**，这是引擎里唯一的"立即缩放"。
- **门**：`Scene+46532` 为 0 时整段世界矩阵不参与（raw 123055），而 `Scene+46532 ← DrawItem+0x68`
  （raw 133391）⇒ 只有**变换类指令**（`0x1FD`/`0x1FF`/`0x21E`/`0x21F`/`0x220`）碰过的项才走矩阵路径，
  其余项是"描画位置 + 源矩形尺寸"的纯 2D 贴图（pivot/缩放/旋转/平移**一律忽略**）。

### 6.2 emulator 的映射（`src/renderer/pixi/presenter.ts`）

| 引擎 | emulator |
|---|---|
| 描画位置 `+36/+40/+44` | `sprite.position = (posX, posY)`（世界矩阵门下再叠 `+` 平移动画窗） |
| pivot（绝对坐标） | `sprite.pivot = itemPivotLocal(it) = pivot − pos`（**不是**直接用 pivot） |
| work 缩放 | `sprite.scale = itemScale(it, clock)` |
| work 旋转 | `sprite.rotation = itemRotationRad(...)` |
| `+0x68` 门 | 上面四项**只在 `item.useWorld` 为真时**才施加 |

★两个历史错法（都会"不报错、只是画错"）：

1. **`0x1FD` 只转发给宿主、渲染端只记日志** ⇒ 靠 1px 源贴片纵向拉伸的**九宫格/三段式控件**
   退回源尺寸：CONFIG1 右侧滚动条拇指（上盖 27×23 / 中段 **27×1→209** / 下盖 27×24）就只剩上下两段。
   全库 `i1fd` 有 1231 处（面板/条状控件大量使用），此前**全部不生效**。
2. **把绝对 pivot 当局部 pivot**（`sprite.pivot = pivot`）⇒ 等价于把项平移到 `pos − pivot`；
   而"从未设过 pivot"的项（`pivot = 0`）会被反算成 `−pos`、直接推出画面。
   全库 `i217` 有 3353 处，且脚本惯例是 **pivot 与 position 同步平移**（`SC0330.txt:2007-2017`：
   `i21a` 读回位置 → `i218` 读回 pivot → 两者加同一 Δ → 分别 `i219`/`i217` 写回），
   正说明它们是同一坐标空间里的两个点。

回归：`test/draw-item-scale.test.ts`（÷100、立即生效、pivot 换算、`+0x68` 门）
+ `test/config1-chain.test.ts`（真实 CONFIG1 链路里三段**首尾相接**）。

