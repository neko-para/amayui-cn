# 04-app · amayui-emulator

用 **TypeScript + Electron** 重写《天結いキャッスルマイスター》的 AGE 引擎 VM（解释器），把 `engine/天结_unpacked.exe_utf8.c` 的逻辑以干净 TS 语义实现，替换原 Win32 调用为 H5/IPC，获得**更好的可调试性、可观测性、可插件化与跨平台**。

## 1. 现状

- **M0–M3 里程碑达成**：解释器能从 `SYSTEM4.BIN`（index 0）沿启动链执行全部数据表 INIT 脚本，正确运行到 **`TITLE.BIN`（622 指令）执行点**（第一里程碑）。
- `npm test` 12/12 通过（含 5 条指针模型测试）；`tsc` 干净。
- TITLE 后进入 Live2D/消息主循环（`setL2DMOC`、等待输入），M0 无界面 stub 使其停在消息循环（预期）。
- **Electron 渲染壳已接通**：窗口（内容区 1280×720）+ IPC 文件流 + PixiJS v8 WebGL 渲染；标题布局、真实标题图像已接入。

## 2. 技术前提

- 引擎为 x86 32 位、未见 int64；JS `number` 配合显式 32 位位运算可安全操作 2^53 内整数（ADR-011 配套）。

## 3. 架构

```
[主进程]  NativeBridge 壳（文件/归档/未来渲染+音频，经 IPC）
   ▲ IPC
[渲染进程] 解释器核心 (纯 TS)
   - Engine / ScriptContext 对象
   - dispatch[opcode] 分发表（可注入 = 插件点）
   - 读写原语 (readInt/Float, writeInt/Float, DEC/ENC)
   - NativeBridge 调用（当前 == stub）
```

- 文件访问全走异步代理 `FileSource`（`src/arch/fileSource.ts`；宿主 `NodeFileSource`，renderer 换 `IpcFileSource`）。
- 插件点 = `dispatch[]` 可替换（ADR-009，后置）；观测点 = 解释器步进 hook。

## 4. 目录结构

```
app/amayui-emulator/
├─ electron/     # main.ts(主进程+文件IPC)/preload.ts(contextBridge)
├─ src/          # arch/(FileSource) renderer/(IpcFileSource+PixiBackend+renderer.ts)
│                # script/(lzss/alf/bin/opcodes) util/ vm/(engine/operand/ops/interpreter/native)
├─ test/         # xval(解析vs文本) + boot(管线级)
├─ build-electron.mjs / package.json / tsconfig.json
└─ README.md
```

## 5. 关键 ADR（架构决策）

- 启动层级 / 对象模型（Engine、ScriptContext）/ `NativeBridge` / 未实现 opcode 硬报错 / 32 位语义 / BIN 读取器。
- **ADR-010**：函数级状态追踪（每原函数重写状态 + 确认忽略的证据/复核）——`src` 内函数状态注册表。
- **ADR-011**：指针 = 带标记引用（`Ref={scope,kind,index,stride}`）；读解引用、写写穿；不当数值（`lea`/`lookup-array`/`memcpy` 模拟隐患）。

## 6. 渲染（Electron + PixiJS）

- `PixiBackend`：`setTexture([imgid,slot,color])` 绑定 slot→imgid 纹理；`drawTexture([tex,layer,srcX,srcY,srcW,srcH,dstX,dstY])` 按 op3-6=源裁剪、op7/op8=目标位置 1:1 贴；场景切换（脚本名变化）清空绘制层。
- 视口 1280×720；窗口 `useContentSize:true` + `win.setContentSize(1280,720)`；`autoDensity + devicePixelRatio`（canvas CSS 1280×720、底层按 DPR 高清）。CSP 含 `unsafe-eval`（Pixi v8 需要）+ `img-src`/`blob:`。
- ✅ `image(id)` IPC → `resolveEntry(id)` → AGF 字节 → `decodeAgfRgba` → RGBA 给 renderer。
- ⚠️ 沙箱/无头环境跑 Electron 需 `--no-sandbox`；GPU 进程只加 `--no-sandbox` 时不崩（WebGL 可用）。

## 6b. 输入子系统（鼠标）

- **`InputManager`**（`src/vm/input.ts`）：光标位置（虚拟 1280×720）、鼠标按钮（bit0/1）、按下沿、**移动标记（`mouseMoved`，供 hover 派发）**、回调跳转目标（`mouseJump`/`joyJump[]`）、输入掩码（`flush()`）。
- **已实现 opcode**（`src/vm/ops.ts`）：`0x108`(读鼠标按钮→op1)、`0x109`(读鼠标位置→op1/op2)、`0xCC`(mouse_callback 注册)、`0xFB`(joy_callback 注册)、`0xCD`(get-input-type 派发：移动/点击皆派发，并**压返回地址**回循环)、`0x12E`(悬停命中 point-in-rect)、`0x100`/`0xFF`/`0x101`(掩码派发/重置/刷清)。
- **DOM 捕获**：`PixiBackend.create(status, input)` 监听 canvas `mousemove/mousedown/mouseup/mouseleave` 写入 `InputManager`（左=bit0、右=bit1；`contextmenu` 阻止默认）。HUD 显示 `mouse=(x,y) btn=L/R`。
- 测试 `test/input.test.ts`（InputManager 单元 + TITLE hover/点击派发端到端，含 `0x12E` 悬停索引断言）。**语义见 `../03-engine/input-system.md` §11**。
- `0x2FC`(读鼠标触点+坐标)、`0x12E`(悬停命中 point-in-rect，**几何来自脚本数据** local5/local69/local cd，引擎不写死) 已实现；**hover 高亮**随光标移动可工作且可回退。
- **hover 高亮叠层回退**：标题的高亮叠层（`0x12c/0x12e/0x130/0x132/0x134`）经 `0x203 set-draw-color-alpha` 控制 alpha；修正了 `0x203` 的读参（**op3=alpha、op4=color → ARGB**，此前误把 op3 当整色），并让 `PixiBackend#itemAlpha` 在**无动画窗时也尊重显式设色的 alpha**（`colorSet`），从而叠层能淡入/淡出（hover 可回退）。
- `0x1F7 texture-op` 已实现（映射 `native.textureOp(handle,mode)`，标记图元重渲染），不再走 `unhandled`。「unhandled」的 `0x1ff/0x341/0x345/0x34e/0x308/0x1f8` 是 M0「记录后放行」桩（boot/TITLE setup 的 L2D/模型/注册/造纹理 op），为跑到 TITLE 而未硬报错；如需严格可后续实现。
- **交互运行**：进入 TITLE 后**不再按步数/`titleSteps` 自动截止**（脚本退出/重置/错误/关窗才收尾）；`MAX_STEPS` 仅作病态死循环兜底。TITLE 后**停止逐条步进日志**（避免交互运行日志爆炸），只记关键事件（`[input]`/`[input-state]`/错误/脚本切换）。

### 诊断法（无法搜到 `op=0x12e` 时）
在 `.tmp/amayui-emulator.log`：
- 搜 `[input] move/down` → DOM 鼠标事件是否到达 `InputManager.setCursor`；
- 搜 `[input-state] hasCursor=… moved=…` → VM 侧 InputManager 实况；
- 若无 `[input]` 且 `hasCursor=0` → 鼠标事件没进 renderer（DOM/焦点问题）；
- 若有 `[input]`/`moved=1` 却仍无 `op=0x12e` → 后续查 get-input-type 派发。
- ⚠️ **点击选中菜单项**仍依赖菜单派发表 `0xA1/0xA2/0xA3`（当前安全桩）；`0x20C/0xB5/0x23D/0x32B`（图形/声音清理）为 no-op 桩。如需完整菜单交互另见 `../03-engine/input-system.md`。
- ⚠️ **opcode 名称同步**：`src/opcodes.ts` 已把语义化名 `texture-op`/`float-mov`/`create-mesh`/`wait`/`poll-input` 等从 `u00xxxxxx` 别名改为语义名（对齐 `src/*.txt` 与 `../03-engine/opcode-table.md`）。

## 7. 命令

```bash
npm test            # 解析 vs 文本 + boot 管线级
npm run build       # tsc
npm run run         # tsx src/run.ts（无界面）
npm run electron:dev  # build + 启动 Electron 渲染壳
```

## 8. 待办/未解（属引擎方向）

- 角色图层（标题左侧角色立绘来源未定位）；视频（TITLE.MTN，步骤 2）；Live2D（SO004A）。
- 输入：**输入子系统（鼠标位置/按钮/回调/派发/掩码）已实现**（见 §6b）；**标题菜单"内容选择"（UI 命中测试 `0x2FC` + 菜单派发表）仍属未解**，需消息/UI 子系统。
- 详见 `../03-engine/`（尤其 `resource-loading.md`、`rendering.md`、`input-system.md`）。

## 9. 权威事实来源

- 逆向结论：`../03-engine/`；`engine/engine.hpp`（`this` 模型）、`engine/天结_unpacked.exe_utf8.c`（反编译源，唯一分析基准）。
- 本工程不再引用旧的逆向散篇或进度文档（已并入上述）；里程碑/进度记录仅作工程内部留存，不作新来源。
