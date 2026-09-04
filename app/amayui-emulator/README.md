# amayui-emulator

用 **TypeScript + Electron** 重写《天結いキャッスルマイスター》的 AGE 引擎 VM（解释器），把 `engine/engine.cpp` 的逻辑以干净的 TS 语义实现，替换原 Win32 调用为 H5 / IPC，从而获得**更好的可调试性、可观测性、可插件化，并实现跨平台**。

> 本目录是**该重写工程的根**：`docs/` 记录方案/背景/决策，`src/`（新建）放实现代码。

---

## 定位与现状

- **当前阶段**：**M0–M3 里程碑已达到**——解释器已能从 `SYSTEM4.BIN`（index 0）一路执行，经过全部数据表 INIT 脚本（AMINIT2 / WDINIT / ALINIT / EBINIT / ITINIT / SKINIT / CGINIT / BTANINIT2…），正确运行到 **`TITLE.BIN`（622 条指令）执行点**——这是 `docs/03` 的第一里程碑。`npm test` 12/12 通过（含 5 条指针模型测试），`tsc` 干净。TITLE 其后进入 Live2D/消息主循环（`setL2DMOC`、等待输入），M0 无界面 stub 使其停在消息循环，属预期。
- **第一里程碑**（对应 `docs/03` 的 M0–M3）：**在无任何界面层输入/输出的前提下，让解释器执行启动链，并正确运行到 `src/TITLE.txt`（游戏开始界面脚本）的执行点。**（✅ 已达成）
- **技术前提（用户已确认）**：JS 可安全操作 2^53 内的整数/double，除非引擎使用 int64——当前引擎为 x86 32 位，未见 int64，故可用 `number`（配合显式 32 位位运算）。

---

## 快速导航

| 文档 | 内容 |
|---|---|
| [`docs/01-background.md`](./docs/01-background.md) | 引擎是什么、逆向已解/未解、对重写的影响 |
| [`docs/02-architecture-decisions.md`](./docs/02-architecture-decisions.md) | 关键架构决策（ADR）：启动层级、对象模型、NativeBridge、未实现 opcode 硬报错、32 位语义、BIN 读取器、**函数级状态追踪（ADR-010）** |
| [`docs/03-development-plan.md`](./docs/03-development-plan.md) | 分阶段里程碑 M0–M5 + 完成定义（DoD）+ 依赖图 |
| [`docs/04-boot-chain-analysis.md`](./docs/04-boot-chain-analysis.md) | 启动链实证（SYSTEM4→…→TITLE）+ opcode 清点 + 分类方法 |
| [`docs/06-function-status-registry.md`](./docs/06-function-status-registry.md) | **函数级状态追踪注册表**（ADR-010：每个原函数重写状态 + 确认忽略的证据/复核） |
| [`docs/07-pointer-operand-model.md`](./docs/07-pointer-operand-model.md) | **指针操作数模型**（ADR-011）：`lea`/`lookup-array`/`memcpy` 的模拟隐患——指针=带标记引用，读解引用/写写穿，不当数值 |
| [`docs/08-render-backend.md`](./docs/08-render-backend.md) | **渲染后端选型**：Canvas 2D 起步 + WebGL2 预留；窗口/文件流/渲染壳已接到 Electron |
| [`docs/09-data-model-and-reading-logic.md`](./docs/09-data-model-and-reading-logic.md) | **数据模型与读取逻辑**：本体 SYS4INI + 5 个 APPEND.AAI 统一文件 id 空间合并；引擎读取函数链；初始化调用链；纹理 id→图像 id 映射机制；标题图像来源(LOGO.txt) |
| [`docs/10-texture-slot-to-agf-file.md`](./docs/10-texture-slot-to-agf-file.md) | **纹理 slot ↔ AGF 文件**：`set-texture <imgid> <slot>` 是唯一绑定，`[5*slot+466]=imgid`，imgid→resolveEntry→文件名；并与 draw-texture 的 tex 句柄区分 |
| [`docs/11-fadetimer-and-fade-opcodes.md`](./docs/11-fadetimer-and-fade-opcodes.md) | **淡入淡出实现**：FadeTimer 步进计时器结构 + fade opcode 家族 0x20–0x38（SetFade/SetLineFade/SetRandomFade） |

---

## 一句话架构

```
[主进程]  NativeBridge 壳（文件/归档/未来渲染+音频真实现，经 IPC）
   ▲ IPC
[渲染进程] 解释器核心 (纯 TS)
   - Engine / ScriptContext 对象
   - dispatch[opcode] 分发表（可注入 = 插件点）
   - 读写原语 (readInt/Float, writeInt/Float, DEC/ENC)
   - NativeBridge 调用（当前==stub）
```

- **文件访问全部走异步代理 `FileSource`**（`src/arch/fileSource.ts` 接口；宿主用 `NodeFileSource`，将来 renderer 换 `IpcFileSource`）。
- **插件点** = `dispatch[]` 可替换（ADR-009，后置）。
- **观测点** = 解释器步进 hook（每帧/每指令回调，供日志/调试/校验）。

## 目录结构

```
app/amayui-emulator/
├─ docs/            # 背景/ADR/计划/启动链分析/函数注册表/渲染后端
├─ electron/        # Electron 壳：main.ts(主进程+文件IPC) / preload.ts(contextBridge)
├─ src/
│  ├─ arch/         # FileSource 抽象 + Node 实现（异步文件代理）
│  ├─ renderer/     # IpcFileSource + PixiBackend(PixiJS v8 WebGL 渲染后端) + renderer.ts(入口)
│  ├─ script/       # lzss / alf(索引) / bin(SYS4450 解析) / opcodes 表
│  ├─ util/         # 字节读取
│  └─ vm/           # engine / operand(DEC·ENC) / ops / interpreter / native(stub)
├─ test/            # xval(解析vs文本) + boot(管线级)
└─ package.json     # npm run = 启动；npm test = 测试；electron:dev = 构建+渲染壳
```

## 权威事实来源（本工程其它目录）

- 逆向文档：[`docs/re/engine/`](../../../docs/re/engine/)（15 篇）
- opcode→handler 全量表：[`docs/re/engine/06-opcode到handler映射表.md`](../../../docs/re/engine/06-opcode到handler映射表.md)
- `this` 对象模型：[`engine/engine.hpp`](../../../engine/engine.hpp)
- 重定型成员化视图（语义参考）：[`engine/engine.cpp`](../../../engine/engine.cpp)
- 脚本反汇编：[`src/*.txt`](../../../src/)；松散字节码 BIN：[`raw/`](../../../raw/)；ALF 提取：[`raw-parts/`](../../../raw-parts/)

---

## 进度看板

（实施者在此勾选，`docs/03` 同源。每次完成一里程碑更新。）
- [x] M0 代码骨架 + BIN 读取器 —— 已完成：异步 FileSource 代理 + SYS4450 解析 + 最小解释器步进（解析 vs `src/*.txt` 逐条一致测试全绿）
- [ ] M1 VM 核心解释器 —— **进行中**：文件策略改为只依赖 `raw/`（松散优先，否则 ALF 切片）；SYSTEM4 初始化段已越过并进入 call-script 链；新增「引擎内部/子系统 → 插桩跳过」（~24 opcode 已读体归类）
- [ ] M2 启动链 opcode 清点/分类
- [ ] M3 无界面跑到 TITLE（第一里程碑）
- [ ] M4 差分验证
- [ ] M5 子系统真实现
