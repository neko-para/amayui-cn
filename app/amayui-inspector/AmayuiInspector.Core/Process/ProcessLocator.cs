namespace AmayuiInspector.Core.Process;

/// <summary>
/// 枚举目标 AGE 引擎进程。匹配规则（依约定收敛，避免 name 前缀撞车）：
/// 进程名**精确**为 <c>AGE</c>（即 AGE.EXE），或以 <c>天结</c>/<c>天結</c> 开头（如 天結_unpacked.exe）。
/// 不再用「AGE* 前缀 / 包含 unpacked」的宽松匹配，以免误配 Agent.exe 等。
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
            if (n.Equals("AGE", StringComparison.OrdinalIgnoreCase) ||
                n.StartsWith("天结", StringComparison.Ordinal) ||
                n.StartsWith("天結", StringComparison.Ordinal))
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
