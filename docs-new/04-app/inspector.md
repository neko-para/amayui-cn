# 04-app · amayui-inspector

桌面进程内存查看器：识别 AGE 引擎进程，定位 VM 解释器 `this`，提取并可视化其状态机数据。
技术选型（已确认）：**C#/.NET 10 + WPF**；刷新**仅手动快照**；范围**先只读查看器**。

## 1. 构架

```
app/amayui-inspector/
├─ AmayuiInspector.Core/   # 引擎读取核心（net10.0 类库）
│  ├─ Decode/Dec.cs        # DEC/ENC（ROL/ROR + key）；自校验 RoundTripOk
│  ├─ Model/EngineOffsets.cs# 全部已确认偏移（engine.hpp static_assert）
│  ├─ Model/EngineSnapshot.cs
│  ├─ Interop/Win32.cs     # OpenProcess/ReadProcessMemory/VirtualQueryEx/EnumProcessModules
│  ├─ Process/ProcessLocator.cs  # 枚举/匹配（AGE*/unpacked/天結）
│  ├─ Process/Modules.cs   # 枚举模块取 image base
│  ├─ Engine/Fingerprint.cs# 载入 dispatch_signature.json
│  ├─ Engine/EngineReader.cs# 读 this/全局基址/key/控制符/40帧/掉落表
│  └─ Scan/MemoryScanner.cs# 分块读 + dispatch 表 RVA 指纹定位 this
├─ AmayuiInspector.Cli/    # net10.0 控制台冒烟（M1）
└─ AmayuiInspector.App/    # net10.0-windows WPF 壳（M2）
   ├─ Services/EngineSession.cs
   ├─ ViewModels/          # MainViewModel · EnginePanelVm · GlobalTableVm · FrameStackVm
   └─ Views/               # MainWindow · EnginePanel · GlobalTableControl · FrameStackControl
```

## 2. 进度

- **M1 核心读取（无 UI）**：Core 库 + CLI 冒烟完成并验证。
- **M2 最小 WPF 壳**：进程选择 + Engine 面板 + 全局表（搜索/过滤/范围）+ 脚本帧/调用栈；`Task.Run` + Dispatcher 手动快照。

## 3. 构建 / 运行

```powershell
pwsh -File app/amayui-inspector/build.ps1               # 一键构建（Core+Cli+App）+ M1 自检
& app/amayui-inspector/AmayuiInspector.App/bin/Debug/net10.0-windows/AmayuiInspector.App.exe

# CLI：
dotnet AmayuiInspector.Cli/bin/Debug/net10.0/AmayuiInspector.Cli.dll --no-process --sig scripts/re/dispatch_signature.json
dotnet AmayuiInspector.Cli/bin/Debug/net10.0/AmayuiInspector.Cli.dll --sig scripts/re/dispatch_signature.json
dotnet ... -n AGE --sig ... --fullglobal
```

## 4. 验证结果（对本机 `install\AGE.EXE`）

- **`this` 定位**：`0x2FDC020`（模块基址 `0x400000`，指纹命中一次即停）。
- **DEC 正确性**：单位 140/141 掉落样本 `item=2813/rate=100`——与 `03-engine` 坠落结论一致，证明「指纹定位 + 基址/key 读取 + DEC」链路正确。
- **控制流/帧**：`cur_script=1`、帧 37 `caller=0xFFFFFFF6(-10)`、`frame_arg=0x05000000((槽+1)<<24)`——与 `03-engine/runtime-memory.md` 的「-10 续跑 + 帧 37 派发」吻合。
- **自检**：`DEC(ENC(x))==x` OK；偏移与 `engine.hpp` 一致（int=0x5D800 … dispatch=0xA509C）。

## 5. 依赖 / 环境

- 工具链：**.NET 10** SDK + 运行时 + `Microsoft.WindowsDesktop.App 10.0.11`（WPF），离线构建、无外网依赖。
- **跨位数读取**：宿主 x64、目标 x86 32 位，已验证可行（x64 `MEMORY_BASIC_INFORMATION`）。
- 版本史：先前选 .NET 8 但本机只有 8.0.0-preview.6 且无外网，改 .NET 10。

## 6. 交叉引用

- `this` 布局/脚本帧见 `../03-engine/runtime-memory.md`；opcode 见 `../03-engine/opcode-table.md`（真源），分发概览见 `../03-engine/vm-opcodes.md`（已归档）；数据域（掉落等）见 `../02-data/drops.md`。
- 本工具读取的 `this`/DEC/key 均为**引擎内部**；读取业务数据（掉落）属「进程内实测读取」的确切证据，故可在该处交叉引用。
