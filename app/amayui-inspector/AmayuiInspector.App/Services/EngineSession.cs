using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Diagnostics;
using AmayuiInspector.Core.Decode;
using AmayuiInspector.Core.Engine;
using AmayuiInspector.Core.Model;
using AmayuiInspector.Core.Process;
using AmayuiInspector.Core.Scan;

namespace AmayuiInspector.App.Services;

/// <summary>
/// 一次「已定位 this」的进程会话：持有 OpenProcess 句柄 + 主模块 base + this 地址 + 签名，
/// 负责定位与后续手动快照读取。未找到 this 时抛异常（进程未初始化/布局不符）。
/// </summary>
public sealed class EngineSession : IDisposable
{
    public const uint PROCESS_ACCESS = 0x0410;

    private readonly IntPtr _handle;
    private readonly MemoryScanner _scanner;

    public int ProcessId { get; }
    public string ModuleName { get; }
    public uint ModuleBase { get; }
    public uint ThisAddr { get; }
    public DispatchSignature Signature { get; }
    public uint GlobalIntBase { get; }
    public uint GlobalStringBase { get; }
    public uint Key { get; }

    private EngineSession(IntPtr handle, int pid, string moduleName, uint moduleBase, uint thisAddr, DispatchSignature signature)
    {
        _handle = handle;
        ProcessId = pid;
        ModuleName = moduleName;
        ModuleBase = moduleBase;
        ThisAddr = thisAddr;
        Signature = signature;
        _scanner = new MemoryScanner(handle);

        GlobalIntBase = ReadU32(thisAddr + EngineOffsets.GlobalIntBase);
        GlobalStringBase = ReadU32(thisAddr + EngineOffsets.GlobalStringBase);
        Key = ReadU32(thisAddr + EngineOffsets.Key);
    }

    /// <summary>读一条全局 int（VM 索引），按 key 解码。</summary>
    public uint ReadGlobalInt(uint index)
    {
        _scanner.TryReadUInt32((ulong)GlobalIntBase + (ulong)index * 4, out uint raw);
        return Dec.Decode(raw, Key);
    }

    /// <summary>读一条 global-string（SSO + CP932 解码），未命中返回 null。</summary>
    public string? ReadGlobalString(uint index)
        => new EngineReader(_scanner).ReadGlobalString(GlobalStringBase, index);

    /// <summary>估算 global-int 数组可用槽数上限 = (global_int_base 所在区段末尾 − 基址) / 4。失败返回 0。</summary>
    public int MaxGlobalSlots() => new EngineReader(_scanner).MaxGlobalSlots(GlobalIntBase);

    /// <summary>批量读取并解码 <paramref name="count"/> 个槽（从 VM 索引 <paramref name="from"/> 起），逐块读，于区段边界截断。</summary>
    public uint[] ReadGlobalIntsRange(uint from, int count)
        => new EngineReader(_scanner).ReadGlobalIntsRange(GlobalIntBase, Key, from, count);

    private uint ReadU32(ulong addr)
    {
        _scanner.TryReadUInt32(addr, out uint v);
        return v;
    }

    /// <summary>打开目标进程，枚举主模块，按 dispatch 表 RVA 指纹定位 `this`。</summary>
    public static EngineSession Locate(int pid, string moduleName, DispatchSignature signature)
    {
        IntPtr h = OpenProcess(PROCESS_ACCESS, false, pid);
        if (h == IntPtr.Zero)
            throw new InvalidOperationException($"OpenProcess failed for pid {pid} (err {Marshal.GetLastWin32Error()})");
        try
        {
            var mod = Modules.FindModule(h, moduleName);
            if (mod == null)
                throw new InvalidOperationException("no module enumerated — 无法取得 image base");
            uint moduleBase = (uint)mod.BaseAddress;

            using var scanner = new MemoryScanner(h);
            uint thisAddr = scanner.FindThis(moduleBase, signature);
            if (thisAddr == 0)
                throw new InvalidOperationException("this not found — 进程未初始化/布局不符（需进入游戏，解释器已运行）");

            return new EngineSession(h, pid, mod.Name, moduleBase, thisAddr, signature);
        }
        catch
        {
            CloseHandle(h);
            throw;
        }
    }

    /// <summary>手动快照：读取一次 `this` 状态（全局基址/key/控制符/40 帧）。</summary>
    public EngineSnapshot ReadSnapshot()
    {
        var reader = new EngineReader(_scanner);
        return reader.ReadSnapshot(ThisAddr, ModuleBase);
    }

    /// <summary>默认签名路径：从程序所在目录向上找 scripts/re/dispatch_signature.json。</summary>
    public static string DefaultSignaturePath()
    {
        string? dir = AppContext.BaseDirectory;
        for (int i = 0; i < 10; i++)
        {
            var candidate = Path.Combine(dir!, "scripts", "re", "dispatch_signature.json");
            if (File.Exists(candidate)) return candidate;
            var parent = Directory.GetParent(dir!);
            if (parent == null) break;
            dir = parent.FullName;
        }
        throw new FileNotFoundException("dispatch_signature.json not found; place it under scripts/re/ or configure path");
    }

    public void Dispose()
    {
        _scanner.Dispose();
        CloseHandle(_handle);
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
}
