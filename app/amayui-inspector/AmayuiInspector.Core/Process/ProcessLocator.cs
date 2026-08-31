namespace AmayuiInspector.Core.Process;

/// <summary>
/// 枚举目标 AGE 引擎进程，按名称匹配 <c>AGE*</c> / <c>*unpacked*</c> / 天結（天结）。
/// </summary>
public static class ProcessLocator
{
    public static IReadOnlyList<System.Diagnostics.Process> FindTargets()
    {
        var list = new List<System.Diagnostics.Process>();
        System.Diagnostics.Process[] all;
        try { all = System.Diagnostics.Process.GetProcesses(); }
        catch { return list; }

        foreach (var p in all)
        {
            string n;
            try { n = p.ProcessName; } catch { continue; }
            if (string.IsNullOrEmpty(n)) continue;
            if (n.StartsWith("AGE", StringComparison.OrdinalIgnoreCase) ||
                n.Contains("unpacked", StringComparison.OrdinalIgnoreCase) ||
                n.Contains("天結", StringComparison.Ordinal) ||
                n.Contains("天结", StringComparison.Ordinal))
            {
                list.Add(p);
            }
        }
        return list;
    }

    public static System.Diagnostics.Process? FindByName(string name)
    {
        try
        {
            return System.Diagnostics.Process.GetProcessesByName(name).FirstOrDefault();
        }
        catch { return null; }
    }

    public static System.Diagnostics.Process? FindById(int pid)
    {
        try { return System.Diagnostics.Process.GetProcessById(pid); }
        catch { return null; }
    }
}
