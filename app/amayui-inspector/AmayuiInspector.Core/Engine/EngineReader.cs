using AmayuiInspector.Core.Decode;
using AmayuiInspector.Core.Model;
using AmayuiInspector.Core.Scan;

namespace AmayuiInspector.Core.Engine;

/// <summary>
/// 引擎语义读取器：给定已定位的 <c>this</c>，读全局基址/key、控制流寄存器、40 帧字段，并做 DEC 解码。
/// 依赖 <see cref="MemoryScanner"/> 做底层内存读取；只读不改。
/// </summary>
public sealed class EngineReader
{
    private readonly MemoryScanner _scanner;

    public EngineReader(MemoryScanner scanner) => _scanner = scanner;

    /// <summary>读一次引擎快照（`this` + 全局基址/key + 控制流寄存器 + 40 帧字段）。</summary>
    public EngineSnapshot ReadSnapshot(uint thisAddr, uint moduleBase)
    {
        uint intBase = Read(thisAddr + EngineOffsets.GlobalIntBase);
        uint floatBase = Read(thisAddr + EngineOffsets.GlobalFloatBase);
        uint strBase = Read(thisAddr + EngineOffsets.GlobalStringBase);
        uint ptrBase = Read(thisAddr + EngineOffsets.GlobalPtrBase);
        uint floatPtrBase = Read(thisAddr + EngineOffsets.GlobalFloatPtrBase);
        uint key = Read(thisAddr + EngineOffsets.Key);

        uint cur = Read(thisAddr + EngineOffsets.CurScript);
        uint callRet = Read(thisAddr + EngineOffsets.CallRet);
        uint callLink = Read(thisAddr + EngineOffsets.CallLink);
        uint callFlag = Read(thisAddr + EngineOffsets.CallFlag);

        var frames = new List<FrameSnapshot>(EngineOffsets.FrameCount);
        for (int f = 0; f < EngineOffsets.FrameCount; f++)
        {
            ulong fb = thisAddr + EngineOffsets.Frames + (ulong)EngineOffsets.FrameStride * (uint)f;
            frames.Add(new FrameSnapshot(
                f,
                Read(fb + EngineOffsets.FrameStrTable),
                Read(fb + EngineOffsets.FrameIp),
                Read(fb + EngineOffsets.FrameLocalInt),
                Read(fb + EngineOffsets.FrameLocalFloat),
                Read(fb + EngineOffsets.FrameLocalString),
                Read(fb + EngineOffsets.FrameLocalPtr),
                Read(fb + EngineOffsets.FrameLocalFloatPtr),
                Read(fb + EngineOffsets.FrameCaller),
                Read(fb + EngineOffsets.FrameArg),
                Read(fb + EngineOffsets.FrameArity),
                Read(fb + EngineOffsets.FrameArrayContainer)));
        }

        return new EngineSnapshot(
            thisAddr, moduleBase,
            intBase, floatBase, strBase, ptrBase, floatPtrBase,
            key, cur, callRet, callLink, callFlag,
            frames);
    }

    /// <summary>读取 global-int 数组的某一 VM 索引，并 DEC 解码。</summary>
    public uint ReadGlobalIntDecoded(uint globalIntBase, uint key, uint index)
    {
        uint raw = Read((ulong)globalIntBase + (ulong)index * 4);
        return Dec.Decode(raw, key);
    }

    /// <summary>
    /// 读取掉落静态表样本（global-int VM 索引区间）。返回每个 slot 的 (unit, slot, item, rate)，
    /// 其中 item 来自 [DropItemStart, DropRateStart)、rate 来自 [DropRateStart, DropEnd)，每单位 5 槽。
    /// </summary>
    public List<(uint Unit, int Slot, uint Item, uint Rate)> ReadDropSample(uint globalIntBase, uint key, uint unitStart, uint unitCount)
    {
        var list = new List<(uint, int, uint, uint)>();
        for (uint u = unitStart; u < unitStart + unitCount; u++)
        {
            for (int s = 0; s < 5; s++)
            {
                uint idx = u * 5 + (uint)s;
                uint item = ReadGlobalIntDecoded(globalIntBase, key, EngineOffsets.DropItemStart + idx);
                uint rate = ReadGlobalIntDecoded(globalIntBase, key, EngineOffsets.DropRateStart + idx);
                list.Add((u, s, item, rate));
            }
        }
        return list;
    }

    private uint Read(ulong addr)
    {
        _scanner.TryReadUInt32(addr, out uint v);
        return v;
    }
}
