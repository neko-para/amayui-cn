using System.Runtime.InteropServices;
using AmayuiInspector.Core.Decode;
using AmayuiInspector.Core.Engine;
using AmayuiInspector.Core.Interop;
using AmayuiInspector.Core.Model;

namespace AmayuiInspector.Core.Scan;

/// <summary>
/// 进程内存读取器：提供按地址读字节/读 dword 的封装，以及「dispatch 表 RVA 指纹」扫描定位 `this`。
/// 只读不改（OpenProcess 仅 PROCESS_VM_READ|QUERY_INFORMATION）。
/// </summary>
public sealed class MemoryScanner : IDisposable
{
    public const ulong MaxRegion = 64UL * 1024 * 1024; // 与 extract_global_data.ps1 一致：只扫 <64MB 的普通提交区

    private readonly IntPtr _handle;
    private bool _disposed;

    public MemoryScanner(IntPtr processHandle) => _handle = processHandle;

    /// <summary>
    /// Approach-B：在提交/可读区扫描「连续 opcode→handler 指针」的指纹，命中即得 <c>this = 表址 − 0x0A509C</c>。
    /// 期望指针 = moduleBase + (VA − PreferredBase)，兼容 ASLR。命中一次即停（this 为单实例）。
    /// </summary>
    /// <returns>找到则返回 `this` 地址，否则 0。</returns>
    public uint FindThis(ulong moduleBase, DispatchSignature sig)
    {
        int anchor = sig.AnchorOp;
        if (!sig.Samples.ContainsKey(anchor))
            throw new InvalidOperationException($"signature lacks anchor op 0x{anchor:X}");
        if (sig.Samples.Keys.Any(k => k > 0x3FF))
            throw new InvalidOperationException("signature contains opcode >= 0x400");

        ulong anchorAddr = moduleBase + (sig.Samples[anchor] - sig.PreferredBase);
        int maxOp = sig.Samples.Keys.Max();

        ulong addr = 0;
        var mbi = new Win32.MBI();
        while (true)
        {
            bool q = Win32.VirtualQueryEx(_handle, (IntPtr)(long)addr, out mbi, Marshal.SizeOf<Win32.MBI>());
            if (!q) break;

            ulong regionBase = (ulong)mbi.BaseAddress;
            ulong regionSize = (ulong)mbi.RegionSize;
            if (regionSize == 0) break;

            ulong next = regionBase + regionSize;
            if (next <= addr) next = addr + 0x1000; // 防平台在地址回绕时的死循环

            bool noAccess = (mbi.Protect & 0xFF) == Win32.PAGE_NOACCESS;
            bool guard = (mbi.Protect & Win32.PAGE_GUARD) != 0;
            bool isCommit = mbi.State == Win32.MEM_COMMIT;

            if (isCommit && !noAccess && !guard && regionSize < MaxRegion && regionSize > 0x1000)
            {
                byte[] buf = new byte[(int)regionSize];
                if (Win32.ReadProcessMemory(_handle, (IntPtr)(long)regionBase, buf, (int)regionSize, out IntPtr rBytes))
                {
                    long nr = rBytes.ToInt64();
                    // 校验整个表都落在本区读到的数据内，避免数组越界
                    for (long o = 0; o <= nr - 4; o += 4)
                    {
                        if (Dec.B32(buf, (int)o) != (uint)anchorAddr) continue;
                        long ts = o - 4L * anchor;          // 分发表起始（相对区基址）
                        if (ts < 0) continue;
                        if (ts + 4L * maxOp + 4 > nr) continue; // 表不完整（越区），跳过

                        bool ok = true;
                        foreach (var (op, va) in sig.Samples)
                        {
                            uint expected = (uint)(moduleBase + (va - sig.PreferredBase));
                            if (Dec.B32(buf, (int)(ts + 4L * op)) != expected) { ok = false; break; }
                        }
                        if (ok)
                        {
                            ulong table = regionBase + (ulong)ts;
                            return (uint)(table - EngineOffsets.DispatchTable);
                        }
                    }
                }
            }

            if (next <= regionBase) break;
            addr = next;
        }
        return 0;
    }

    /// <summary>尝试读 <paramref name="length"/> 字节；失败或读不足返回 null。</summary>
    public byte[]? ReadBytes(ulong addr, int length)
    {
        var buf = new byte[length];
        if (!Win32.ReadProcessMemory(_handle, (IntPtr)(long)addr, buf, length, out IntPtr r))
            return null;
        long nr = r.ToInt64();
        if (nr <= 0) return null;
        if (nr < length)
        {
            var trimmed = new byte[nr];
            Array.Copy(buf, trimmed, nr);
            return trimmed;
        }
        return buf;
    }

    /// <summary>读一个 32 位值；失败返回 false（out=0）。</summary>
    public bool TryReadUInt32(ulong addr, out uint value)
    {
        value = 0;
        var b = ReadBytes(addr, 4);
        if (b == null || b.Length < 4) return false;
        value = Dec.B32(b, 0);
        return true;
    }

    /// <summary>返回 <paramref name="addr"/> 所在可提交区段的结束地址（含），用于估算数组可用长度；失败返回 0。</summary>
    public ulong RegionEnd(ulong addr)
    {
        bool q = Win32.VirtualQueryEx(_handle, (IntPtr)(long)addr, out var mbi, Marshal.SizeOf<Win32.MBI>());
        if (!q) return 0;
        return (ulong)mbi.BaseAddress + (ulong)mbi.RegionSize;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
    }
}
