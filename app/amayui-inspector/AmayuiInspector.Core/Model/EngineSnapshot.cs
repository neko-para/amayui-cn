namespace AmayuiInspector.Core.Model;

/// <summary>目标进程的主模块（取 image base）。</summary>
public sealed record ModuleInfo(long BaseAddress, string Name);

/// <summary>单个脚本帧（0x78 / 120 字节）的已确认字段快照。未标定区不读取。</summary>
public sealed record FrameSnapshot(
    int Index,
    uint StrTable,
    uint Ip,
    uint LocalInt,
    uint LocalFloat,
    uint LocalString,
    uint LocalPtr,
    uint LocalFloatPtr,
    uint Caller,
    uint FrameArg,
    uint Arity,
    uint ArrayContainer);

/// <summary>一次「手动快照」得到的引擎状态：`this` + 全局基址/key + 控制流寄存器 + 40 帧。</summary>
public sealed record EngineSnapshot(
    uint This,
    uint ModuleBase,
    uint GlobalIntBase,
    uint GlobalFloatBase,
    uint GlobalStringBase,
    uint GlobalPtrBase,
    uint GlobalFloatPtrBase,
    uint Key,
    uint CurScript,
    uint CallRet,
    uint CallLink,
    uint CallFlag,
    IReadOnlyList<FrameSnapshot> Frames);
