# CONTEXT — 天結いキャッスルマイスター Emulator 进展快照

> 本文件是**会话外恢复用的上下文快照**（新开会话先读我）。记录当前整体进展、关键技术事实、文件清单、
> 待办与阻塞。有歧义处会明确标注「待确认」。

---

## 0. 一句话现状

用 **TypeScript + Electron + PixiJS v8** 重写《天結いキャッスルマイスター》的 AGE/System4 引擎 VM。
解释器已能无界面跑启动链到 **TITLE.BIN**；**Electron 渲染壳已接通**（窗口 + IPC 文件流 + PixiJS WebGL 渲染），
已把标题**布局**（背景/按钮占位色块）画到屏上，但**真实 CG/按钮图像**尚未接入。当前正做「标题真实图像」阶段。

---

## 1. 工程位置

- 仓库根：`/Users/nekosu/Documents/Projects/amayui-cn`
- 本工程根：`app/amayui-emulator/`
- 反向依据：`engine/engine.cpp`（5.2MB，反编译）、`engine/engine.hpp`（this 对象模型）、
  `docs/re/engine/`（15 篇逆向文档）、`docs/re/engine/06-opcode到handler映射表.md`（opcode→handler 全表）
- 脚本反汇编：`src/*.txt`（游戏脚本）；松散 BIN：`raw/`；ALF 索引：`raw/SYS4INI.BIN`；图像：`raw-parts/DATA1/`（AGF）

---

## 2. 已完成 / 可用状态

### 2.1 解释器（VM 核心，黑盒无界面）
- `docs/03` 里程碑 M0–M3 已达成：启动链 `SYSTEM4(0) → 数据表 INIT(AMINIT2/WDINIT/ALINIT/EBINIT/ITINIT/SKINIT/CGINIT/BTANINIT2…) → INIT → TITLE.BIN(622 指令)`。
- `npm test` 12/12 通过（含 5 条指针模型测试）；`tsc` 干净。
- 关键模型：ADR-011 指针=带标记引用（`Ref={scope,kind,index,stride}`），读解引用/写写穿；`DEC(x)=ror32(key^rol32(x,11),25)`、`ENC(x)=rol32(key^ror32(x,7),21)`，`_this[97059]=key`、`_this[97060]=ENC(0)`。
- 子系统/渲染 opcode（0x1F7–0x208）已逐条核对语义（**fire-and-forget**，只读操作数、排队绘制、不写 VM 状态）——见 `docs/08` 与本文 §4。

### 2.2 Electron 渲染壳（本阶段产出）
| 文件 | 作用 |
|---|---|
| `electron/main.ts` | 主进程：开窗口（内容区 1280×720，标题 天結いキャッスルマイスター），`read-script`/`read-file` IPC，复用 `NodeFileSource`(读 `raw/`) |
| `electron/preload.ts` | `contextBridge` 暴露 `window.api.readScript(index)` / `readFile(path)` |
| `src/renderer/ipcFileSource.ts` | renderer 侧 `FileSource`（IPC 转发到主进程） |
| `src/renderer/pixiBackend.ts` | **PixiJS v8 渲染后端**（实现 `NativeBridge`）：`drawTexture`→批量 Sprite，`setTexture`→记录，HUD |
| `src/renderer/canvasNative.ts` | Canvas 2D 占位后端（**现已被 Pixi 取代，保留作参考**） |
| `src/renderer/renderer.ts` | 入口：IPC FileSource + Engine + 跑启动链到 TITLE + 调 `native.drawHud()` |
| `src/renderer/index.html` | CSP 已含 `unsafe-eval`（Pixi v8 需要）+ `img-src`/`blob:` |
| `build-electron.mjs` | esbuild：`electron/main.ts`→`dist/electron/main.cjs`(CJS,node)，`preload.ts`→`.cjs`，`renderer.ts`→`dist/renderer/renderer.js`(IIFE,browser)，拷 index.html |

- package.json 脚本：`build`(tsc) / `run`(tsx src/run.ts) / `test` / `build:electron`(esbuild) / `electron`(=`electron .`) / `electron:dev`(build+launch)。
- 依赖：`electron@44.2.0`、`pixi.js@8.20.1`（另有 tsx/typescript/@types/node）。
- **验证结果**：`npm run electron:dev`（沙箱环境需 `--no-sandbox`）后，日志 `[boot] done script=TITLE.BIN ip=47 steps=97376 reachedTitle=true`，Pixi 无报错渲染标题布局。

---

## 3. 当前目标：渲染标题画面（真实背景 + 按钮/版权/菜单）

### 3.1 用户给出的标题展示序列
1. **步骤 1**：`SO006`（背景）+ `SO005`（版权提示）**叠加展示**（SO005 压在 SO006 上）。
2. **步骤 2**：播放一个**视频/动画**（尚未处理——视频格式未知，属于独立难点）。
3. **步骤 3**：渲染**主菜单** `SO004`。
- `SO004A` 是 Live2D 用的图（主菜单左侧展示），**当前先不管**。

### 3.2 图像资产（已转换）
已把 `raw-parts/DATA1/*.AGF`（**2556 个**）批量转成 PNG，输出到 **`raw-parts/DATA1-png/`**（2556 个，~743MB），
用 `scripts/agf/cli.js extract raw-parts/DATA1 --out raw-parts/DATA1-png`（日志 `[extract] 2556/2556`）。

| 图像 | 尺寸 | 角色 |
|---|---|---|
| `SO006.png` | 1280×720 RGB | 背景（步骤1） |
| `SO005.png` | 1280×720 RGBA | 版权提示（步骤1，叠加在 SO006 上） |
| `SO004.png` | 1664×1536 RGBA | 主菜单（步骤3） |
| `SO004A.png` | 740×700 RGBA | Live2D 用（暂不管） |

- AGF 解码工具：`scripts/agf/format.js`（`extractAgfToPng(agfPath, outDir)`）已在本工程 JS 实现，`scripts/agf/png.js`、`cli.js`。

### 3.3 当前渲染效果
`PixiBackend.drawTexture(args)` 仍用**原始 raw 参数**，把 draw-texture 画成**按纹理号着色的占位矩形**（布局/坐标即游戏原布局，图像非真实）。
窗口 1280×720（内容区），Pixi 内部 1920×1080 画布缩放到窗口显示。

---

## 4. 关键技术事实（引擎绘制模型，供继续用）

- **绘制分辨率**：回缓冲 `_this[699168]×[699172]`（`sub_440A20` 创建）。config 默认 640×480，但**实际 draw 坐标**：
  - 背景 `draw-texture a 4 0 0 500 2d0 0 0` → dest rect `(0,0, 0x500=1280, 0x2d0=720)`，即 1280×720。
  - 按钮矩形：`draw-texture 12c 4 5a0 0 9c 9c 44e 126` → `(0x5a0=1440,0)`，尺寸 `(0x9c=156,0x9c=156)`；另有 x=0x502=1282 的一列。
  - ⇒ **有按钮/内容绘制到 x≈1440+156=1596**，故**真实屏幕宽度 ≥1596**（怀疑 1920×1080；待确认，见 §7）。
- **draw-texture 语义**（`op_draw_texture_422E70`）：`draw-texture tex layer x y w h p q` → 目标矩形 `(x, y, x+w, y+h)`，`p/q` 读为 int 再 `(float)` 强转（可能为 scale/alpha，待渲染层定）。
- **set-texture 语义**（`op_set_texture_422CB0`）：`set-texture imageId slot color`（imageId 经 `sub_4559C0` 加载图像文件到 slot；失败弹「画像ファイル %s の読み込みに失敗しました」）。
- **贴图变换是 D3D9 矩阵**：`sub_4AC5F0`(scale)/`sub_4AC660`(rot-axis)/`sub_4AC750`(translate)——正交投影下是 2D 仿射，Canvas2D `setTransform`/Pixi 均可表达。
- **分层队列**：`graphics+258` 的绘制队列，`_this[11627]=1` 置脏标记；颜色填充 `sub_4AD0C0`(0x202)/`sub_4ACF60`(0x203)，文本走 GDI（`sub_456710`，0x204/0x205）。
- **分类**：0x1F7–0x208 全部是**只读操作数 + 排绘制命令 + 不写 VM 状态** → M0 用 stub 放行安全。

---

## 5. 资产/资源映射现状（重要阻塞点）

- TITLE 脚本里 `set-texture 5272 4 …`、`set-texture 5273 5 …`（资源 id）。draw-texture 的纹理 id（`a`/`14`/`64`/`12c`…）与 set-texture 的 slot（`4`/`5`）是**两个不同索引空间**。
- ⇒ **尚未确定**「资源 id（5272 等）→ SO005/SO006/SO004 文件」以及「draw-texture 纹理 id → 加载的图像」的映射。
- 用户已知具体图片（SO004/005/006），并已给出展示序列；**待把脚本的 set/draw 命令与这些 SO 文件对上**。

---

## 6. 待办（按优先级）

1. **加载并展示标题真实图像**：
   - 主进程加 `image:png(path)` IPC 把 PNG 文件字节（ArrayBuffer）发给 renderer（或复用 `image:decode` 走 AGF→PNG）。
   - renderer（PixiBackend）用 `Texture.from(createImageBitmap(blob))` 或 `Assets.load(blobURL)` 包成 Texture。
   - 按序列展示：SO006 背景 + SO005 版权叠加 →（跳过/暂缓视频）→ SO004 菜单（SO004A 不管）。
2. **确定真实屏幕分辨率**（1280×720 还是更大 → 影响窗口/画布与按钮位置），见 §7。
3. **操作数解码**：把 `draw-texture`/`set-texture`/`draw-string` 改为 `readIntOperand/readStringOperand` 解码后再调类型化 native 方法（当前是 raw 直传）。若解码出坐标/资源，可进一步把真实图像按脚本精确摆放。
4. （后置）**视频（步骤2）**、**Live2D（SO004A）**、**输入**（让菜单可选择）——均属较大子系统，需独立处理。

---

## 7. 待确认 / 开放问题

- **真实屏幕分辨率**：config 默认 640×480 但与 draw 坐标（背景 1280×720、按钮延伸到 ~1596 宽）不符。怀疑 **1920×1080** 或类似；需确认后调整窗口/画布与坐标。
- **资源 id → SO 文件映射**：`set-texture 5272/5273` 与「SO006/SO005/SO004」如何对应；draw-texture 纹理 id 指向的图像。
- **视频（步骤2）**：文件格式/播放方案未定。
- **操作数解码细节**：`draw-texture` 的 p/q 参数语义。

---

## 8. 运行方式

```bash
cd app/amayui-emulator
npm run electron:dev      # 构建 + 启动 Electron 渲染壳（PixiJS）
# 沙箱/无头环境需加 --no-sandbox（本机终端自跑无需）
```

- node v24.16.0；npm 缓存路径因 root 属主问题需用项目内缓存：`--cache ./node_modules/.cache/npm`（electron 二进制另用 `electron_config_cache` 项目内目录手动下载）。

---

## 9. 注意点 / 坑

- 沙箱里跑 Electron 会因 Chromium 沙箱/GPU 初始化失败，需 `--no-sandbox`；GPU 进程在只加 `--no-sandbox` 时不崩（WebGL 可用）。
- PixiJS v8 需要 CSP `unsafe-eval`（已加）；`Container.name` 已弃用改 `label`，用 `getChildByLabel`。
- npm 对 `~/.npm` 报 EPERM（root 属主文件），用 `--cache` 指向项目内目录解决。
- 当前模型（deepseek-v4-flash-vision-exp）**无图像输入**，无法直接看 PNG；需靠 `file`/尺寸/脚本坐标判断图像内容。
