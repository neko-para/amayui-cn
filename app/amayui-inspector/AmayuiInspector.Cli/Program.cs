using AmayuiInspector.Core.Decode;
using AmayuiInspector.Core.Engine;
using AmayuiInspector.Core.Model;
using AmayuiInspector.Core.Process;
using AmayuiInspector.Core.Scan;

namespace AmayuiInspector.Cli;

// 边界：Win32 是 internal，但本引用仅为编译期不直接访问；此处需要的公开 API 均来自 Core 的 public 类型/方法。
// （OpenProcess 通过 AmayuiInspector.Core 内部完成扫描，无需在此直接 P/Invoke。）

internal static class Program
{
    private static int Main(string[] args)
    {
        var opt = ParseArgs(args);

        Console.WriteLine("== amayui-inspector M1 smoke ==");
        Console.WriteLine($"runtime: {Environment.Version}   {(Environment.Is64BitProcess ? "x64" : "x86")} host");
        Console.WriteLine();

        // ---- 0) DEC 往返自校验 ----
        bool rt = Dec.RoundTripOk(0x4197761F);
        Console.WriteLine($"[self-check] DEC(ENC(x))==x  ⇒ {(rt ? "OK" : "FAIL")}");
        Console.WriteLine($"[self-check] offsets: int={0x5D800:X} float={0x5D808:X} str={0x5D810:X} ptr={0x5D818:X} fptr={0x5D820:X} key={0x5EC8C:X} frames={0x5D894:X} stride={0x78:X} dispatch={0x0A509C:X}");

        if (opt.NoProcess)
        {
            Console.WriteLine("[skip] process scan (--no-process)");
            return rt ? 0 : 1;
        }

        if (opt.List)
        {
            Console.WriteLine("[list] candidate processes (exact AGE or 天结*/天結*):");
            foreach (var t in AmayuiInspector.Core.Process.ProcessLocator.FindTargets())
                Console.WriteLine($"   {t.Id,-6} {t.ProcessName}");
            return 0;
        }

        // ---- 1) 找目标进程 ----
        var proc = ResolveTarget(opt);
        if (proc == null)
        {
            Console.WriteLine("[step1] target process not found.");
            return 2;
        }
        Console.WriteLine($"[step1] target PID={proc.Id}  name={proc.ProcessName}");

        // ---- 2) OpenProcess ----
        IntPtr h = Win32OpenProcess(proc.Id);
        if (h == IntPtr.Zero)
        {
            Console.WriteLine("[step2] OpenProcess failed");
            return 3;
        }

        try
        {
            // ---- 3) 主模块 image base ----
            var module = Modules.FindModule(h, proc.ProcessName + ".exe");
            if (module == null)
            {
                Console.WriteLine("[step3] no modules enumerated");
                return 4;
            }
            Console.WriteLine($"[step3] module={module.Name} base=0x{module.BaseAddress:X}");

            // ---- 4) 指纹扫描定位 this ----
            string sigPath = LocateSignature(opt.SignaturePath);
            Console.WriteLine($"[step4] signature: {sigPath}");
            var sig = Fingerprint.Load(sigPath);

            using var scanner = new MemoryScanner(h);
            uint thisAddr = scanner.FindThis((ulong)module.BaseAddress, sig);
            if (thisAddr == 0)
            {
                Console.WriteLine("[step4] this NOT found (process未初始化/布局不同)");
                return 5;
            }
            Console.WriteLine($"[step4] this = 0x{thisAddr:X}");

            // ---- 5) 读引擎快照 ----
            var reader = new EngineReader(scanner);
            var snap = reader.ReadSnapshot(thisAddr, (uint)module.BaseAddress);
            Console.WriteLine();
            Console.WriteLine($"[snap] this=0x{snap.This:X}");
            Console.WriteLine($"[snap] global bases: int=0x{snap.GlobalIntBase:X} float=0x{snap.GlobalFloatBase:X} string=0x{snap.GlobalStringBase:X} ptr=0x{snap.GlobalPtrBase:X} fptr=0x{snap.GlobalFloatPtrBase:X}");
            Console.WriteLine($"[snap] key=0x{snap.Key:X}");
            Console.WriteLine($"[snap] ctrl: cur_script={snap.CurScript} call_ret={snap.CallRet} call_link={snap.CallLink} call_flag={snap.CallFlag}");

            // ---- 6) 局部池前几槽（当前帧） ----
            if (snap.CurScript < EngineOffsets.FrameCount)
            {
                var fr = snap.Frames[(int)snap.CurScript];
                Console.WriteLine();
                Console.WriteLine($"[snap] active frame #{fr.Index}: str_table=0x{fr.StrTable:X} ip=0x{fr.Ip:X} caller={fr.Caller} frame_arg={fr.FrameArg} arity={fr.Arity}");
                Console.WriteLine($"        local: int=0x{fr.LocalInt:X} float=0x{fr.LocalFloat:X} string=0x{fr.LocalString:X} ptr=0x{fr.LocalPtr:X} fptr=0x{fr.LocalFloatPtr:X}  array_container=0x{fr.ArrayContainer:X}");
            }

            // ---- 7) 掉落表样本（单位 140..141） ----
            if (snap.GlobalIntBase != 0)
            {
                Console.WriteLine();
                Console.WriteLine("[snap] drop table sample (unit,slot): item / rate");
                foreach (var (u, s, item, rate) in reader.ReadDropSample(snap.GlobalIntBase, snap.Key, 140, 2))
                    if (item != 0 || rate != 0)
                        Console.WriteLine($"        unit {u} S{s}: item={item} rate={rate}");
            }

            // ---- 7.5) 全量 global-range 校验（--fullglobal）----
            if (opt.FullGlobal && snap.GlobalIntBase != 0)
            {
                Console.WriteLine();
                int maxSlots = reader.MaxGlobalSlots(snap.GlobalIntBase);
                Console.WriteLine($"[fullglobal] MaxGlobalSlots = {maxSlots:N0}");
                var vals = reader.ReadGlobalIntsRange(snap.GlobalIntBase, snap.Key, 0, maxSlots);
                int nonEmpty = 0;
                foreach (var v in vals) if (v != 0) nonEmpty++;
                Console.WriteLine($"[fullglobal] read {vals.Length:N0} slots, non-empty {nonEmpty:N0}");
                int shown = 0;
                for (int i = 0; i < vals.Length && shown < 5; i++)
                    if (vals[i] != 0) { Console.WriteLine($"        idx 0x{i:X} = {vals[i]}"); shown++; }
            }

            // ---- 8) 40 帧字段概览 ----
            Console.WriteLine();
            Console.WriteLine("[snap] 40-frame fields (str_table ip localInt localStr caller frame_arg arity)");
            var maxFrames = Math.Min(opt.MaxFrames, EngineOffsets.FrameCount);
            for (int f = 0; f < maxFrames; f++)
            {
                var fr = snap.Frames[f];
                Console.WriteLine($"  f[{f,2}] str=0x{fr.StrTable:X} ip=0x{fr.Ip:X} lInt=0x{fr.LocalInt:X} lStr=0x{fr.LocalString:X} caller={fr.Caller} arg={fr.FrameArg} arity={fr.Arity}");
            }

            // ---- 8.5) frame_arg -> 脚本文件名（--scripts）----
            if (opt.Scripts)
            {
                var sidx = AmayuiInspector.Core.Engine.ScriptIndex.Load();
                Console.WriteLine();
                Console.WriteLine($"[scripts] index loaded={sidx.Loaded} (count={sidx.Count})");
                for (int f = 0; f < EngineOffsets.FrameCount; f++)
                {
                    uint arg = snap.Frames[f].FrameArg;
                    if (arg == uint.MaxValue || arg == 0) continue;
                    string name = arg >= 0x0100_0000u
                        ? $"派发槽 0x{arg:X}"
                        : sidx.Resolve(arg) ?? $"0x{arg:X}(未命中)";
                    Console.WriteLine($"  f[{f,2}] frame_arg=0x{arg:X} -> {name}");
                }
            }

            Console.WriteLine();
            Console.WriteLine("[OK] M1 core read completed.");
            return 0;
        }
        finally
        {
            Win32CloseHandle(h);
        }
    }

    private sealed class Options
    {
        public int? Pid;
        public string? Name;
        public bool NoProcess;
        public int MaxFrames = 40;
        public string? SignaturePath;
        public bool FullGlobal;
        public bool List;
        public bool Scripts;
    }

    private static Options ParseArgs(string[] args)
    {
        var o = new Options();
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "-p": case "--pid": o.Pid = int.Parse(args[++i]); break;
                case "-n": case "--name": o.Name = args[++i]; break;
                case "--no-process": o.NoProcess = true; break;
                case "--frames": o.MaxFrames = int.Parse(args[++i]); break;
                case "--sig": o.SignaturePath = args[++i]; break;
                case "--fullglobal": o.FullGlobal = true; break;
                case "--list": o.List = true; break;
                case "--scripts": o.Scripts = true; break;
            }
        }
        return o;
    }

    private static System.Diagnostics.Process? ResolveTarget(Options o)
    {
        if (o.Pid is int pid)
        {
            var p = AmayuiInspector.Core.Process.ProcessLocator.FindById(pid);
            if (p == null) Console.WriteLine($"  (pid {pid} not running)");
            return p;
        }
        if (!string.IsNullOrEmpty(o.Name))
        {
            var p = AmayuiInspector.Core.Process.ProcessLocator.FindByName(o.Name);
            if (p == null) Console.WriteLine($"  (no process named '{o.Name}')");
            return p;
        }
        var targets = AmayuiInspector.Core.Process.ProcessLocator.FindTargets();
        if (targets.Count == 0) return null;
        return targets[0];
    }

    private static string LocateSignature(string? explicitPath)
    {
        string? dp = explicitPath;
        if (string.IsNullOrEmpty(dp))
        {
            var dir = AppContext.BaseDirectory;
            for (int i = 0; i < 8; i++)
            {
                var candidate = Path.Combine(dir, "scripts", "re", "dispatch_signature.json");
                if (File.Exists(candidate)) { dp = candidate; break; }
                var parent = Directory.GetParent(dir);
                if (parent == null) break;
                dir = parent.FullName;
            }
        }
        return dp
            ?? throw new FileNotFoundException("dispatch_signature.json not found; pass --sig <path>");
    }

    private static IntPtr Win32OpenProcess(int pid) => Win32Open(0x0410, pid);
    private static IntPtr Win32Open(uint access, int pid)
    {
        return OpenProcess(access, false, pid);
    }
    private static void Win32CloseHandle(IntPtr h) => CloseHandle(h);

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
}
