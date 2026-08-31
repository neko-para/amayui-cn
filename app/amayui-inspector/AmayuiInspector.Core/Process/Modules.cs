using System.Text;
using AmayuiInspector.Core.Interop;
using AmayuiInspector.Core.Model;

namespace AmayuiInspector.Core.Process;

/// <summary>枚举目标进程模块，取 image base（配合指纹扫描用）。</summary>
public static class Modules
{
    /// <summary>返回进程全部模块（基址 + 文件名）。</summary>
    public static IReadOnlyList<ModuleInfo> Enumerate(IntPtr processHandle)
    {
        var result = new List<ModuleInfo>();
        var mods = new IntPtr[1024];
        if (!Win32.EnumProcessModules(processHandle, mods, mods.Length * IntPtr.Size, out int needed))
            return result;

        int count = Math.Min(mods.Length, needed / IntPtr.Size);
        var sb = new StringBuilder(260);
        for (int i = 0; i < count; i++)
        {
            sb.Clear();
            if (Win32.GetModuleFileNameEx(processHandle, mods[i], sb, sb.Capacity) == 0)
                continue;
            string path = sb.ToString();
            string name = Path.GetFileName(path);
            result.Add(new ModuleInfo(mods[i].ToInt64(), name));
        }
        return result;
    }

    /// <summary>按文件名匹配主模块；找不到则回退第一个模块。</summary>
    public static ModuleInfo? FindModule(IntPtr processHandle, string? nameFilter)
    {
        var mods = Enumerate(processHandle);
        if (mods.Count == 0) return null;
        if (!string.IsNullOrEmpty(nameFilter))
        {
            var m = mods.FirstOrDefault(x => string.Equals(x.Name, nameFilter, StringComparison.OrdinalIgnoreCase));
            if (m != null) return m;
        }
        return mods[0];
    }
}
