# amayui-inspector

桌面进程内存查看器：识别 AGE 引擎进程，定位 VM 解释器 `this`，提取并可视化其状态机数据。
技术选型（已确认）：**C# / .NET 10 + WPF**；刷新**仅手动快照**；范围**先只读查看器**。
详细技术方案见 [`docs/技术方案.md`](docs/技术方案.md)。

## 当前进度

- **M1 核心读取（无 UI）**：已完成并验证 —— Core 库 + CLI 冒烟（见下）。
- **M2 最小 WPF 壳**：已完成 —— 进程选择 + Engine 面板 + 全局表（搜索/过滤/范围）+ 脚本帧/调用栈；`Task.Run` + Dispatcher 手动快照。

```
app/amayui-inspector/
├─ AmayuiInspector.Core/            # 引擎读取核心（net10.0 类库）
│  ├─ Decode/Dec.cs                 # DEC/ENC（ROL/ROR + key）；自校验 RoundTripOk
│  ├─ Model/EngineOffsets.cs        # 全部已确认偏移（engine/engine.hpp static_assert）
│  ├─ Model/EngineSnapshot.cs       # EngineSnapshot / FrameSnapshot 快照记录
│  ├─ Interop/Win32.cs              # OpenProcess/ReadProcessMemory/VirtualQueryEx/EnumProcessModules
│  ├─ Process/ProcessLocator.cs     # 枚举/匹配目标进程（AGE*/unpacked/天結）
│  ├─ Process/Modules.cs            # 枚举模块取 image base
│  ├─ Engine/Fingerprint.cs         # 载入 dispatch_signature.json
│  ├─ Engine/EngineReader.cs        # 读 this/全局基址/key/控制符/40帧/掉落表
│  └─ Scan/MemoryScanner.cs         # 分块读 + dispatch 表 RVA 指纹定位 `this`
├─ AmayuiInspector.Cli/             # net10.0 控制台冒烟（M1 冒烟）
│  └─ Program.cs                    # 自检 + 扫进程 + 快照 + 掉落样本
├─ AmayuiInspector.App/             # net10.0-windows WPF 壳（M2）
│  ├─ Services/EngineSession.cs     # 打开进程→定位 this→读快照/解码全局 int
│  ├─ ViewModels/                   # MainViewModel · EnginePanelVm · GlobalTableVm · FrameStackVm
│  └─ Views/                        # MainWindow · EnginePanel · GlobalTableControl · FrameStackControl
└─ docs/
```

## 构建 / 运行

```powershell
# 一键构建（Core + Cli + App）并跑 M1 自检：
pwsh -File app/amayui-inspector/build.ps1

# 打开 WPF 壳：
dotnet app/amayui-inspector/AmayuiInspector.App/bin/Debug/net10.0-windows/AmayuiInspector.App.dll
# 或直接运行生成的 exe：
& app/amayui-inspector/AmayuiInspector.App/bin/Debug/net10.0-windows/AmayuiInspector.App.exe
```

**WPF 壳用法**：下拉选进程 →「扫描 this」（定位 `this`，填充 Engine 面板）→「刷新快照」重读当前状态；
「全局表」按 过滤(仅非空/仅掉落区/全部)/范围(hex) 加载解码后的 global-int，支持**「全量」**(0..区段末，≈8M 槽)与**分页**，避免一次物化过多行；「脚本帧」展示 40 帧字段（高亮当前帧）。

CLI 用法：

```powershell
# 自检（不扫进程）
dotnet AmayuiInspector.Cli/bin/Debug/net10.0/AmayuiInspector.Cli.dll --no-process --sig scripts/re/dispatch_signature.json
# 扫运行中的目标（默认自动找 AGE*/unpacked/天結）
dotnet AmayuiInspector.Cli/bin/Debug/net10.0/AmayuiInspector.Cli.dll --sig scripts/re/dispatch_signature.json
# 指定进程
dotnet AmayuiInspector.Cli/bin/Debug/net10.0/AmayuiInspector.Cli.dll -p <pid> --sig scripts/re/dispatch_signature.json
# 额外：全量 global-range 校验（报告区段槽数上限 + 非空命中数）
dotnet AmayuiInspector.Cli/bin/Debug/net10.0/AmayuiInspector.Cli.dll -n AGE --sig scripts/re/dispatch_signature.json --fullglobal
```

## 验证结果（对本机正在运行的 `install\AGE.EXE`）

- **`this` 定位成功**：`0x2FDC020`（模块基址 `0x400000`，指纹命中一次即停）。
- **DEC 正确性**：单位 140/141 掉落样本 `item=2813 / rate=100` —— 与 `docs/re/engine/07` §6 实测一致，证明「指纹定位 + 基址/key 读取 + DEC」整条链路正确。
- **控制流/帧模型**：`cur_script=1`、帧 37 `caller=0xFFFFFFF6(-10)`、`frame_arg=0x05000000((槽+1)<<24)` —— 与 `docs/re/engine/08` §3.3/§3.4 的「-10 续跑 + 帧37 派发」语义吻合。
- **自检**：`DEC(ENC(x))==x` OK；偏移与 `engine.hpp` 一致（int=0x5D800 … dispatch=0xA509C）。

## 依赖/环境

- **工具链**：.NET **10** SDK（10.0.400）+ 运行时（10.0.11）+ `Microsoft.WindowsDesktop.App 10.0.11`（WPF 用）。离线构建、无外网依赖。
- **跨位数读取**：宿主 x64、目标 x86 32 位，已验证可行（x64 `MEMORY_BASIC_INFORMATION`）。
- **本沙箱特例**：dotnet CLI 冷启动要创建 `~\.dotnet\<版本>.*.sentinel` 三个空文件；本沙箱的 workspace 写策略**禁止写入用户主目录**，需以完整权限预创建一次（本机已为 10.0.400 预建）。普通开发机不会遇到。

> 📝 版本史：先前按方案用 .NET 8，但本机只装 **.NET 8 预览版**（8.0.0-preview.6，2023-06）且无外网、SDK 10 对 `net8.0` 需联网拉发布版引用包而失败；故改为**已装且离线可用的 .NET 10**（其余选型不变）。若日后在装有正式 .NET 8 的机器上，也可把 `TargetFramework` 改回 `net8.0` / `net8.0-windows` 无缝使用。
