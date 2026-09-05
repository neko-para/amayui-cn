# 04-app · amayui-emulator

用 **TypeScript + Electron** 重写《天結いキャッスルマイスター》的 AGE 引擎 VM（解释器），把 `engine/engine.cpp` 的逻辑以干净 TS 语义实现，替换原 Win32 调用为 H5/IPC，获得**更好的可调试性、可观测性、可插件化与跨平台**。

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

## 7. 命令

```bash
npm test            # 解析 vs 文本 + boot 管线级
npm run build       # tsc
npm run run         # tsx src/run.ts（无界面）
npm run electron:dev  # build + 启动 Electron 渲染壳
```

## 8. 待办/未解（属引擎方向）

- 角色图层（标题左侧角色立绘来源未定位）；视频（TITLE.MTN，步骤 2）；Live2D（SO004A）；输入（菜单可选）。
- 详见 `../03-engine/`（尤其 `resource-loading.md`、`rendering.md`）。

## 9. 权威事实来源

- 逆向结论：`../03-engine/`；`engine/engine.hpp`（`this` 模型）、`engine/engine.cpp`（语义参考）。
- 本工程不再引用旧的逆向散篇或进度文档（已并入上述）；里程碑/进度记录仅作工程内部留存，不作新来源。
