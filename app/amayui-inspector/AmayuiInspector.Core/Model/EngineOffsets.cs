namespace AmayuiInspector.Core.Model;

/// <summary>
/// 引擎对象 `this` 的关键字节偏移 —— 全部来自 <c>engine/engine.hpp</c> 的 static_assert 锁定值，
/// 并已与 <c>docs/re/engine/05/07/08</c> 核对一致。宿主（64 位）读 32 位目标，地址域为 32 位。
/// </summary>
public static class EngineOffsets
{
    // ---- 全局 variant 数组基址（各基址即运行时数组起始地址的 32 位值）----
    public const uint GlobalIntBase = 0x5D800;
    public const uint GlobalFloatBase = 0x5D808;
    public const uint GlobalStringBase = 0x5D810;
    public const uint GlobalPtrBase = 0x5D818;
    public const uint GlobalFloatPtrBase = 0x5D820;

    // ---- 解混淆 key ----
    public const uint Key = 0x5EC8C;

    // ---- 控制流寄存器（帧下标或哨兵 -1/-10/-11）----
    public const uint CurScript = 0x5D880;
    public const uint CallRet = 0x5D884;
    public const uint CallLink = 0x5D888;
    public const uint CallFlag = 0x5D88C;

    // ---- 脚本帧数组 ----
    public const uint Frames = 0x5D880;          // 帧 0 基址（字节偏移；★曾误记 0x5D894 —— 那只是 frame0 的 str_table 槽 = 帧+0x14）
    public const uint FrameStride = 0x78;        // 每帧 0x78 = 120 字节
    public const int FrameCount = 40;            // 0..39

    // ---- 帧内字段偏移（相对帧基址 this+0x5D880+0x78*cur）----
    public const uint FrameStrTable = 0x14;          // 字符串表/脚本缓冲基址（loader: 120*cur+383124）
    public const uint FrameIp = 0x18;                // 当前指令指针（loader: 120*cur+383128）
    public const uint FrameLocalIntCount = 0x1C;     // 6 个局部池元素数
    public const uint FrameLocalFloatCount = 0x20;
    public const uint FrameLocalStringCount = 0x24;
    public const uint FrameLocalPtrCount = 0x28;
    public const uint FrameLocalFloatPtrCount = 0x2C;
    public const uint FrameLocalStringPtrCount = 0x30;
    public const uint FrameLocalInt = 0x34;
    public const uint FrameLocalFloat = 0x38;
    public const uint FrameLocalString = 0x3C;
    public const uint FrameLocalPtr = 0x40;
    public const uint FrameLocalFloatPtr = 0x44;
    public const uint FrameLocalStringPtr = 0x48;    // operand type 14，元素 28 字节
    public const uint FrameCaller = 0x4C;            // 返回链接
    public const uint FrameArg = 0x50;               // 本帧传入参数（call-script 时=脚本 id）
    public const uint FrameArity = 0x60;             // 指令长度（dword，含 opcode；loader 清零）
    public const uint FrameOperandCount = 0x74;      // ★操作数记数槽：值=2*argc+1；主循环 ip += 4*本槽
    public const uint FrameArrayContainer = 0x84;    // 每脚本数组容器

    // ---- opcode → handler 分发表 ----
    public const uint DispatchTable = 0x0A509C;      // 一维函数指针表
    public const uint DispatchCount = 0x400;         // 上限 0x400（越界落默认 handler）
    public const uint DefaultHandlerVA = 0x418E30;

    // ---- 掉落区（VM 抽象索引，非进程地址）：global-int 数组下标区间 ----
    public const uint DropItemStart = 0x53CD7C;      // item：[0x53CD7C, 0x53E104)
    public const uint DropRateStart = 0x53E104;      // rate：[0x53E104, 0x53F48C)
    public const uint DropEnd = 0x53F48C;
}
