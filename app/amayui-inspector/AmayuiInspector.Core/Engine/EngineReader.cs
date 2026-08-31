using System.Text;
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

    /// <summary>估算 global-int 数组可用槽数上限 = (global_int_base 所在区段末尾 − 基址) / 4。失败返回 0。</summary>
    public int MaxGlobalSlots(uint globalIntBase)
    {
        ulong end = _scanner.RegionEnd(globalIntBase);
        if (end <= globalIntBase) return 0;
        return (int)Math.Max(0, (end - globalIntBase) / 4);
    }

    /// <summary>批量读取并解码 <paramref name="count"/> 个 global-int 槽（从 VM 索引 <paramref name="from"/> 起），逐块读，于区段边界截断。</summary>
    public uint[] ReadGlobalIntsRange(uint globalIntBase, uint key, uint from, int count)
    {
        var result = new uint[count];
        const int chunk = 0x10000; // 每次 256KB
        int offset = 0;
        while (offset < count)
        {
            int take = Math.Min(count - offset, chunk);
            var bytes = _scanner.ReadBytes((ulong)globalIntBase + (ulong)(from + (uint)offset) * 4, take * 4);
            int n = (bytes?.Length ?? 0) / 4;
            for (int i = 0; i < n; i++)
                result[offset + i] = Dec.Decode(Dec.B32(bytes!, i * 4), key);
            if (n < take)
            {
                var cut = new uint[offset + n];
                Array.Copy(result, cut, offset + n);
                return cut;
            }
            offset += take;
        }
        return result;
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

    // ------------------------------------------------------------------
    // global-string（SSO）读取：元素 = 28 字节 EngineString
    //   +0x00 data（length<0x10 → 内联字符[≤15]；否则 = 堆指针）
    //   +0x10 保留   +0x14 length   +0x18 capacity
    // 内容为 SJIS(CP932) 字节；CN 补丁用 subs_cn_jp 把简体码到 cp932 可编码码位，
    // 运行时存的是这些码位字节（字形由字体替换显示）。
    // ------------------------------------------------------------------
    private static readonly Encoding _sjis = InitSjis();

    private static Encoding InitSjis()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance); // .NET Core 注册旧码页
        return Encoding.GetEncoding(932); // CP932 / Shift-JIS
    }

    /// <summary>读取 global-string 数组的某个槽（SSO 解码）；空/无效返回 null。</summary>
    public string? ReadGlobalString(uint globalStringBase, uint index)
    {
        var elem = _scanner.ReadBytes((ulong)globalStringBase + (ulong)index * 28, 28);
        if (elem == null || elem.Length < 28) return null;
        return DecodeString(elem);
    }

    /// <summary>读取一段 global-string 槽，返回非空（索引, 文本）对。</summary>
    public List<(uint Index, string Text)> ReadGlobalStrings(uint globalStringBase, uint from, int count)
    {
        var list = new List<(uint, string)>();
        for (int i = 0; i < count; i++)
        {
            uint idx = from + (uint)i;
            var s = ReadGlobalString(globalStringBase, idx);
            if (!string.IsNullOrEmpty(s)) list.Add((idx, s));
        }
        return list;
    }

    private string DecodeString(byte[] elem)
    {
        uint length = Dec.B32(elem, 0x14);
        if (length == 0 || length == uint.MaxValue) return "";

        byte[] bytes;
        if (length < 0x10)
        {
            bytes = elem[..(int)length];                 // 内联小串：字符在头部
        }
        else
        {
            uint heap = Dec.B32(elem, 0x00);             // 长串：+0 是堆指针
            if (heap == 0) return "";
            int n = (int)Math.Min(length, 4096);         // 防越界/超长读
            var rb = _scanner.ReadBytes(heap, n);
            if (rb == null || rb.Length == 0) return "";
            bytes = rb;
        }

        string s = _sjis.GetString(bytes);
        int z = s.IndexOf('\0');
        if (z >= 0) s = s[..z];
        return s;
    }
}
